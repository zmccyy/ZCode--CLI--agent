import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { guessContextLimit, renderBanner, formatContextBar, renderStatusLine, supportsUnicodeChrome, renderFrame, visibleWidth } from '../../src/cli/tuiChrome.js'
import { runTui } from '../../src/cli/tui.js'

// ── context limit lookup ──

test('chrome: context limits match known model families', () => {
  assert.equal(guessContextLimit('claude-sonnet-4-6'), 200_000)
  assert.equal(guessContextLimit('gpt-4.1-mini'), 1_000_000)
  assert.equal(guessContextLimit('gpt-4o-2024'), 128_000)
  assert.equal(guessContextLimit('deepseek-chat'), 128_000)
  assert.equal(guessContextLimit('glm-5.3-flash'), 128_000)
  assert.equal(guessContextLimit('gemini-1.5-pro-002'), 2_000_000)
  assert.equal(guessContextLimit('totally-unknown-model'), 128_000)
  assert.equal(guessContextLimit(null), 128_000)
})

// ── banner ──

test('chrome: banner pairs the pixel logo with info lines', () => {
  const rows = renderBanner({
    productName: 'ZCode',
    version: '1.6.0',
    model: 'glm-5.3-flash',
    mode: 'agent',
    cwd: 'E:\\proj',
  })
  assert.ok(rows.length >= 4)
  assert.equal(rows[0].logo, '█████')
  assert.equal(rows[0].label, '')
  assert.equal(rows[0].value, 'ZCode v1.6.0')
  assert.equal(rows[1].label, 'model')
  assert.equal(rows[1].value, 'glm-5.3-flash')
  assert.equal(rows[2].label, 'mode')
  assert.match(rows[2].value, /agent · esc interrupts/)
  assert.equal(rows[3].label, 'dir')
  assert.equal(rows[3].value, 'E:\\proj')
  // The logo is five rows; the last carries no info row.
  assert.equal(rows[4].value, '')
})

// ── inline dialog frames ──

test('chrome: renderFrame draws equal-width rules with a title and ASCII fallback', () => {
  const { top, bottom } = renderFrame({ title: 'Allow Write', contentWidth: 40, unicode: true })
  assert.match(top, /^╭─ Allow Write ─+$/)
  assert.match(bottom, /^╰─+$/)
  assert.equal(top.length, bottom.length, 'rules align exactly')

  const ascii = renderFrame({ title: 'resume', contentWidth: 30, unicode: false })
  assert.match(ascii.top, /^\+- resume -+$/)
  assert.match(ascii.bottom, /^\+-+$/)
  assert.equal(ascii.top.length, ascii.bottom.length)

  // Width caps at 72 and floors at 12; titles count toward the width.
  const wide = renderFrame({ title: 't'.repeat(90), contentWidth: 200, unicode: true })
  assert.equal(wide.top.length, 72)
  const narrow = renderFrame({ title: '', contentWidth: 2, unicode: true })
  assert.equal(narrow.top.length, narrow.bottom.length)
  assert.equal(visibleWidth('\u001b[2mhello\u001b[0m'), 5)
})

// ── context bar ──

test('chrome: context bar fills proportionally and clamps', () => {
  assert.equal(formatContextBar({ usedTokens: 0, contextLimit: 200_000 }).bar, '░░░░░░░░░░')
  assert.equal(formatContextBar({ usedTokens: 0, contextLimit: 200_000 }).percent, 0)
  const half = formatContextBar({ usedTokens: 100_000, contextLimit: 200_000 })
  assert.equal(half.percent, 50)
  assert.equal(half.bar, '▓▓▓▓▓░░░░░')
  const full = formatContextBar({ usedTokens: 250_000, contextLimit: 200_000 })
  assert.equal(full.percent, 100)
  assert.equal(full.bar, '▓▓▓▓▓▓▓▓▓▓')
})

// ── status line ──

