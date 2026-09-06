import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createMarkdownStream, createBlockParser, createLineSplitter, parseLineSegments, parseInlineSegments } from '../../src/cli/markdownStream.js'
import { createStyler } from '../../src/cli/ansi.js'
import { runTui } from '../../src/cli/tui.js'

// ── parser units ──

function collect(script) {
  const lines = []
  const stream = createMarkdownStream({ onLine: event => lines.push(event) })
  for (const chunk of script) stream.delta(chunk)
  stream.flush()
  return lines
}

test('markdown: deltas split mid-line are buffered into complete lines', () => {
  const lines = collect(['Hello, wor', 'ld!\nSe', 'cond line\n'])
  assert.equal(lines.length, 2)
  assert.equal(lines[0].segments[0].text, 'Hello, world!')
  assert.equal(lines[1].segments[0].text, 'Second line')
})

test('markdown: flush emits the trailing partial line exactly once', () => {
  const lines = collect(['no trailing newline'])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].segments[0].text, 'no trailing newline')
})

test('markdown: fences toggle the line mode across deltas', () => {
  const lines = collect(['```js\n', 'const a = 1\n', '```\n', 'after\n'])
  assert.deepEqual(lines.map(l => l.kind), ['fence-open', 'line', 'fence-close', 'line'])
  assert.equal(lines[1].fence, true)
  assert.equal(lines[3].fence, undefined)
})

test('markdown: unterminated fence closes on flush', () => {
  const lines = collect(['```js\nconst x = 1'])
  assert.deepEqual(lines.map(l => l.kind), ['fence-open', 'line', 'fence-close'])
  assert.equal(lines[2].unterminated, true)
})

test('markdown: headings become bold segments', () => {
  assert.deepEqual(parseLineSegments('## Summary'), [{ text: '## Summary', style: 'bold' }])
})

test('markdown: bold and inline code split into styled segments', () => {
  const segments = parseInlineSegments('use **bold** and `code` here')
  assert.deepEqual(segments, [
    { text: 'use ', style: null },
    { text: 'bold', style: 'bold' },
    { text: ' and ', style: null },
    { text: '`code`', style: 'code' },
    { text: ' here', style: null },
  ])
})

test('markdown: unmatched markers stay literal', () => {
  const segments = parseInlineSegments('a * b and ** c')
  assert.equal(segments.some(s => s.style === 'bold'), false)
  const code = parseInlineSegments('a ` b')
  assert.equal(code.some(s => s.style === 'code'), false)
})

test('markdown: flush is idempotent', () => {
  const lines = []
  const stream = createMarkdownStream({ onLine: e => lines.push(e) })
  stream.delta('one line\n')
  stream.flush()
  const count = lines.length
  stream.flush()
  stream.flush()
  assert.equal(lines.length, count)
})

test('markdown: content glued to the fence info-string renders as plain text', () => {
  // Real-model output observed in acceptance: "```txthi world" on one line.
  // The line must NOT open a fence (which would swallow the content); it and
  // the following bare ``` render verbatim.
  const lines = collect(['The result:\n', '```txthi world\n', '```\n', 'end\n'])
  assert.equal(lines[1].kind, 'line', 'glued line stays a text line')
  assert.equal(lines[1].segments[0].text, '```txthi world')
  assert.equal(lines[2].kind, 'line', 'bare ``` after a glued line renders literally')
  assert.equal(lines[2].segments[0].text, '```')
  assert.equal(lines[3].kind, 'line', "'end' stays in text mode")
})

// ── TUI integration: styled output on a TTY, passthrough without color ──

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

function createScriptedProvider(deltas) {
  return {
    id: 'stub',
    kind: 'openai',
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      for (const text of deltas) yield { type: 'text_delta', text }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }
    },
  }
}

test('TUI: fenced code renders with frame lines and styled content on a TTY', async () => {
  const provider = createScriptedProvider(['```js\n', 'const a = ', '1\n', '```\n', 'done\n'])
  const stdin = new PassThrough()
  const out = createCollector()
  out.stream.isTTY = true
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-md-tui-'))

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: workspace,
      permissionMode: 'yolo',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })

    stdin.write('show code\n')
    await waitFor(out, /┌─ code ────────/)
    await waitFor(out, /└────────────────/)
    await waitFor(out, /done/)
    const output = out.text()
    assert.ok(output.includes('\u001b[2m'), 'fence frame is dimmed')
    assert.ok(output.includes('\u001b[2m│\u001b[0m'), 'fence gutter prefix present')
    assert.ok(output.includes('\u001b[36mconst a = 1'), 'fence content styled as code')
    assert.ok(!output.includes('```js\nconst'), 'raw fence markers are not printed as-is')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: without a TTY the markdown passes through untouched', async () => {
  const provider = createScriptedProvider(['**bold** and `code`\n'])
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-md-plain-'))

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: workspace,
      permissionMode: 'yolo',
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })

    stdin.write('plain\n')
    await waitFor(out, /\*\*bold\*\* and `code`/)
    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
    assert.equal(out.text().includes('\u001b['), false, 'no ANSI codes without TTY')
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('styler: bold renders ANSI when enabled (used by heading/bold segments)', () => {
  const styler = createStyler(true)
  assert.equal(styler.bold('x'), '\u001b[1mx\u001b[0m')
})

// ── stage contracts (parser → events pipeline) ──

test('lineSplitter: buffers partial deltas and flushes the tail', () => {
  const lines = []
  const splitter = createLineSplitter({ onLine: line => lines.push(line) })
  splitter.delta('he')
  splitter.delta('llo\nwor')
  splitter.delta('ld')
  assert.deepEqual(lines, ['hello'])
  splitter.flush()
  assert.deepEqual(lines, ['hello', 'world'])
})

test('blockParser: emits the documented event protocol', () => {
  const events = []
  const parser = createBlockParser({ onEvent: e => events.push(e) })
  parser.line('# Title')
  parser.line('```js')
  parser.line('const x = 1')
  parser.line('```')
  parser.line('done')
  assert.deepEqual(events, [
    { type: 'line', segments: [{ text: '# Title', style: 'bold' }] },
    { type: 'fence-open' },
    { type: 'line', fence: true, segments: [{ text: 'const x = 1', style: 'code' }] },
    { type: 'fence-close' },
    { type: 'line', segments: [{ text: 'done', style: null }] },
  ])
})

test('blockParser: glued fence renders verbatim and its bare close closes nothing', () => {
  const events = []
  const parser = createBlockParser({ onEvent: e => events.push(e) })
  parser.line('```txthi world')
  parser.line('```')
  parser.flush()
  const kinds = events.map(e => e.type)
  assert.deepEqual(kinds, ['line', 'line'], 'no fence events at all')
  assert.equal(events[0].segments[0].text, '```txthi world')
  assert.equal(events[1].segments[0].text, '```')
})

test('blockParser: flush closes an unterminated fence for the next message', () => {
  const events = []
  const parser = createBlockParser({ onEvent: e => events.push(e) })
  parser.line('```js')
  parser.line('still in fence')
  parser.flush()
  assert.deepEqual(events.at(-1), { type: 'fence-close', unterminated: true })
  // The same parser is back in text mode: a bare ``` now OPENS a fence again
  // (i.e. the unterminated close did not leak fence state).
  parser.line('```')
  parser.flush()
  assert.deepEqual(events.slice(-2).map(e => e.type), ['fence-open', 'fence-close'])
})
