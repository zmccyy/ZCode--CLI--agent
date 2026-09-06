// Tests for the bounded stuck detector (P1.5): the same failing tool call
// repeating in a row gets a strategy nudge at 3 identical failures and stops
// the run at 5; successes and different calls reset the streak; `false`
// disables the detector entirely.

import test from 'node:test'
import assert from 'node:assert/strict'

import { createStuckDetector } from '../../src/harness/stuckDetector.ts'
import { runAgentLoop } from '../../src/harness/loop.ts'

function detector() {
  return createStuckDetector()
}

test('stuck detector: none below threshold, nudge at 3, stop at 5', () => {
  const d = detector()
  const fail = input => d.record({ name: 'Read', input, isError: true })

  assert.equal(fail({ a: 1 }).action, 'none')
  assert.equal(fail({ a: 1 }).action, 'none')
  const third = fail({ a: 1 })
  assert.equal(third.action, 'nudge')
  assert.equal(third.streak, 3)
  assert.match(third.message, /change strategy/)

  const fourth = fail({ a: 1 })
  assert.equal(fourth.action, 'nudge')
  const fifth = fail({ a: 1 })
  assert.equal(fifth.action, 'stop')
  assert.equal(fifth.streak, 5)
})

test('stuck detector: a success or a different call resets the streak', () => {
  const d = detector()
  const fail = input => d.record({ name: 'Read', input, isError: true })

  assert.equal(fail({ a: 1 }).action, 'none')
  assert.equal(fail({ a: 1 }).action, 'none')
  // Success resets…
  assert.deepEqual(d.record({ name: 'Read', input: { a: 1 }, isError: false }), {
    action: 'none',
    streak: 0,
  })
  assert.equal(fail({ a: 1 }).action, 'none', 'streak restarted, count 1')

  // …and so does a different input.
  assert.equal(fail({ a: 2 }).action, 'none')
  assert.equal(fail({ a: 2 }).action, 'none')
  assert.equal(fail({ a: 2 }).action, 'nudge')
})

test('stuck detector: input key order does not matter', () => {
  const d = detector()
  assert.equal(d.record({ name: 'Grep', input: { pattern: 'x', glob: '*.ts' }, isError: true }).action, 'none')
  assert.equal(d.record({ name: 'Grep', input: { glob: '*.ts', pattern: 'x' }, isError: true }).action, 'none')
  assert.equal(d.record({ name: 'Grep', input: { glob: '*.ts', pattern: 'x' }, isError: true }).action, 'nudge')
})

function makeFailingTool() {
  return {
    name: 'AlwaysFail',
    description: 'always fails (test stub)',
    readOnly: true,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async () => ({ content: 'Error: nope', isError: true }),
  }
}

function makeRepeatingToolProvider(toolName, input, turns) {
  const seenToolContents = []
  let call = 0
  return {
    id: 'stub',
    kind: 'openai',
    seenToolContents,
    streamChat: async function* (loopInput) {
      const index = call
      call += 1
      // Record what the model would see: tool results from prior turns.
      for (const message of loopInput.messages ?? []) {
        if (message.role === 'tool' && typeof message.content === 'string') {
          seenToolContents.push(message.content)
        }
      }
      yield { type: 'response_start', messageId: `m-${index}`, model: 'stub-model', provider: 'stub' }
      if (index < turns) {
        yield { type: 'tool_call', toolCall: { id: `call-${index}`, name: toolName, input } }
      }
      yield { type: 'response_end', finishReason: index < turns ? 'tool_calls' : 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  }
}

test('loop: identical failing calls get a nudge at 3 and stop the run at 5', async () => {
  const provider = makeRepeatingToolProvider('AlwaysFail', { q: 'same' }, 99)
  const result = await runAgentLoop({
    provider,
    model: 'stub-model',
    system: 'sys',
    tools: [makeFailingTool()],
    messages: [{ role: 'user', content: 'try' }],
    permissionMode: 'yolo',
    cwd: process.cwd(),
    maxTurns: 12,
    transcript: { enabled: false },
  })

  assert.equal(result.stopReason, 'stuck')
  assert.match(result.error ?? '', /Stuck detector/)
  // Nudge reached the model with the failure count.
  assert.ok(
    provider.seenToolContents.some(content => content.includes('[stuck detector]') && content.includes('failed 3 times')),
    'nudge appended to the tool result the model sees',
  )
  // The run stopped at the 5th identical failure instead of burning maxTurns.
  const stuckTurns = result.turns
  assert.ok(stuckTurns < 12, `stopped early at turn ${stuckTurns}`)
  assert.equal(result.metrics.stopReason, 'stuck')
})

test('loop: stuckDetector false disables the guard entirely', async () => {
  const provider = makeRepeatingToolProvider('AlwaysFail', { q: 'same' }, 99)
  const result = await runAgentLoop({
    provider,
    model: 'stub-model',
    system: 'sys',
    tools: [makeFailingTool()],
    messages: [{ role: 'user', content: 'try' }],
    permissionMode: 'yolo',
    cwd: process.cwd(),
    maxTurns: 7,
    stuckDetector: false,
    transcript: { enabled: false },
  })

  assert.equal(result.stopReason, 'max_turns', 'ran to the turn guardrail, not the stuck detector')
  assert.ok(!provider.seenToolContents.some(content => content.includes('[stuck detector]')))
})
