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

/** One OpenAI-dialect SSE data line as raw text (for rawChunks injection). */
function oaChunk(delta, finishReason = null) {
  const payload = { id: 'chatcmpl_proto', model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finishReason }] }
  return `data: ${JSON.stringify(payload)}\n\n`
}

const OA_START = oaChunk({})
const OA_TEXT = text => oaChunk({ content: text })
const OA_FINISH = finishReason => `data: ${JSON.stringify({ id: 'chatcmpl_proto', model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`
const OA_DONE = 'data: [DONE]\n\n'

/** Anthropic-dialect SSE event as raw text. */
function anEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
}

const AN_START = anEvent('message_start', { message: { id: 'msg_proto', model: 'fake-model', usage: { input_tokens: 1, output_tokens: 1 } } })
const AN_TEXT = text => anEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })

function openaiProviderFor(server) {
  return createOpenAICompatibleProvider({
    provider: 'fake',
    model: 'fake-model',
    baseUrl: server.openaiBaseUrl,
    apiKey: 'test',
  })
}

function anthropicProviderFor(server) {
  return createAnthropicProvider({
    provider: 'firstParty',
    baseUrl: server.anthropicBaseUrl,
    apiKey: 'test',
  })
}

// ── Protocol completeness: a stream without response_end is an error ──

test('protocol: openai stream without response_end is a protocol error, not an empty end_turn', { timeout: 20000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      // Headers + text, then [DONE] with no finish_reason → no response_end.
      { rawChunks: [OA_START, OA_TEXT('truncated turn'), OA_DONE] },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-proto-eof-')

  try {
    const result = await runAgentLoop({
      provider: openaiProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
      providerRetry: { attempts: 3, backoffMs: 1 },
    })

    assert.equal(result.stopReason, 'error')
    assert.match(result.error, /response_end/)
    // The dangling partial turn must NOT be recorded as conversation history.
    assert.equal(result.messages.length, 1)
    assert.equal(result.turns, 0)
    // Non-retryable: exactly one provider request, no retry storm.
    assert.equal(server.requestCount, 1)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('protocol: anthropic stream without message_delta is a protocol error', { timeout: 20000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'test',
    script: [
      // message_start + text, then EOF — no message_delta (response_end).
      { rawChunks: [AN_START, AN_TEXT('truncated')] },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-proto-an-eof-')

  try {
    const result = await runAgentLoop({
      provider: anthropicProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
      providerRetry: { attempts: 3, backoffMs: 1 },
    })

    assert.equal(result.stopReason, 'error')
    assert.match(result.error, /response_end/)
    assert.equal(result.messages.length, 1)
    assert.equal(result.turns, 0)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('protocol: malformed SSE events are skipped and a valid turn still completes', { timeout: 20000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { rawChunks: [OA_START, 'data: NOT_JSON_AT_ALL\n\n', OA_TEXT('recovered'), OA_FINISH('stop'), OA_DONE] },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-proto-skip-')

  try {
    const result = await runAgentLoop({
      provider: openaiProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.text, 'recovered')
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('protocol: a stream of 10+ malformed SSE events is a protocol error', { timeout: 20000 }, async () => {
  const bad = Array.from({ length: 12 }, () => 'data: {broken json\n\n')
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [{ rawChunks: [OA_START, ...bad] }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-proto-garbage-')

  try {
    const result = await runAgentLoop({
      provider: openaiProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
      providerRetry: { attempts: 3, backoffMs: 1 },
    })

    assert.equal(result.stopReason, 'error')
    assert.match(result.error, /malformed SSE/)
    assert.equal(server.requestCount, 1, 'protocol errors must not be retried')
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

// ── Abort matrix: cancellation is `aborted`, never `end_turn` ──

test('abort: before the first byte — the loop returns aborted quickly', { timeout: 20000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [{ rawChunks: [], keepOpenMs: 30000 }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-abort-early-')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 150)

  try {
    const startedAt = Date.now()
    const result = await runAgentLoop({
      provider: openaiProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      signal: controller.signal,
      transcript: { enabled: false },
    })
    const elapsed = Date.now() - startedAt

    assert.equal(result.stopReason, 'aborted')
    assert.equal(result.error, null)
    assert.equal(result.messages.length, 1, 'no assistant message for a cancelled run')
    assert.ok(elapsed < 5000, `abort should be fast, took ${elapsed}ms`)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('abort: mid-text — partial output is observed but never reported as end_turn', { timeout: 20000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [{ rawChunks: [OA_START, OA_TEXT('partial out'), OA_TEXT('put never finished')], keepOpenMs: 30000 }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-abort-text-')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 250)

  try {
    const events = []
    const startedAt = Date.now()
    const result = await runAgentLoop({
      provider: openaiProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      signal: controller.signal,
      onEvent: event => events.push(event),
      transcript: { enabled: false },
    })
    const elapsed = Date.now() - startedAt

    assert.equal(result.stopReason, 'aborted')
    assert.notEqual(result.stopReason, 'end_turn')
    assert.equal(result.messages.length, 1)
    assert.ok(events.some(event => event.type === 'text_delta'), 'deltas were observed before the abort')
    assert.ok(elapsed < 5000, `abort should be fast, took ${elapsed}ms`)
    assert.equal(server.requestCount, 1, 'no retry after cancellation')
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('abort: during a running Bash — the shell tree is killed and the loop stops', { timeout: 30000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { toolCalls: [{ name: 'Bash', input: { command: 'sleep 30' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      { text: 'should never reach here' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-abort-bash-')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 400)

  try {
    const startedAt = Date.now()
    const result = await runAgentLoop({
      provider: openaiProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'run a long sleep' }],
      permissionMode: 'yolo',
      cwd: workspace,
      signal: controller.signal,
      transcript: { enabled: false },
    })
    const elapsed = Date.now() - startedAt

    assert.equal(result.stopReason, 'aborted')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0].isError, true)
    assert.match(result.toolCalls[0].result, /aborted/i)
    // sleep 30 was killed by the abort, not left to run to completion.
    assert.ok(elapsed < 10000, `aborted bash should return promptly, took ${elapsed}ms`)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('abort: during provider retry backoff — no further attempts are made', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-abort-backoff-')
  let calls = 0
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat() {
      calls += 1
      // eslint-disable-next-line require-yield -- a generator that rejects on first pull
      return (async function* () {
        throw new Error('ECONNRESET: socket hang up')
      })()
    },
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 150)

  try {
    const startedAt = Date.now()
    const result = await runAgentLoop({
      provider,
      model: 'stub-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      signal: controller.signal,
      transcript: { enabled: false },
      providerRetry: { attempts: 5, backoffMs: 2000 },
    })
    const elapsed = Date.now() - startedAt

    assert.equal(result.stopReason, 'aborted')
    assert.equal(calls, 1, 'no further attempts after cancellation')
    // The 2000ms backoff must not have been waited out in full.
    assert.ok(elapsed < 1500, `backoff must be abortable, took ${elapsed}ms`)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('abort: anthropic mid-stream cancellation returns aborted', { timeout: 20000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'test',
    script: [{ rawChunks: [AN_START, AN_TEXT('partial ')], keepOpenMs: 30000 }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-abort-an-')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 250)

  try {
    const result = await runAgentLoop({
      provider: anthropicProviderFor(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'hello' }],
      permissionMode: 'yolo',
      cwd: workspace,
      signal: controller.signal,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'aborted')
    assert.equal(result.messages.length, 1)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
