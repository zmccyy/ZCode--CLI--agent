import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runTui } from '../../src/cli/tui.js'
import { listSessions } from '../../src/harness/index.ts'
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
      for (const [callIndex, call] of (step.toolCalls ?? []).entries()) {
        yield {
          type: 'tool_call',
          toolCall: { id: `call-${index}-${callIndex}`, name: call.name, input: call.input },
        }
      }
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

// ── P1.7 polishing loop: shell mode, tool-output expansion, rewind, title ──

test('TUI: ! runs a shell command directly and feeds its output to the model', async () => {
  const provider = createScriptedProvider([{ text: 'tests look green' }])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-shell-')

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

    // The command itself never consumes an LLM turn; the auto-response turn
    // that follows does.
    stdin.write('!node -e "console.log(\'shell-ok-12345\')"\n')
    await waitFor(out, /tests look green/)
    assert.match(out.text(), /\$ node -e/, 'command echoed')
    assert.match(out.text(), /shell-ok-12345/, 'command output printed')
    assert.match(provider.prompts[0], /shell-ok-12345/, 'output joined the model context')
    assert.match(provider.prompts[0], /!shell node -e/, 'command line joined the context')

    // Bare `!` explains itself instead of running nothing.
    stdin.write('!\n')
    await waitFor(out, /! runs a shell command directly/)
    assert.equal(provider.prompts.length, 1, 'no LLM turn for a bare `!`')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: Ctrl+O expands the last tool call beyond the 160-char live preview', async () => {
  const workspace = await createTempDir('zcode-tui-expand-')
  const longLine = 'x'.repeat(300)
  await fs.writeFile(path.join(workspace, 'long.txt'), `${longLine}\n`)
  const provider = createScriptedProvider([
    {
      toolCalls: [{ name: 'Read', input: { file_path: 'long.txt' } }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    },
    { text: 'read it', usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 } },
  ])
  const stdin = new PassThrough()
  const out = createCollector()

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

    stdin.write('read the long file\n')
    await waitFor(out, /read it/)

    stdin.emit('keypress', '', { ctrl: true, name: 'o' })
    await waitFor(out, /▸ Read/)
    assert.ok(out.text().includes(longLine), 'full 300-char output is shown')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: Esc Esc rewinds the last user message back into the editor', async () => {
  const seen = []
  const provider = {
    id: 'stub',
    kind: 'openai',
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* (input) {
      seen.push((input?.messages ?? []).map(m => m.content))
      yield { type: 'response_start', messageId: 'm', model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: `reply ${seen.length}` }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }
    },
  }
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

    stdin.write('first prompt\n')
    await waitFor(out, /reply 1/)
    stdin.write('second prompt\n')
    await waitFor(out, /reply 2/)

    // Double-Escape while idle: the last exchange goes back into the editor.
    stdin.emit('keypress', '', { name: 'escape' })
    stdin.emit('keypress', '', { name: 'escape' })
    await waitFor(out, /↩ rewound/)
    assert.match(out.text(), /\(restored prompt: second prompt/, 'prompt restored (non-TTY)')

    // The rewound exchange is gone from history; the next turn's request must
    // contain 'first' but not 'second'.
    stdin.write('third prompt\n')
    await waitFor(out, /reply 3/)
    const thirdRequest = seen[2]
    assert.ok(
      thirdRequest.some(content => String(content).includes('first prompt')),
      'earlier exchange survives',
    )
    assert.ok(
      thirdRequest.every(content => !String(content).includes('second prompt')),
      'rewound exchange is dropped',
    )

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
  }
})

test('TUI: terminal title shows the running prompt and restores on completion (TTY)', async () => {
  const provider = createScriptedProvider([{ text: 'titled done' }])
  const stdin = new PassThrough()
  const out = createCollector()
  out.stream.isTTY = true

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

    stdin.write('title me\n')
    await waitFor(out, /titled done/)
    assert.ok(
      out.text().includes('\u001b]2;● title me — ZCode\u0007'),
      'running-turn title set',
    )
    assert.ok(out.text().includes('\u001b]2;ZCode — '), 'idle title restored')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
  }
})

