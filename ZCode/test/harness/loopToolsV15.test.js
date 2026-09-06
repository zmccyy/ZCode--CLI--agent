import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createAnthropicProvider } from '../../src/providers/anthropic.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('full chain: model drives TodoWrite through the loop (openai dialect)', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      {
        toolCalls: [
          {
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'inspect the workspace' },
                { content: 'write the fix', status: 'in_progress' },
                { content: 'verify' },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
      },
      {
        toolCalls: [
          {
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'inspect the workspace', status: 'completed' },
                { content: 'write the fix', status: 'completed' },
                { content: 'verify', status: 'in_progress' },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 90, completion_tokens: 12, total_tokens: 102 },
      },
      {
        text: 'Plan finished: all steps completed.',
        usage: { prompt_tokens: 130, completion_tokens: 8, total_tokens: 138 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-todo-')

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: 'test',
    })

    const events = []
    const result = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Track this work with todos and finish.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      onEvent: event => events.push(event),
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.toolCalls.length, 2)
    // The tool results flowed back with the rendered checklist markers.
    assert.match(result.toolCalls[0].result, /1 in progress/)
    assert.match(result.toolCalls[1].result, /2 completed/)
    // The final model message saw the rendered checklists (context contains them).
    const finalUserTurn = result.messages.filter(message => message.role === 'tool')
    assert.match(finalUserTurn[0].content, /◐ write the fix/)
    assert.match(finalUserTurn[1].content, /☒ write the fix/)
    assert.match(finalUserTurn[1].content, /◐ verify/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('full chain: model calls WebFetch through the loop (anthropic dialect)', async () => {
  // Local HTTP server stands in for the "public web"; the tool's SSRF guard
  // would refuse loopback in production, so this exercises the fetch+decode
  // path via the loop with the guard expectation documented.
  const http = await import('node:http')
  const webServer = await new Promise(resolve => {
    const created = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('api docs: use GET /v1/things')
    })
    created.listen(0, '127.0.0.1', () => resolve(created))
  })
  const webPort = webServer.address().port

  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'test',
    script: [
      {
        toolCalls: [{ name: 'WebFetch', input: { url: `http://127.0.0.1:${webPort}/docs` } }],
        usage: { input_tokens: 30, output_tokens: 10 },
      },
      {
        text: 'Docs fetched and understood.',
        usage: { input_tokens: 60, output_tokens: 8 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-webfetch-')

  try {
    const provider = createAnthropicProvider({
      provider: 'firstParty',
      baseUrl: server.anthropicBaseUrl,
      apiKey: 'test',
    })
    const tools = createCoreTools()
    // Loopback fetch requires relaxing the SSRF classifier for this test;
    // production behavior (refusal) is covered in todoWebFetch.test.js.
    const webFetch = tools.find(tool => tool.name === 'WebFetch')
    const originalExecute = webFetch.execute
    webFetch.execute = (input, context) =>
      originalExecute(input, context, { isPrivateAddress: () => false })

    const result = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools,
      messages: [{ role: 'user', content: 'Fetch the docs page.' }],
      permissionMode: 'yolo',
      cwd: workspace,
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.match(result.toolCalls[0].result, /api docs: use GET \/v1\/things/)
    assert.equal(result.text, 'Docs fetched and understood.')
  } finally {
    await server.close()
    webServer.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
