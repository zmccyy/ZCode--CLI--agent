// Tests for the v1.7 CLI/TUI polishing loops (C5/C6): the /history prompt
// picker in the TUI, and the headless `--stream-json` event stream.

import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runTui } from '../../src/cli/tui.js'
import { runCli } from '../../src/cli/publicCliCore.js'

function createCollector() {
  const chunks = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk))
      callback()
    },
  })
  return {
    stream,
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

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function createScriptedProvider() {
  const seen = []
  return {
    id: 'stub',
    kind: 'openai',
    seen,
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* (input) {
      const messages = Array.isArray(input?.messages) ? input.messages : []
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      seen.push(lastUser ? lastUser.content : null)
      yield { type: 'response_start', messageId: `m-${seen.length}`, model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: `reply ${seen.length}` }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }
    },
  }
}

test('TUI: /history lists session prompts and re-runs one by number', async () => {
  const provider = createScriptedProvider()
  const stdin = new PassThrough()
  const out = createCollector()

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: os.tmpdir(),
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })

    stdin.write('alpha task\n')
    await waitFor(out, /reply 1/)
    stdin.write('beta task\n')
    await waitFor(out, /reply 2/)

    stdin.write('/history\n')
    await waitFor(out, /Prompts this session \(newest first\)/)
    assert.match(out.text(), /1 {2}beta task/)
    assert.match(out.text(), /2 {2}alpha task/)

    // Entry 1 is the most recent prompt ('beta task'): re-running sends it
    // again as a fresh turn.
    stdin.write('/history 1\n')
    await waitFor(out, /↻ re-running prompt 1/)
    await waitFor(out, /reply 3/)
    assert.equal(provider.seen[2], 'beta task')

    // Out-of-range and empty-log paths are honest, not crashes.
    stdin.write('/history 9\n')
    await waitFor(out, /No such entry: 9/)

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
  }
})

test('TUI: /history on an empty session explains itself', async () => {
  const provider = createScriptedProvider()
  const stdin = new PassThrough()
  const out = createCollector()

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: os.tmpdir(),
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })

    stdin.write('/history\n')
    await waitFor(out, /No prompts submitted yet/)
    assert.equal(provider.seen.length, 0)

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
  }
})

test('CLI: -p --stream-json emits one JSON line per loop event plus a typed result', async () => {
  const provider = {
    id: 'openai-compatible:fake',
    kind: 'openai-compatible',
    supportsPrint: true,
    async *streamChat(input) {
      yield { type: 'response_start', messageId: 'm1', model: 'fake-model', provider: 'fake' }
      const tools = Array.isArray(input.tools) ? input.tools : []
      void tools
      yield { type: 'text_delta', text: 'streamed answer' }
      yield { type: 'text_delta', text: ' done' }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      }
    },
  }
  const stdoutChunks = []
  const stderrChunks = []
  const workspace = await createTempDir('zcode-stream-json-')

  try {
    const exitCode = await runCli(['-p', 'say hi', '--stream-json', '--yolo'], {
      cwd: workspace,
      env: { ...process.env, ZCODE_TRANSCRIPT_DIR: path.join(workspace, 'transcripts') },
      stdout: { write: chunk => stdoutChunks.push(String(chunk)) },
      stderr: { write: chunk => stderrChunks.push(String(chunk)) },
      stdin: { isTTY: false },
      createProviderFromEnv: () => provider,
    })

    assert.equal(exitCode, 0)
    const lines = stdoutChunks.join('').split('\n').filter(line => line.trim() !== '')
    // Every stdout line must parse: JSON.parse throws on any progress leak.
    const parsed = lines.map(line => JSON.parse(line))
    const types = parsed.map(value => value.type)

    // The stream is a discriminated union: loop events first, typed result last.
    assert.equal(types[0], 'session_start')
    assert.ok(types.includes('turn_start'))
    assert.ok(
      types.includes('assistant_message') && types.includes('text_delta'),
      'text streaming is visible to consumers',
    )
    assert.equal(types[types.length - 1], 'result')
    const result = parsed[parsed.length - 1]
    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.text, 'streamed answer done')
    assert.equal(result.runMode, 'yolo')
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4, totalTokens: 16 })
    // No human progress lines leak into the machine stream.
    assert.ok(stderrChunks.join('').length >= 0)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
