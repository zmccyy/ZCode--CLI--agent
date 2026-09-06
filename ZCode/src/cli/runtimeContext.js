/**
 * CLI runtime context — one explicit object for the per-invocation facts the
 * interactive layer needs: effective environment (settings/.env merged by
 * runCli), the workspace, the output streams, and the terminal capabilities
 * derived from them.
 *
 * Before this module, capability decisions (color on/off, Unicode glyphs vs
 * ASCII) and env defaults were scattered across tui.js/ansi.js/tuiChrome.js,
 * each falling back to process.env independently — which silently ignored the
 * CLI's effective environment. Everything terminal-shaped now derives from
 * the `env` captured here, so `NO_COLOR`/`FORCE_COLOR`/`WT_SESSION` injected
 * via settings or .env behave exactly like real environment variables.
 *
 * Pure factory, no output: callers render.
 */

import { createStyler, supportsColor } from './ansi.js'
import { supportsUnicodeChrome } from './tuiChrome.js'

/**
 * @param {object} [options]
 * @param {string} [options.cwd] workspace directory (default process.cwd()).
 * @param {object} [options.env] effective CLI environment (default process.env).
 * @param {stream.Writable} [options.stdout] (default process.stdout).
 * @param {stream.Writable} [options.stderr] (default process.stderr).
 */
export function createCliRuntime({
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const styler = createStyler(supportsColor(stdout, env))
  return Object.freeze({
    cwd,
    env,
    stdout,
    stderr,
    styler,
    /** Color decisions come from the effective env, not the host's. */
    colorEnabled: styler.enabled,
    /** Unicode block glyphs (banner/context) vs ASCII fallback. */
    unicode: supportsUnicodeChrome(env),
    /** Braille spinner frames vs ASCII. */
    spinnerFramesUnicode: Boolean(env?.WT_SESSION),
  })
}
