import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('minimal closed loop: single-turn text response through the fake server', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [{ text: 'All done: nothing to fix.', usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-minimal-')

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
      messages: [{ role: 'user', content: 'Fix all failing tests.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      onEvent: event => events.push(event),
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.text, 'All done: nothing to fix.')
    assert.equal(result.turns, 1)
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4, totalTokens: 16 })
    assert.deepEqual(
      result.messages,
      [
        { role: 'user', content: 'Fix all failing tests.' },
        { role: 'assistant', text: 'All done: nothing to fix.', toolCalls: [] },
      ],
    )
    assert.equal(result.error, null)

    // The wire request must carry the translated system + user messages and tools.
    assert.equal(server.requests.length, 1)
    const wireBody = server.requests[0].body
    assert.equal(wireBody.messages[0].role, 'system')
    assert.equal(wireBody.messages[0].content, SYSTEM_PROMPT)
    assert.equal(wireBody.messages[1].role, 'user')
    const toolNames = wireBody.tools.map(tool => tool.function.name)
    assert.deepEqual(toolNames, [
      'Read',
      'Glob',
      'Grep',
      'Write',
      'Edit',
      'Bash',
      'TodoWrite',
      'WebFetch',
    ])

    // Progress events observed.
    assert.ok(events.some(event => event.type === 'session_start'))
    assert.ok(events.some(event => event.type === 'turn_start' && event.turn === 1))
    assert.ok(events.some(event => event.type === 'text_delta' && event.text === 'All done: nothing to fix.'))
    assert.ok(events.some(event => event.type === 'assistant_message' && event.text === 'All done: nothing to fix.'))
    const loopEnd = events.find(event => event.type === 'loop_end')
    assert.equal(loopEnd.stopReason, 'end_turn')
    assert.equal(loopEnd.turns, 1)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('multi-turn read-side script: Glob → Grep → Read → final answer with real tools', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      {
        toolCalls: [{ name: 'Glob', input: { pattern: 'src/**/*.js' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
      {
        toolCalls: [{ name: 'Grep', input: { pattern: 'TODO', output_mode: 'content' } }],
        usage: { prompt_tokens: 400, completion_tokens: 20, total_tokens: 420 },
      },
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'src/app.js' } }],
        usage: { prompt_tokens: 800, completion_tokens: 30, total_tokens: 830 },
      },
      {
        text: 'Found the TODO in src/app.js. Plan: remove it and rerun tests.',
        usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-reads-')

  try {
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'src', 'app.js'),
      '// main app\nfunction main() {\n  console.log("TODO: implement");\n}\n',
      'utf8',
    )
    await fs.writeFile(path.join(workspace, 'README.md'), '# workspace\n', 'utf8')

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
      messages: [{ role: 'user', content: 'Find the TODO and plan a fix.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      onEvent: event => events.push(event),
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.turns, 4)
    assert.match(result.text, /TODO in src\/app\.js/)
    assert.equal(result.usage.totalTokens, 120 + 420 + 830 + 1240)

    // Executed tool calls reported with their results.
    assert.equal(result.toolCalls.length, 3)
    assert.equal(result.toolCalls[0].name, 'Glob')
    assert.equal(result.toolCalls[0].isError, false)
    assert.match(result.toolCalls[0].result, /src[\\/]app\.js/)
    assert.equal(result.toolCalls[1].name, 'Grep')
    assert.match(result.toolCalls[1].result, /TODO: implement/)
    assert.equal(result.toolCalls[2].name, 'Read')
    assert.match(result.toolCalls[2].result, /console\.log\("TODO: implement"\);/)

    // Provider-agnostic history shape.
    assert.equal(result.messages.length, 8)
    assert.equal(result.messages[1].role, 'assistant')
    assert.equal(result.messages[1].toolCalls[0].name, 'Glob')
    assert.equal(result.messages[2].role, 'tool')
    assert.equal(result.messages[2].toolName, 'Glob')
    assert.equal(result.messages[3].role, 'assistant')
    assert.equal(result.messages[4].role, 'tool')
    assert.equal(result.messages[4].toolName, 'Grep')
    assert.equal(result.messages[5].role, 'assistant')
    assert.equal(result.messages[5].toolCalls[0].name, 'Read')
    assert.equal(result.messages[6].role, 'tool')
    assert.equal(result.messages[6].toolName, 'Read')
    assert.equal(result.messages[7].role, 'assistant')
    assert.match(result.messages[7].text, /Plan: remove it/)

    // Each subsequent wire request carries the accumulated tool history.
    const secondRequestBody = server.requests[1].body
    const roles = secondRequestBody.messages.map(message => message.role)
    assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool'])
    assert.equal(secondRequestBody.messages[2].tool_calls[0].function.name, 'Glob')
    assert.equal(secondRequestBody.messages[3].tool_call_id, secondRequestBody.messages[2].tool_calls[0].id)

    // Tool execution lifecycle events emitted.
    const executionStarts = events.filter(event => event.type === 'tool_execution_start')
    assert.deepEqual(executionStarts.map(event => event.name), ['Glob', 'Grep', 'Read'])
    const executionEnds = events.filter(event => event.type === 'tool_execution_end')
    assert.ok(executionEnds.every(event => event.isError === false))
    assert.ok(events.filter(event => event.type === 'turn_end').length === 4)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('loop persists a JSONL transcript by default', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [{ text: 'done' }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-transcript-')
  const transcriptDir = await createTempDir('zcode-loop-transcript-dir-')

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: 'test',
    })

    const result = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'plan',
      cwd: workspace,
      transcript: { dir: transcriptDir },
    })

    assert.ok(result.sessionId)
    const transcriptPath = path.join(transcriptDir, `${result.sessionId}.jsonl`)
    const raw = await fs.readFile(transcriptPath, 'utf8')
    const lines = raw.trim().split('\n').map(line => JSON.parse(line))

    const types = lines.map(line => line.type)
    assert.equal(types[0], 'session_start')
    assert.ok(types.includes('message'))
    assert.equal(types[types.length - 1], 'result')

    const sessionStart = lines[0]
    assert.equal(sessionStart.permissionMode, 'plan')
    assert.equal(sessionStart.cwd, workspace)
    const resultEntry = lines[lines.length - 1]
    assert.equal(resultEntry.stopReason, 'end_turn')
    assert.ok(sessionStart.timestamp)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(transcriptDir, { recursive: true, force: true })
  }
})

