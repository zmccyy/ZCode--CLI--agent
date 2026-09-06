import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runTui } from '../../src/cli/tui.js'
import { supportsColor, createStyler, ERASE_LINE } from '../../src/cli/ansi.js'

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

async function waitUntil(condition, timeoutMs = 5000, message = 'condition') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (condition()) return
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

/**
 * Scripted stub provider. Script entries are either { text, usage } (a normal
 * streaming turn) or a function `(signal) => async generator` for custom
 * scenarios (e.g. hang until aborted). Records the user prompts it saw.
 */
function createScriptedProvider(script) {
  const prompts = []
  let call = 0
  return {
    id: 'stub',
    kind: 'openai',
    prompts,
    listModels: () => [{ id: 'stub-model' }, { id: 'stub-2' }],
    streamChat: async function* (input) {
      const index = call
      call += 1
      const messages = Array.isArray(input?.messages) ? input.messages : []
      const lastUser = [...messages].reverse().find(message => message.role === 'user')
      prompts.push(lastUser ? lastUser.content : null)
      const step = script[Math.min(index, script.length - 1)]
      if (typeof step === 'function') {
        yield* step(input.signal)
        return
      }
      yield { type: 'response_start', messageId: `m-${index}`, model: 'stub-model', provider: 'stub' }
      if (step.text) yield { type: 'text_delta', text: step.text }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: step.usage ?? { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }
    },
  }
}

test('ansi: supportsColor honors TTY, NO_COLOR, and FORCE_COLOR', () => {
  const tty = { isTTY: true }
  assert.equal(supportsColor(tty, {}), true)
  assert.equal(supportsColor({ isTTY: false }, {}), false)
  assert.equal(supportsColor(undefined, {}), false)
  assert.equal(supportsColor(tty, { NO_COLOR: '1' }), false)
  assert.equal(supportsColor(tty, { NO_COLOR: '0' }), true)
  assert.equal(supportsColor({ isTTY: false }, { FORCE_COLOR: '1' }), false, 'FORCE_COLOR never fakes a TTY')
})

test('ansi: styler degrades to plain strings when disabled', () => {
  const plain = createStyler(false)
  assert.equal(plain.red('x'), 'x')
  assert.equal(plain.bold(''), '')
  const styled = createStyler(true)
  assert.equal(styled.red('x'), '\u001b[31mx\u001b[0m')
  assert.equal(styled.red(42), 42, 'non-string passthrough')
})