test('TUI: /resume loads a recorded session into the live conversation', async () => {
  const seen = []
  const provider = {
    id: 'stub',
    kind: 'openai',
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* (input) {
      seen.push((input?.messages ?? []).map(m => m.content))
      yield { type: 'response_start', messageId: 'm', model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: `reply ${seen.length}` }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }
    },
  }
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-resume-')
  const transcripts = path.join(workspace, 'transcripts')

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: workspace,
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: true, dir: transcripts },
      transcriptDir: transcripts,
    })

    // Two turns → two transcript files; each records the full conversation
    // as of that turn. The older one only knows the first exchange.
    stdin.write('first prompt\n')
    await waitFor(out, /reply 1/)
    stdin.write('second prompt\n')
    await waitFor(out, /reply 2/)
    await waitUntil(async () => (await listSessions(transcripts)).length >= 2, 5000, 'transcript files')

    stdin.write('/resume\n')
    await waitFor(out, /pick one with \/resume <n> or \/resume <id>/)

    // Entry 2 is the older session: only the first exchange (user + assistant).
    stdin.write('/resume 2\n')
    await waitFor(out, /↩ resumed/)
    assert.match(out.text(), /↩ resumed \S+ — 2 message\(s\) in context/)

    stdin.write('third prompt\n')
    await waitFor(out, /reply 3/)
    const thirdRequest = seen[2]
    assert.ok(
      thirdRequest.some(content => String(content).includes('first prompt')),
      'restored session history is in context',
    )
    assert.ok(
      thirdRequest.every(content => !String(content).includes('second prompt')),
      'the newer exchange was replaced by the restored snapshot',
    )

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: # appends durable notes to project memory and refreshes the injection', async () => {
  const provider = createScriptedProvider([{ text: 'noted' }])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await createTempDir('zcode-tui-memory-')

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

    stdin.write('# always run tests before committing\n')
    await waitFor(out, /✓ noted in AGENTS\.md/)
    const created = await fs.readFile(path.join(workspace, 'AGENTS.md'), 'utf-8')
    assert.match(created, /^# Project memory\n/)
    assert.match(created, /- always run tests before committing\n/)

    // A second note appends without gluing to the previous line. The screen
    // shows a second confirmation; the file content is asserted below.
    stdin.write('# deploy uses pnpm\n')
    await waitUntil(
      () => (out.text().match(/✓ noted in AGENTS\.md/g) ?? []).length >= 2,
      5000,
      'second memory confirmation',
    )
    const updated = await fs.readFile(path.join(workspace, 'AGENTS.md'), 'utf-8')
    assert.match(updated, /- always run tests before committing\n- deploy uses pnpm\n/)

    // /memory now sees the file, and a bare `#` explains itself.
    stdin.write('/memory\n')
    await waitFor(out, /AGENTS\.md/)
    stdin.write('#\n')
    await waitFor(out, /# saves a durable note/)
    assert.equal(provider.prompts.length, 0, 'memory notes never consume LLM turns')

    // ZCODE.md is the fallback when only it exists.
    const workspace2 = await createTempDir('zcode-tui-memory2-')
    await fs.writeFile(path.join(workspace2, 'ZCODE.md'), 'existing notes\n', 'utf-8')
    const stdin2 = new PassThrough()
    const out2 = createCollector()
    try {
      const exit2 = runTui({
        stdin: stdin2,
        stdout: out2.stream,
        stderr: out2.stream,
        provider,
        cwd: workspace2,
        permissionMode: 'agent',
        boundary: { enabled: true, addDirs: [] },
        transcript: { enabled: false },
      })
      stdin2.write('# zcode fallback\n')
      await waitFor(out2, /✓ noted in ZCODE\.md/)
      const zcode = await fs.readFile(path.join(workspace2, 'ZCODE.md'), 'utf-8')
      assert.match(zcode, /existing notes\n- zcode fallback\n/)
      stdin2.write('/exit\n')
      assert.equal(await exit2, 0)
    } finally {
      stdin2.end()
      await fs.rm(workspace2, { recursive: true, force: true })
    }

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
