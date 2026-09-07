/**
 * TUI theme — the single palette file (v1.7.1 design language).
 *
 * Every render call site uses SEMANTIC tokens, never raw colors:
 *   accent   brand + interactive elements (prompt ❯, logo, spinner dot)
 *   success / danger / warning   outcome glyphs and text only
 *   chrome   all structural UI — rules, labels, hints, previews
 *   emphasis bold-weight words (tool names, [y/N])
 *
 * The palette maps tokens onto the styler per terminal mode:
 *   dark (default)  chrome = faint (2)
 *   light           chrome = mid-gray (90) — faint is nearly invisible on
 *                   white; everything else keeps its hue.
 *
 * Mode resolution: ZCODE_THEME=dark|light wins, then the COLORFGBG
 * heuristic ("fg;bg" — background codes 7..15 are light), else dark.
 * Pure token mapping — no I/O, no output; unit-testable.
 */

export function resolveThemeMode(env = process.env) {
  const explicit = typeof env?.ZCODE_THEME === 'string' ? env.ZCODE_THEME.trim().toLowerCase() : ''
  if (explicit === 'light') return 'light'
  if (explicit === 'dark') return 'dark'
  const colorfgbg = typeof env?.COLORFGBG === 'string' ? env.COLORFGBG : ''
  const bg = Number.parseInt(colorfgbg.split(';')[1] ?? '', 10)
  if (Number.isFinite(bg) && bg >= 7 && bg <= 15) return 'light'
  return 'dark'
}

export function createTuiTheme(styler, mode = 'dark') {
  return {
    mode,
    accent: t => styler.cyan(t),
    success: t => styler.green(t),
    danger: t => styler.red(t),
    warning: t => styler.yellow(t),
    chrome: mode === 'light' ? t => styler.gray(t) : t => styler.dim(t),
    emphasis: t => styler.bold(t),
    /**
     * Context-window load coloring: calm until half, warn past half, alarm
     * near the (estimated) limit.
     */
    contextLoad: percent => {
      if (!Number.isFinite(percent)) return t => styler.dim(t)
      if (percent >= 80) return t => styler.red(t)
      if (percent >= 50) return t => styler.yellow(t)
      return t => styler.cyan(t)
    },
  }
}

/** Identity theme for un-styled (headless or NO_COLOR) output. */
export function createPlainTheme() {
  const identity = t => t
  return {
    mode: 'plain',
    accent: identity,
    success: identity,
    danger: identity,
    warning: identity,
    chrome: identity,
    emphasis: identity,
    contextLoad: () => identity,
  }
}
