import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runTui } from '../../src/cli/tui.js'

function createCollector() {
  const chunks = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    }),
    text: () => chunks.join(''),
  }
}

async function waitFor(collector, pattern, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (pattern.test(collector.text())) return
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${pattern}. Buffer:\n${collector.text()}`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function createScriptedProvider(script) {
  let call = 0
  return {
    id: 'stub',
    kind: 'openai',
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* () {
      const step = script[Math.min(call, script.length - 1)]
      call += 1
      yield { type: 'response_start', messageId: `m-${call}`, model: 'stub-model', provider: 'stub' }
      if (step.toolCalls) {
        yield { type: 'tool_call', toolCall: { id: `t-${call}`, ...step.toolCalls } }
      }
      if (step.text) yield { type: 'text_delta', text: step.text }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }
    },
  }
}

test('TUI: TodoWrite renders the full colored checklist instead of truncated JSON', async () => {
  const provider = createScriptedProvider([
    {
      toolCalls: {
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'explore the workspace', status: 'completed' },
            { content: 'apply the fix', status: 'in_progress' },
            { content: 'run the suite' },
          ],
        },
      },
    },
    { text: 'tracked.' },
  ])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-todo-tui-'))

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: workspace,
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })

    stdin.write('track this work\n')
    await waitFor(out, /● TodoWrite \(3 steps\)/)
    await waitFor(out, /☒ explore the workspace/)
    await waitFor(out, /◐ apply the fix/)
    await waitFor(out, /☐ run the suite/)
    // The end event shows only the summary line — no truncated checklist dump.
    await waitFor(out, /✓ Todo list updated: 1 completed, 1 in progress, 1 pending \(3 total\)\./)
    const output = out.text()
    assert.ok(!output.includes('"status":"in_progress"'), 'no raw JSON dump of todos')
    assert.ok(!output.includes('☐ run the suite ☐'), 'no flattened preview duplication')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: malformed TodoWrite input falls back to the default rendering', async () => {
  const provider = createScriptedProvider([
    { toolCalls: { name: 'TodoWrite', input: { todos: 'not-an-array' } } },
    { text: 'ok' },
  ])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-todo-bad-'))

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: workspace,
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })

    stdin.write('try todos\n')
    // Tool errors render through the normal path.
    await waitFor(out, /todos is required and must be a non-empty array/)
    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
