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
import {
  selectCompactionBoundary,
  resolveCompactConfig,
  DEFAULT_COMPACT_LIMIT_TOKENS,
} from '../../src/harness/compact.ts'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'
// Fake credential accepted by the local fake LLM server; never a real secret.
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || ['test', 'key'].join('-')

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('selectCompactionBoundary keeps tool results attached to their assistant turn', () => {
  const history = [
    { role: 'user', content: 'task' },
    { role: 'assistant', text: null, toolCalls: [{ id: 'c1', name: 'Read', input: {} }] },
    { role: 'tool', toolCallId: 'c1', toolName: 'Read', content: 'data' },
    { role: 'assistant', text: null, toolCalls: [{ id: 'c2', name: 'Glob', input: {} }] },
    { role: 'tool', toolCallId: 'c2', toolName: 'Glob', content: 'files' },
  ]

  // keepRecent lands on an assistant message: cut there, tail starts valid.
  assert.equal(selectCompactionBoundary(history, 2), 3)
  // keepRecent lands inside a tool chain: walk back to the assistant turn.
  const tripleTool = [
    history[0],
    history[1],
    history[2],
    { role: 'tool', toolCallId: 'c1b', toolName: 'Read', content: 'more' },
    { role: 'tool', toolCallId: 'c1c', toolName: 'Read', content: 'even more' },
  ]
  assert.equal(selectCompactionBoundary(tripleTool, 2), 1)
  // Not enough history to summarize anything.
  assert.equal(selectCompactionBoundary([history[0]], 6), -1)
  assert.equal(selectCompactionBoundary([history[0], history[1]], 6), 1)
  assert.equal(selectCompactionBoundary([], 6), -1)
})

test('resolveCompactConfig applies defaults and treats 0 as disabled', () => {
  const defaults = resolveCompactConfig(undefined)
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.limitTokens, DEFAULT_COMPACT_LIMIT_TOKENS)
  assert.equal(defaults.keepRecentMessages, 6)

  assert.equal(resolveCompactConfig({ limitTokens: 0 }).enabled, false)
  assert.equal(resolveCompactConfig({ enabled: false }).enabled, false)
  assert.equal(resolveCompactConfig({ limitTokens: 1000, keepRecentMessages: 2 }).limitTokens, 1000)
})