test('TUI: Esc interrupts a running turn and the session stays usable', async () => {
  const provider = createScriptedProvider([
    signal =>
      async function* () {
        yield { type: 'response_start', messageId: 'm-hang', model: 'stub-model', provider: 'stub' }
        yield { type: 'text_delta', text: 'partial output' }
        await new Promise(resolve => {
          if (signal?.aborted) return resolve()
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        // Stream ends without response_end while aborted — the loop must
        // classify this as aborted, never end_turn.
      },
    { text: 'after interrupt' },
  ])

  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-esc-')

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

    stdin.write('first task\n')
    await waitUntil(() => provider.prompts.length === 1)
    stdin.emit('keypress', '', { name: 'escape' })
    await waitFor(out, /stopped/)
    assert.doesNotMatch(out.text(), /end_turn/)

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: queued lines typed during a run are noticed and auto-sent', async () => {
  const provider = createScriptedProvider([
    signal =>
      async function* () {
        yield { type: 'response_start', messageId: 'm-hang', model: 'stub-model', provider: 'stub' }
        await new Promise(resolve => {
          if (signal?.aborted) return resolve()
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    { text: 'second task done' },
  ])

  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-queue-')

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

    stdin.write('first task\n')
    await waitUntil(() => provider.prompts.length === 1)
    stdin.write('second task\n')
    stdin.emit('keypress', '', { name: 'escape' })
    await waitFor(out, /1 line\(s\) typed during the run/)
    await waitFor(out, /second task done/)
    assert.equal(provider.prompts[1], 'second task', 'queued line became the next prompt')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: Shift+Tab cycles permission modes when idle', async () => {
  const provider = createScriptedProvider([{ text: 'unused' }])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-modes-')

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
    await waitFor(out, /mode: agent/)

    stdin.emit('keypress', '', { name: 'tab', shift: true })
    await waitFor(out, /mode: plan/)
    stdin.emit('keypress', '', { name: 'tab', shift: true })
    await waitFor(out, /mode: yolo/)
    await waitFor(out, /actions run without approval/)
    stdin.emit('keypress', '', { name: 'tab', shift: true })
    await waitFor(out, /mode: agent/)

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: /model lists and switches, /mode sets, /reasoning toggles', async () => {
  const provider = createScriptedProvider([])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-slash-')

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

    stdin.write('/model\n')
    await waitFor(out, /Models for stub/)
    assert.match(out.text(), /stub-model/)
    assert.match(out.text(), /stub-2/)

    stdin.write('/model stub-2\n')
    await waitFor(out, /model: stub-2 \(applies from the next message\)/)

    stdin.write('/model nope\n')
    await waitFor(out, /Unknown model: nope/)

    stdin.write('/mode yolo\n')
    await waitFor(out, /mode: yolo/)
    stdin.write('/mode bogus\n')
    await waitFor(out, /Unknown mode: bogus/)
    stdin.write('/mode\n')
    await waitFor(out, /Shift\+Tab cycles/)

    stdin.write('/reasoning\n')
    await waitFor(out, /reasoning display: on/)
    stdin.write('/reasoning\n')
    await waitFor(out, /reasoning display: off/)

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: trailing backslash continues input across lines', async () => {
  const provider = createScriptedProvider([{ text: 'ok' }])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-multi-')

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

    stdin.write('fix the bug in \\\n')
    await waitFor(out, /You >/)
    stdin.write('src/app.ts\n')
    await waitFor(out, /ok/)

    assert.equal(provider.prompts[0], 'fix the bug in \nsrc/app.ts'.trim(), 'prompt joined across lines')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: /save writes code blocks from the last reply', async () => {
  const provider = createScriptedProvider([
    { text: 'Here you go:\n```js\nconsole.log(1)\n```\nand\n```python\nprint(2)\n```' },
  ])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-save-')

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

    stdin.write('give me two snippets\n')
    await waitFor(out, /Here you go/)
    stdin.write('/save\n')
    await waitFor(out, /saved: /)
    assert.equal(await fs.readFile(path.join(workspace, 'module.js'), 'utf8'), 'console.log(1)\n')
    assert.equal(await fs.readFile(path.join(workspace, 'script.py'), 'utf8'), 'print(2)\n')

    stdin.write('/save first-block.txt\n')
    await waitFor(out, /saved: /)
    assert.equal(
      await fs.readFile(path.join(workspace, 'first-block.txt'), 'utf8'),
      'console.log(1)\n',
    )

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: status line renders on a TTY and is erased on first event', async () => {
  const provider = createScriptedProvider([{ text: 'done fast' }])
  const stdin = new PassThrough()
  const out = createCollector()
  out.stream.isTTY = true
  const workspace = await createTempDir('zcode-tui-status-')

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

    stdin.write('hello status line\n')
    await waitFor(out, /done fast/)
    // The spinner starts during the env/memory probes and switches its label
    // to "working" for the model stream; a fast turn may only show the first
    // label, so accept either.
    assert.match(
      out.text(),
      /(reading workspace state|working) — Esc \/ Ctrl\+C to interrupt/,
    )
    assert.match(out.text(), /agent mode · \d+s/)
    assert.ok(out.text().includes(ERASE_LINE), 'status line was erased')
    // Colored tool/status output must include ANSI when TTY.
    assert.ok(out.text().includes('\u001b[2m'))

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
