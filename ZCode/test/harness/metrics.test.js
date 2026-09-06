// Tests for P1.2 run metrics: the collector aggregates the loop's own event
// stream into per-turn timings (TTFT), per-tool aggregates, retries, tokens,
// and an RSS sample; runAgentLoop attaches a real snapshot to its result and
// print mode passes it through to the JSON envelope.

import test from 'node:test'
import assert from 'node:assert/strict'

import { createRunMetricsCollector } from '../../src/harness/metrics.ts'
import { runAgentLoop } from '../../src/harness/loop.ts'
import { runHarnessPrint } from '../../src/cli/harnessPrint.js'

test('metrics collector: aggregates turns, TTFT, tools, retries, and tokens', () => {
  const collector = createRunMetricsCollector()

  const feed = event => collector.onLoopEvent(event)
  feed({ type: 'session_start', sessionId: 's', cwd: 'C:\\w', model: null, permissionMode: 'agent' })
  feed({ type: 'turn_start', turn: 1 })
  feed({ type: 'text_delta', text: 'hi' })
  feed({ type: 'tool_execution_start', toolCallId: 't1', name: 'Read', input: {} })
  feed({ type: 'tool_execution_end', toolCallId: 't1', name: 'Read', isError: false, durationMs: 12, preview: '' })
  feed({ type: 'provider_retry', attempt: 1, message: 'boom' })
  feed({ type: 'turn_end', turn: 1, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })
  feed({ type: 'turn_start', turn: 2 })
  feed({ type: 'tool_execution_start', toolCallId: 't2', name: 'Read', input: {} })
  feed({ type: 'tool_execution_end', toolCallId: 't2', name: 'Read', isError: true, durationMs: 8, preview: '' })
  feed({ type: 'tool_execution_end', toolCallId: 't3', name: 'Bash', isError: false, durationMs: 30, preview: '' })
  feed({ type: 'turn_end', turn: 2, usage: { inputTokens: 20, outputTokens: 7, totalTokens: 27 } })
  feed({ type: 'loop_end', stopReason: 'end_turn', turns: 2, usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } })

  const snapshot = collector.snapshot()
  assert.equal(snapshot.turns.length, 2)
  assert.ok(snapshot.turns[0].ttftMs !== null, 'first turn streamed → TTFT recorded')
  assert.equal(snapshot.turns[1].ttftMs, null, 'second turn never streamed a delta')
  assert.equal(snapshot.retries, 1)
  assert.equal(snapshot.tokens.inputTokens, 30)
  assert.equal(snapshot.tokens.outputTokens, 12)
  assert.equal(snapshot.stopReason, 'end_turn')
  assert.ok(snapshot.totalDurationMs >= 0)
  assert.ok(snapshot.rssBytes > 0)

  const read = snapshot.tools.find(tool => tool.name === 'Read')
  assert.deepEqual(read, { name: 'Read', count: 2, totalDurationMs: 20, errors: 1 })
  const bash = snapshot.tools.find(tool => tool.name === 'Bash')
  assert.deepEqual(bash, { name: 'Bash', count: 1, totalDurationMs: 30, errors: 0 })
})

test('loop: result.metrics is attached to a real run', async () => {
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: 'done' }
      yield { type: 'response_end', finishReason: 'stop', usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 } }
    },
  }

  const result = await runAgentLoop({
    provider,
    model: 'stub-model',
    system: 'sys',
    tools: [],
    messages: [{ role: 'user', content: 'hi' }],
    permissionMode: 'yolo',
    cwd: process.cwd(),
    transcript: { enabled: false },
  })

  assert.ok(result.metrics, 'metrics attached')
  assert.equal(result.metrics.stopReason, result.stopReason)
  assert.equal(result.metrics.turns.length, result.turns)
  assert.ok(result.metrics.turns[0].ttftMs !== null)
  assert.equal(result.metrics.tokens.inputTokens, 11)
  assert.equal(result.metrics.tokens.outputTokens, 3)
  assert.ok(result.metrics.rssBytes > 0)
})

test('print: runHarnessPrint passes metrics through to the JSON envelope payload', async () => {
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: 'ok' }
      yield { type: 'response_end', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }
    },
  }

  const result = await runHarnessPrint({
    prompt: 'hi',
    provider,
    cwd: process.cwd(),
    env: {},
    permissionMode: 'agent',
    transcript: { enabled: false },
  })

  assert.ok(result.metrics, 'metrics on print result')
  assert.equal(result.metrics.turns.length, 1)
  assert.equal(result.metrics.tokens.totalTokens, 7)
})

test('metrics collector: survives malformed events without throwing', () => {
  const collector = createRunMetricsCollector()
  assert.doesNotThrow(() => {
    collector.onLoopEvent({ type: 'turn_end' })
    collector.onLoopEvent({ type: 'tool_execution_end' })
    collector.onLoopEvent(null)
  })
  const snapshot = collector.snapshot()
  assert.equal(snapshot.turns.length, 0)
})