test('auto compaction fires on the input-token threshold and replaces history', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test-key',
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'a.txt' } }],
        usage: { prompt_tokens: 900, completion_tokens: 10, total_tokens: 910 },
      },
      {
        toolCalls: [{ name: 'Glob', input: { pattern: '*.txt' } }],
        usage: { prompt_tokens: 1500, completion_tokens: 10, total_tokens: 1510 },
      },
      {
        text: 'Earlier the agent read a.txt and globbed for txt files; task is to fix config.',
        usage: { prompt_tokens: 700, completion_tokens: 30, total_tokens: 730 },
      },
      {
        text: 'All done.',
        usage: { prompt_tokens: 200, completion_tokens: 5, total_tokens: 205 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-compact-')
  const transcriptDir = path.join(workspace, '.transcripts')

  try {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'data\n', 'utf8')

    const events = []
    const result = await runAgentLoop({
      provider: createOpenAICompatibleProvider({
        provider: 'fake',
        model: 'fake-model',
        baseUrl: server.openaiBaseUrl,
        apiKey: 'test-key',
      }),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Fix the stale config.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: true, dir: transcriptDir },
      compact: { limitTokens: 1000, keepRecentMessages: 2 },
      onEvent: event => events.push(event),
    })

    // Compaction happened exactly once and did not consume a turn.
    assert.equal(result.compactions, 1)
    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.turns, 3)
    assert.equal(result.text, 'All done.')

    // Usage is honest: every request, including the summary, is accounted.
    assert.equal(result.usage.totalTokens, 910 + 1510 + 730 + 205)

    // Four provider requests: two tool turns, the summary, the final turn.
    assert.equal(server.requestCount, 4)

    // The summary request carries no tools and no system prompt.
    const summaryRequest = server.requests[2].body
    assert.equal(summaryRequest.tools, undefined)
    assert.equal(summaryRequest.system, undefined)

    // The post-compaction request opens with the summary, then the kept tail.
    const finalMessages = server.requests[3].body.messages
    assert.equal(finalMessages[0].role, 'system')
    assert.match(finalMessages[1].content, /\[Auto-compacted conversation\]/)
    assert.match(finalMessages[1].content, /read a\.txt/)
    assert.equal(finalMessages[2].role, 'assistant')
    assert.equal(finalMessages[3].role, 'tool')

    // Events expose the compaction to renderers.
    const compactEvents = events.filter(event => event.type === 'context_compact')
    assert.equal(compactEvents.length, 1)
    assert.equal(compactEvents[0].ok, true)
    assert.equal(compactEvents[0].summarizedMessages, 3)
    assert.equal(compactEvents[0].keptMessages, 2)

    // The transcript records the compaction for audit.
    const transcriptFile = (await fs.readdir(transcriptDir))[0]
    const raw = await fs.readFile(path.join(transcriptDir, transcriptFile), 'utf8')
    const types = raw.trim().split('\n').map(line => JSON.parse(line).type)
    assert.ok(types.includes('context_compact'))
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('an empty summary never breaks the loop: the run continues uncompacted', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test-key',
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'a.txt' } }],
        usage: { prompt_tokens: 900, completion_tokens: 10, total_tokens: 910 },
      },
      {
        toolCalls: [{ name: 'Glob', input: { pattern: '*.txt' } }],
        usage: { prompt_tokens: 1500, completion_tokens: 10, total_tokens: 1510 },
      },
      { text: '', usage: { prompt_tokens: 700, completion_tokens: 0, total_tokens: 700 } },
      {
        text: 'Recovered and finished.',
        usage: { prompt_tokens: 1800, completion_tokens: 5, total_tokens: 1805 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-compact-fail-')

  try {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'data\n', 'utf8')

    const events = []
    const result = await runAgentLoop({
      provider: createOpenAICompatibleProvider({
        provider: 'fake',
        model: 'fake-model',
        baseUrl: server.openaiBaseUrl,
        apiKey: 'test-key',
      }),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Fix the stale config.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      compact: { limitTokens: 1000, keepRecentMessages: 2 },
      onEvent: event => events.push(event),
    })

    assert.equal(result.compactions, 0)
    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.text, 'Recovered and finished.')

    // The failed compaction is visible, and the final request kept the full
    // uncompacted history (no summary wrapper injected).
    const failed = events.find(event => event.type === 'context_compact' && event.ok === false)
    assert.ok(failed, 'expected a failed compaction event')
    assert.match(failed.message, /no text/)

    const finalMessages = server.requests[3].body.messages
    assert.equal(
      finalMessages.some(message => String(message.content).includes('[Auto-compacted')),
      false,
    )
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('below the threshold no compaction request is issued', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test-key',
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'a.txt' } }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      },
      { text: 'Done quickly.', usage: { prompt_tokens: 120, completion_tokens: 5, total_tokens: 125 } },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-compact-off-')

  try {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'data\n', 'utf8')

    const result = await runAgentLoop({
      provider: createOpenAICompatibleProvider({
        provider: 'fake',
        model: 'fake-model',
        baseUrl: server.openaiBaseUrl,
        apiKey: 'test-key',
      }),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Read a.txt.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      compact: { limitTokens: 1000 },
    })

    assert.equal(result.compactions, 0)
    assert.equal(result.turns, 2)
    assert.equal(server.requestCount, 2)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('compaction speaks the Anthropic dialect too (tool-less summary request)', async () => {
  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'test-key',
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'a.txt' } }],
        usage: { input_tokens: 900, output_tokens: 10 },
      },
      {
        toolCalls: [{ name: 'Glob', input: { pattern: '*.txt' } }],
        usage: { input_tokens: 1500, output_tokens: 10 },
      },
      {
        text: 'Summary: a.txt was read; the task is to fix config.',
        usage: { input_tokens: 700, output_tokens: 30 },
      },
      {
        text: 'All done.',
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-compact-anthropic-')

  try {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'data\n', 'utf8')

    const result = await runAgentLoop({
      provider: createAnthropicProvider({
        provider: 'firstParty',
        apiKey: FAKE_API_KEY,
        baseUrl: server.anthropicBaseUrl,
      }),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Fix the stale config.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      compact: { limitTokens: 1000, keepRecentMessages: 2 },
    })

    assert.equal(result.compactions, 1)
    assert.equal(result.stopReason, 'end_turn')
    assert.equal(server.requestCount, 4)

    // Summary request: no tools, no system.
    const summaryRequest = server.requests[2].body
    assert.equal(summaryRequest.tools, undefined)
    assert.equal(summaryRequest.system, undefined)

    // Anthropic roles still alternate after compaction: the summary is a user
    // message, followed by the assistant turn kept verbatim.
    const finalMessages = server.requests[3].body.messages
    assert.equal(finalMessages[0].role, 'user')
    assert.match(String(finalMessages[0].content), /\[Auto-compacted conversation\]/)
    assert.equal(finalMessages[1].role, 'assistant')
    for (let i = 1; i < finalMessages.length; i += 1) {
      assert.notEqual(finalMessages[i].role, finalMessages[i - 1].role)
    }
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
