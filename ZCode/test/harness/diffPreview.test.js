import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { diffLines, trimHunksForPreview, renderDiffPlain, buildDiffPreviewForTool } from '../../src/cli/diffPreview.js'
import { runTui } from '../../src/cli/tui.js'

// ── diff algorithm ──

test('diff: identical text yields no changes', () => {
  const { hunks, stats } = diffLines('a\nb\nc', 'a\nb\nc')
  assert.equal(hunks.length, 0, 'no hunks for identical text')
  assert.deepEqual(stats, { added: 0, removed: 0, contextLines: 3 })
})

test('diff: pure addition appends add hunks', () => {
  const { hunks, stats } = diffLines('a\nb', 'a\nb\nc\nd')
  assert.equal(stats.added, 2)
  assert.equal(stats.removed, 0)
  const flat = hunks.flatMap(h => h.text.map(t => `${h.type}:${t}`))
  assert.deepEqual(flat, ['context:a', 'context:b', 'add:c', 'add:d'])
})

test('diff: pure removal', () => {
  const { stats } = diffLines('a\nb\nc', 'a')
  assert.equal(stats.removed, 2)
  assert.equal(stats.added, 0)
})

test('diff: modification pairs del and add', () => {
  const { hunks, stats } = diffLines('const x = 1', 'const x = 2')
  assert.equal(stats.removed, 1)
  assert.equal(stats.added, 1)
  const types = hunks.map(h => h.type)
  assert.deepEqual(types, ['del', 'add'])
})

test('diff: edit in the middle keeps surrounding context', () => {
  const { hunks } = diffLines('one\ntwo\nthree\nfour\nfive', 'one\ntwo\nTHREE\nfour\nfive')
  const flat = hunks.flatMap(h => h.text.map(t => `${h.type}:${t}`))
  assert.deepEqual(flat, [
    'context:one',
    'context:two',
    'del:three',
    'add:THREE',
    'context:four',
    'context:five',
  ])
})

test('diff: empty inputs do not crash', () => {
  const a = diffLines('', 'x')
  assert.equal(a.stats.added, 1)
  const b = diffLines('x', '')
  assert.equal(b.stats.removed, 1)
  const c = diffLines('', '')
  assert.deepEqual(c.stats, { added: 0, removed: 0, contextLines: 1 })
})

test('diff: oversized inputs are flagged, not diffed', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
  const { hunks, stats } = diffLines(big, `${big}\nmore`)
  assert.equal(hunks, null)
  assert.equal(stats.tooLarge, true)
})

// ── preview trimming & rendering ──

test('preview: trims long unchanged regions around the change', () => {
  const old = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
  const newText = old.replace('line 25', 'LINE 25')
  const { hunks } = diffLines(old, newText)
  const parts = trimHunksForPreview(hunks, { contextPadding: 3, maxLines: 40 })
  const plain = renderDiffPlain(parts)
  assert.ok(plain[0].includes('unchanged line'), 'leading fold present')
  assert.ok(plain[plain.length - 1].includes('unchanged line'), 'trailing fold present')
  assert.ok(plain.some(l => l.startsWith('- line 25')))
  assert.ok(plain.some(l => l.startsWith('+ LINE 25')))
  assert.ok(plain.length <= 40 + 2, 'within cap plus folds')
})

test('preview: returns null for unchanged text', () => {
  assert.equal(trimHunksForPreview([]), null)
  const { hunks } = diffLines('same', 'same')
  assert.equal(trimHunksForPreview(hunks), null)
})

// ── tool approval previews ──

test('approval: Edit builds a diff from old/new strings', () => {
  const preview = buildDiffPreviewForTool('Edit', {
    file_path: 'src/app.js',
    old_string: 'const port = 3000',
    new_string: 'const port = 8080',
  })
  assert.equal(preview.file, 'src/app.js')
  assert.equal(preview.kind, 'edit')
  const plain = renderDiffPlain(preview.parts)
  assert.ok(plain.some(l => l.startsWith('- const port = 3000')))
  assert.ok(plain.some(l => l.startsWith('+ const port = 8080')))
})

test('approval: Edit replace_all carries a note and identical strings are null', () => {
  const preview = buildDiffPreviewForTool('Edit', {
    file_path: 'a.js',
    old_string: 'foo',
    new_string: 'bar',
    replace_all: true,
  })
  assert.equal(preview.kind, 'edit (replace all)')
  assert.match(preview.note, /replace_all/)
  assert.equal(
    buildDiffPreviewForTool('Edit', { file_path: 'a.js', old_string: 'same', new_string: 'same' }),
    null,
  )
})

