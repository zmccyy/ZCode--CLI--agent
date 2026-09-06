/**
 * TUI chrome: banner and the Claude-Code-style status line.
 *
 * Pure string builders — no colors, no output. Callers style the returned
 * lines with the styler and write them; tests assert on plain text.
 *
 * Design language (v1.7 chrome): one accent color (cyan) for brand and
 * interactive elements; green/red/yellow reserved for outcomes; dim for all
 * structural chrome (rules, labels, hints) so content speaks and chrome
 * whispers. Glyph vocabulary: ❯ prompt · ● running · ✓/✗/⚠ outcomes ·
 * ↳ detail hint · ▸ expandable · · separator.
 */

const PIXEL_LOGO = Object.freeze([
  '█████',
  '   █ ',
  '  █  ',
  ' █   ',
  '█████',
])
const PIXEL_LOGO_ASCII = Object.freeze([
  '#####',
  '   # ',
  '  #  ',
  ' #   ',
  '#####',
])

/**
 * Whether the terminal can render the Unicode block glyphs (█ ▓ ░) used by
 * the banner and the context bar. Windows Terminal and ConEmu can; legacy
 * conhost fonts often cannot, so they get the ASCII fallback — the same
 * trade the spinner already makes with its Braille frames.
 */
export function supportsUnicodeChrome(env = process.env) {
  if (!env) return false
  if (env.WT_SESSION) return true
  if (env.ConEmuANSI === 'ON') return true
  if (typeof env.TERM === 'string' && env.TERM !== '' && env.TERM !== 'dumb') return true
  return process.platform !== 'win32'
}

// Known context-window sizes (input tokens). First matching pattern wins;
// anything unknown falls back to 128k.
const CONTEXT_LIMITS = Object.freeze([
  [/(claude|anthropic)/i, 200_000],
  [/gpt-4\.1/i, 1_000_000],
  [/gpt-4o/i, 128_000],
  [/o[134]-/i, 200_000],
  [/gemini-1\.5.*pro/i, 2_000_000],
  [/gemini/i, 1_000_000],
  [/deepseek/i, 128_000],
  [/glm/i, 128_000],
  [/qwen/i, 128_000],
  [/llama/i, 128_000],
])
const DEFAULT_CONTEXT_LIMIT = 128_000

/** Best-effort context-window lookup for a model id. */
export function guessContextLimit(modelId) {
  const id = typeof modelId === 'string' ? modelId : ''
  for (const [pattern, limit] of CONTEXT_LIMITS) {
    if (pattern.test(id)) return limit
  }
  return DEFAULT_CONTEXT_LIMIT
}

/**
 * Renders the pixel-art banner as aligned { logo, label, value } rows — the
 * caller colors the logo, dims the label column, and prints the value. The
 * first row (empty label) is the product line; `unicode: false` swaps the
 * blocks for '#' (legacy conhost).
 */
export function renderBanner({ productName, version, model, mode, cwd, unicode = true }) {
  const logo = unicode ? PIXEL_LOGO : PIXEL_LOGO_ASCII
  const infoRows = [
    { label: '', value: `${productName}${version ? ` v${version}` : ''}` },
    { label: 'model', value: model ?? '(provider default)' },
    { label: 'mode', value: `${mode} · esc interrupts · /help for everything` },
    { label: 'dir', value: cwd },
  ]
  const rows = Math.max(logo.length, infoRows.length)
  const output = []
  for (let index = 0; index < rows; index += 1) {
    const info = infoRows[index] ?? null
    output.push({
      logo: logo[index] ?? '',
      label: info?.label ?? '',
      value: info?.value ?? '',
    })
  }
  return output
}

/**
 * Formats the context progress bar. Width 10; filled blocks are '▓', empty
 * are '░' ('#' and '-' without Unicode support). Percent clamps to 0..100.
 */
export function formatContextBar({ usedTokens, contextLimit, width = 10, unicode = true }) {
  const limit = contextLimit > 0 ? contextLimit : DEFAULT_CONTEXT_LIMIT
  const ratio = Math.max(0, Math.min(1, usedTokens / limit))
  const percent = Math.round(ratio * 100)
  const filled = Math.min(width, Math.max(usedTokens > 0 ? 1 : 0, Math.round(ratio * width)))
  const fill = unicode ? '▓' : '#'
  const empty = unicode ? '░' : '-'
  const bar = fill.repeat(filled) + empty.repeat(width - filled)
  return { bar, percent }
}

/**
 * Renders the per-turn status line:
 *   [model] | dir git:(main*) | Context ▓▓░░░░░░░░ 12%
 * git info is optional (null → segment omitted).
 *
 * `estimated` marks the context usage as approximate: usedTokens is the last
 * turn's reported input (the full history the model saw) and contextLimit is
 * a best-effort model-family guess, so the bar shows "~12% (est.)" instead
 * of presenting a hard number.
 */
export function renderStatusLine({ model, cwd, git, usedTokens, contextLimit, estimated = false, unicode = true }) {
  const directory = typeof cwd === 'string' ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : cwd
  const segments = [`[${model ?? 'default-model'}]`, directory]
  if (git && git.branch) {
    const dirtyMark = git.dirtyCount > 0 ? '*' : ''
    segments.push(`git:(${git.branch}${dirtyMark})`)
  }
  const { bar, percent } = formatContextBar({ usedTokens, contextLimit, unicode })
  const context = estimated ? `Context ${bar} ~${percent}% (est.)` : `Context ${bar} ${percent}%`
  return `${segments.join(' | ')} | ${context}`
}
