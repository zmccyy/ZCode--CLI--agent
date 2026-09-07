/**
 * Zero-dependency ANSI styling for the interactive TUI.
 *
 * `supportsColor` mirrors the de-facto standard: color only on a TTY,
 * NO_COLOR disables, FORCE_COLOR forces on. The styler degrades to plain
 * strings when disabled, so every call site can style unconditionally.
 *
 * Windows note: Node/libuv enables VT processing on TTY handles (Windows 10+),
 * so raw ANSI escape sequences are safe on both Windows Terminal and conhost.
 */

/** Decides whether ANSI color should be used for the given output stream. */
export function supportsColor(stream, env = process.env) {
  if (!stream || stream.isTTY !== true) return false
  if (typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '' && env.NO_COLOR !== '0') return false
  if (typeof env.FORCE_COLOR === 'string' && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') {
    return true
  }
  return true
}

/**
 * Creates a styling helper. When disabled (or the input is not a string),
 * returns the text unchanged — callers never branch on `enabled`.
 */
export function createStyler(enabled) {
  const wrap = code => text => {
    if (!enabled || typeof text !== 'string' || text === '') return text
    return `\u001b[${code}m${text}\u001b[0m`
  }
  return {
    enabled: enabled === true,
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
    magenta: wrap(35),
    /** Mid-gray (bright black): the light theme's chrome color — faint text
     * (2) is nearly invisible on white backgrounds. */
    gray: wrap(90),
  }
}

/** Erases the current line the cursor is on (used to remove the status line). */
export const ERASE_LINE = '\u001b[2K\r'