test('approval: Write new file previews content head as additions', () => {
  const content = Array.from({ length: 60 }, (_, i) => `row ${i}`).join('\n')
  const preview = buildDiffPreviewForTool('Write', { file_path: 'new.txt', content })
  assert.equal(preview.kind, 'new file')
  assert.equal(preview.parts.filter(p => p.type === 'add').length, 30)
  assert.ok(preview.parts.some(p => p.type === 'fold' && /more lines/.test(p.text)))
})

test('approval: Write overwrite diffs against the old content', () => {
  const preview = buildDiffPreviewForTool(
    'Write',
    { file_path: 'cfg.json', content: '{"a": 2}' },
    { oldContent: '{"a": 1}' },
  )
  assert.equal(preview.kind, 'overwrite')
  const plain = renderDiffPlain(preview.parts)
  assert.ok(plain.some(l => l.startsWith('- ') && l.includes('"a": 1')))
  assert.ok(plain.some(l => l.startsWith('+ ') && l.includes('"a": 2')))
})

test('approval: non-file tools and malformed inputs yield null', () => {
  assert.equal(buildDiffPreviewForTool('Bash', { command: 'ls' }), null)
  assert.equal(buildDiffPreviewForTool('Edit', { file_path: 'x' }), null)
  assert.equal(buildDiffPreviewForTool('Write', { file_path: 'x' }), null)
})

// ── TUI integration: approval renders the diff before the y/N prompt ──

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

test('TUI: Edit approval shows a colored diff before the y/N prompt', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-diff-tui-'))
  await fs.writeFile(path.join(workspace, 'app.js'), 'const port = 3000\n', 'utf8')

  const provider = createScriptedProvider([
    { toolCalls: { name: 'Read', input: { file_path: 'app.js' } } },
    { toolCalls: { name: 'Edit', input: { file_path: 'app.js', old_string: 'const port = 3000', new_string: 'const port = 8080' } } },
    { text: 'done' },
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

    stdin.write('change the port\n')
    await waitFor(out, /Edit → app\.js \(edit · \+1 −1\)/)
    await waitFor(out, /- const port = 3000/)
    await waitFor(out, /\+ const port = 8080/)
    await waitFor(out, /\[y\/N\]/)

    stdin.write('y\n')
    await waitFor(out, /done/)
    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
    // The edit actually applied.
    assert.equal(await fs.readFile(path.join(workspace, 'app.js'), 'utf8'), 'const port = 8080\n')
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('TUI: Write approval over an existing file diffs against disk content', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-diff-w-'))
  await fs.writeFile(path.join(workspace, 'cfg.txt'), 'old line\n', 'utf8')

  const provider = createScriptedProvider([
    { toolCalls: { name: 'Read', input: { file_path: 'cfg.txt' } } },
    { toolCalls: { name: 'Write', input: { file_path: 'cfg.txt', content: 'new line\n' } } },
    { text: 'written' },
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

    stdin.write('overwrite it\n')
    await waitFor(out, /Write → cfg\.txt \(overwrite · \+1 −1\)/)
    await waitFor(out, /- old line/)
    await waitFor(out, /\+ new line/)

    stdin.write('y\n')
    await waitFor(out, /written/)
    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

// ── memory budget & line caps ──

test('diff: cell budget flags pathological inputs as tooLarge before allocating', () => {
  // 2500 × 2500 distinct lines = ~6.25M DP cells > MAX_DIFF_CELLS, but each
  // side is under the 4000-line cap — only the cell budget catches this.
  const a = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n')
  const b = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n')
  const { hunks, stats } = diffLines(a, b)
  assert.equal(hunks, null)
  assert.equal(stats.tooLarge, true)
})

test('preview: single preview lines are capped so a minified line cannot flood the terminal', () => {
  const huge = 'x'.repeat(10_000)
  const preview = buildDiffPreviewForTool('Write', {
    file_path: 'bundle.js',
    content: huge,
  })
  assert.ok(preview, 'preview still renders')
  for (const part of preview.parts) {
    if (part.type !== 'fold') {
      assert.ok(part.text.length <= 241, `line capped, got ${part.text.length}`)
    }
  }

  const overwrite = buildDiffPreviewForTool('Write', {
    file_path: 'bundle.js',
    content: huge,
  }, { oldContent: `old\n${huge}` })
  assert.ok(overwrite, 'overwrite preview still renders')
  for (const part of overwrite.parts) {
    if (part.type !== 'fold') {
      assert.ok(part.text.length <= 242, `line capped, got ${part.text.length}`)
    }
  }
})
