import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { createAnthropicProvider } from '../../src/providers/anthropic.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

/**
 * The same harness loop must drive the Anthropic wire dialect end-to-end:
 * Anthropic SSE → provider tool_call events → tools → tool_result user
 * messages (with is_error) merged back into the conversation.
 */
test('anthropic dialect script: Read → Edit → Bash → final answer', async () => {
  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'sk-fake',
    model: 'claude-fake-4',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'notes.md' } }],
        usage: { input_tokens: 120, output_tokens: 15 },
      },
      {
        toolCalls: [
          {
            name: 'Edit',
            input: { file_path: 'notes.md', old_string: 'TODO: fill', new_string: 'Filled by harness' },
          },
        ],
        usage: { input_tokens: 340, output_tokens: 25 },
      },
      {
        toolCalls: [{ name: 'Bash', input: { command: 'cat notes.md' } }],
        usage: { input_tokens: 500, output_tokens: 20 },
      },
      {
        text: 'The note now reads: Filled by harness.',
        usage: { input_tokens: 640, output_tokens: 30 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m4-anthropic-')
  const transcriptDir = await createTempDir('zcode-m4-transcripts-')

  try {
    await fs.writeFile(path.join(workspace, 'notes.md'), '# Notes\nTODO: fill\n', 'utf8')

    const provider = createAnthropicProvider({
      provider: 'firstParty',
      apiKey: 'sk-fake',
      baseUrl: server.anthropicBaseUrl,
    })

    const result = await runAgentLoop({
      provider,
      model: 'claude-fake-4',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Fill in the TODO in notes.md and verify.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      maxTurns: 10,
      transcript: { dir: transcriptDir },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.turns, 4)
    assert.deepEqual(
      result.toolCalls.map(call => call.name),
      ['Read', 'Edit', 'Bash'],
    )
    assert.ok(result.toolCalls.every(call => call.isError === false))
    assert.match(result.toolCalls[2].result, /Filled by harness/)
    assert.match(result.text, /Filled by harness/)
    assert.equal(result.usage.totalTokens, 135 + 365 + 520 + 670)

    // The edit actually landed.
    assert.equal(
      await fs.readFile(path.join(workspace, 'notes.md'), 'utf8'),
      '# Notes\nFilled by harness\n',
    )

    // ── Anthropic wire-shape assertions on the requests the provider sent ──
    assert.equal(server.requestCount, 4)
    const first = server.requests[0]
    assert.equal(first.url, '/v1/messages')
    assert.equal(first.headers['x-api-key'], 'sk-fake')
    assert.equal(first.body.system, SYSTEM_PROMPT)
    assert.deepEqual(first.body.tools[0], {
      name: 'Read',
      description: first.body.tools[0].description,
      input_schema: first.body.tools[0].input_schema,
    })

    // Second request: assistant tool_use block + user tool_result block.
    const second = server.requests[1].body
    assert.equal(second.messages.length, 3)
    assert.equal(second.messages[0].role, 'user')
    assert.equal(second.messages[1].role, 'assistant')
    const toolUseBlock = second.messages[1].content.find(block => block.type === 'tool_use')
    assert.equal(toolUseBlock.name, 'Read')
    assert.deepEqual(toolUseBlock.input, { file_path: 'notes.md' })
    assert.equal(second.messages[2].role, 'user')
    assert.deepEqual(second.messages[2].content[0], {
      type: 'tool_result',
      tool_use_id: toolUseBlock.id,
      content: second.messages[2].content[0].content,
    })

    // Fourth request: the whole history round-trips in Anthropic blocks.
    const fourth = server.requests[3].body
    const toolResultBlocks = fourth.messages
      .filter(message => message.role === 'user')
      .flatMap(message => message.content)
      .filter(block => block.type === 'tool_result')
    assert.equal(toolResultBlocks.length, 3)
    assert.ok(toolResultBlocks.every(block => !block.is_error))

    // Transcript persisted to the custom dir.
    const transcriptFiles = await fs.readdir(transcriptDir)
    assert.equal(transcriptFiles.length, 1)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(transcriptDir, { recursive: true, force: true })
  }
})

test('anthropic dialect: tool errors carry is_error and the model recovers', async () => {
  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'sk-fake',
    model: 'claude-fake-4',
    script: [
      { toolCalls: [{ name: 'Read', input: { file_path: 'missing.txt' } }] },
      { text: 'The file does not exist; nothing to read.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m4-anthropic-err-')

  try {
    const provider = createAnthropicProvider({
      provider: 'firstParty',
      apiKey: 'sk-fake',
      baseUrl: server.anthropicBaseUrl,
    })

    const result = await runAgentLoop({
      provider,
      model: 'claude-fake-4',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'read missing.txt' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.toolCalls[0].isError, true)
    assert.match(result.toolCalls[0].result, /does not exist/)

    // The error reached the model as an is_error tool_result block.
    const second = server.requests[1].body
    const toolResultBlock = second.messages
      .filter(message => message.role === 'user')
      .flatMap(message => message.content)
      .find(block => block.type === 'tool_result')
    assert.equal(toolResultBlock.is_error, true)
    assert.match(toolResultBlock.content, /does not exist/)

    assert.match(result.text, /does not exist/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