test('chrome: status line renders model, dir, git state, and context', () => {
  const line = renderStatusLine({
    model: 'glm-5.3-flash',
    cwd: 'E:\\项目\\ZCode--CLI--agent',
    git: { branch: 'main', dirtyCount: 3 },
    usedTokens: 32_000,
    contextLimit: 128_000,
  })
  assert.match(line, /^\[glm-5\.3-flash\] \| ZCode--CLI--agent \| git:\(main\*\) \| Context /)
  assert.match(line, /▓+░* 25%/)

  const clean = renderStatusLine({
    model: 'm',
    cwd: 'C:\\repo',
    git: { branch: 'dev', dirtyCount: 0 },
    usedTokens: 0,
    contextLimit: 128_000,
  })
  assert.match(clean, /git:\(dev\) /)
  assert.match(clean, /░░░░░░░░░░ 0%/)

  const noGit = renderStatusLine({ model: 'm', cwd: 'C:\\repo', git: null, usedTokens: 0, contextLimit: 128_000 })
  assert.ok(!noGit.includes('git:('))
})

test('chrome: status line marks context as an estimate when estimated is set', () => {
  const estimated = renderStatusLine({
    model: 'm',
    cwd: 'C:\\repo',
    git: null,
    usedTokens: 32_000,
    contextLimit: 128_000,
    estimated: true,
  })
  assert.match(estimated, /Context ▓+░* ~25% \(est\.\)/)

  // Default stays exact for backward compatibility.
  const exact = renderStatusLine({ model: 'm', cwd: 'C:\\repo', git: null, usedTokens: 32_000, contextLimit: 128_000 })
  assert.match(exact, /Context ▓+░* 25%(?!.*est\.)/)
})

// ── legacy conhost degradation ──

test('chrome: supportsUnicodeChrome probes terminal capability', () => {
  assert.equal(supportsUnicodeChrome({ WT_SESSION: 'abc' }), true, 'Windows Terminal')
  assert.equal(supportsUnicodeChrome({ ConEmuANSI: 'ON' }), true, 'ConEmu')
  assert.equal(supportsUnicodeChrome({ TERM: 'xterm-256color' }), true, 'POSIX terminal')
  assert.equal(supportsUnicodeChrome({ TERM: 'dumb' }), false, 'dumb terminal')
  // Legacy conhost: no markers on win32.
  assert.equal(supportsUnicodeChrome({}), process.platform !== 'win32')
  assert.equal(supportsUnicodeChrome(null), false)
})

test('chrome: ascii mode swaps banner blocks and bar glyphs for plain characters', () => {
  const rows = renderBanner({ productName: 'ZCode', version: '1.6.0', model: 'm', mode: 'agent', cwd: 'C:\\r', unicode: false })
  assert.deepEqual(rows.map(row => row.logo), ['#####', '   # ', '  #  ', ' #   ', '#####'])

  const { bar } = formatContextBar({ usedTokens: 32_000, contextLimit: 128_000, unicode: false })
  assert.equal(bar, '###-------')

  const status = renderStatusLine({ model: 'm', cwd: 'C:\\r', git: null, usedTokens: 32_000, contextLimit: 128_000, estimated: true, unicode: false })
  assert.match(status, /Context ###------- ~25% \(est\.\)/)
})

// ── TUI integration ──

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

function createScriptedProvider() {
  return {
    id: 'stub',
    kind: 'openai',
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: 'ok' }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: { inputTokens: 16_000, outputTokens: 5, totalTokens: 16_005 },
      }
    },
  }
}

test('TUI: pixel banner renders and each turn ends with the status line', async () => {
  const provider = createScriptedProvider()
  const stdin = new PassThrough()
  const out = createCollector()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-chrome-'))

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: workspace,
      env: { WT_SESSION: 'test' }, // pin Unicode chrome regardless of host terminal
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      version: '1.6.0',
      transcript: { enabled: false },
    })

    await waitFor(out, /█████/)
    await waitFor(out, /ZCode v1\.6\.0/)

    stdin.write('hello\n')
    await waitFor(out, /Context (?:▓+)?(?:░+) ~\d+% \(est\.\)/)
    // 16k tokens on a 128k default → 13% (bar has ≥1 filled block); the bar
    // is labelled an estimate because the limit is a model-family guess.
    assert.match(out.text(), /Context ▓░░░░░░░░░ ~13% \(est\.\)/)
    // stub cwd basename appears in the status line.
    const segment = out.text().match(/\[stub-model\] \| (\S+) \|?/)
    assert.ok(segment, 'status line contains model and directory')

    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)
  } finally {
    stdin.end()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