test('plan mode denies write tools and the model continues read-only', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      {
        toolCalls: [{ name: 'Write', input: { file_path: 'evil.txt', content: 'nope' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'README.md' } }],
        usage: { prompt_tokens: 60, completion_tokens: 5, total_tokens: 65 },
      },
      { text: 'Plan mode prevented the write; here is my plan instead.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-plan-')

  try {
    await fs.writeFile(path.join(workspace, 'README.md'), '# plan workspace\n', 'utf8')
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
      messages: [{ role: 'user', content: 'write a file' }],
      permissionMode: 'plan',
      cwd: workspace,
      onEvent: event => events.push(event),
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    // The Write was denied and the denial was fed back as a tool error.
    const writeExecution = result.toolCalls[0]
    assert.equal(writeExecution.name, 'Write')
    assert.equal(writeExecution.isError, true)
    assert.match(writeExecution.result, /permission denied/)
    assert.match(writeExecution.result, /Plan mode is read-only/)

    // The file was never created.
    await assert.rejects(fs.access(path.join(workspace, 'evil.txt')))

    // The Read in the following turn succeeded.
    assert.equal(result.toolCalls[1].name, 'Read')
    assert.equal(result.toolCalls[1].isError, false)

    // Permission denial event surfaced to observers.
    const denied = events.find(event => event.type === 'permission_denied')
    assert.ok(denied)
    assert.equal(denied.name, 'Write')
    assert.match(denied.reason, /Plan mode is read-only/)

    // The denial reached the model as an error tool result.
    const secondRequestBody = server.requests[1].body
    const toolMessage = secondRequestBody.messages.find(message => message.role === 'tool')
    assert.match(toolMessage.content, /permission denied/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('unknown tool call is reported to the model and the loop recovers', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { toolCalls: [{ name: 'DoesNotExist', input: {} }] },
      { text: 'Recovered after the unknown tool error.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-loop-unknown-')

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: 'test',
    })

    const result = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'use a made-up tool' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.toolCalls[0].name, 'DoesNotExist')
    assert.equal(result.toolCalls[0].isError, true)
    assert.match(result.toolCalls[0].result, /unknown tool/i)
    assert.match(result.toolCalls[0].result, /Read, Glob, Grep, Write, Edit, Bash/)
    assert.match(result.text, /Recovered/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

// ── In-loop provider retries ──

// eslint-disable-next-line require-yield -- a generator that rejects on first pull
async function* failedTurn(error) {
  throw error
}

async function* textTurn(text, usage) {
  yield { type: 'response_start', messageId: 'stub-1', model: 'stub-model', provider: 'stub' }
  yield { type: 'text_delta', text }
  yield { type: 'response_end', finishReason: 'stop', usage }
}

function createStubProvider(turns) {
  let calls = 0
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat() {
      const step = turns[Math.min(calls, turns.length - 1)]
      calls += 1
      return step()
    },
  }
  return { provider, callCount: () => calls }
}

test('a provider failure before any output is retried and the turn succeeds', async () => {
  const workspace = await createTempDir('zcode-loop-retry-')
  const { provider, callCount } = createStubProvider([
    () => failedTurn(new Error('ECONNRESET: socket hang up')),
    () => textTurn('Recovered after retry.', { inputTokens: 8, outputTokens: 3, totalTokens: 11 }),
  ])

  try {
    const events = []
    const result = await runAgentLoop({
      provider,
      model: 'stub-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      onEvent: event => events.push(event),
      transcript: { enabled: false },
      providerRetry: { attempts: 3, backoffMs: 1 },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.text, 'Recovered after retry.')
    assert.equal(result.error, null)
    // The retried request does not consume a turn of the guardrail budget.
    assert.equal(result.turns, 1)
    assert.equal(callCount(), 2)

    const retries = events.filter(event => event.type === 'provider_retry')
    assert.equal(retries.length, 1)
    assert.equal(retries[0].attempt, 1)
    assert.match(retries[0].message, /ECONNRESET/)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('a provider failure gives up after exhausting the retry attempts', async () => {
  const workspace = await createTempDir('zcode-loop-retry-exhaust-')
  const { provider, callCount } = createStubProvider([
    () => failedTurn(new Error('502 Bad Gateway')),
  ])

  try {
    const result = await runAgentLoop({
      provider,
      model: 'stub-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
      // Default attempts (3): two retries before the failure is terminal.
      providerRetry: { backoffMs: 1 },
    })

    assert.equal(result.stopReason, 'error')
    assert.match(result.error, /502 Bad Gateway/)
    assert.equal(callCount(), 3)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('a turn that already streamed deltas is never replayed', async () => {
  const workspace = await createTempDir('zcode-loop-retry-partial-')
  const { provider, callCount } = createStubProvider([
    async function* partialTurn() {
      yield { type: 'text_delta', text: 'partial output ' }
      throw new Error('stream died mid-turn')
    },
  ])

  try {
    const events = []
    const result = await runAgentLoop({
      provider,
      model: 'stub-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      onEvent: event => events.push(event),
      transcript: { enabled: false },
      providerRetry: { attempts: 3, backoffMs: 1 },
    })

    // Replaying would duplicate the already-emitted deltas, so the failure
    // is terminal on the first attempt.
    assert.equal(result.stopReason, 'error')
    assert.match(result.error, /stream died mid-turn/)
    assert.equal(callCount(), 1)
    assert.ok(!events.some(event => event.type === 'provider_retry'))
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
