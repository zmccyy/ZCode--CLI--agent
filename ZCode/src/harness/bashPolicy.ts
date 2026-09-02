/**
 * Bash command gate — allow / deny / ask.
 *
 * Trust model (deliberate, documented): the workspace boundary covers the
 * FILE tools; it cannot cover a shell. Shell commands are gated here instead:
 *
 * - deny: catastrophic patterns (sudo, rm -rf /, fork bombs, piping curl to
 *   sh, ...) are blocked outright — in every mode, YOLO included.
 * - allow: a conservative read-only first-word allowlist (cat, ls, git status,
 *   ...) runs without prompting, so Agent mode stays usable.
 * - ask: everything else goes through the normal Agent-mode approval.
 *
 * Defaults are hardcoded; `ZCODE_BASH_ALLOW` (extra safe prefixes) and
 * `ZCODE_BASH_DENY` (extra deny regexes, comma-separated) extend them.
 *
 * Known limits, stated honestly: this is a list gate, not a sandbox. It
 * cannot understand arbitrary shell semantics; obfuscated commands belong to
 * the "ask" bucket, and the human is the real gate there. A true sandbox is
 * the v2 direction (see docs/implementation-status.md).
 */

export interface BashPolicy {
  /** Command prefixes safe to auto-approve (read-only intent). */
  allow: readonly string[]
  /** Regexes matched against the whole command; a hit blocks execution. */
  deny: readonly RegExp[]
}

export type BashGateDecision = 'allow' | 'deny' | 'ask'

const DEFAULT_ALLOW: readonly string[] = Object.freeze([
  'cat',
  'ls',
  'head',
  'tail',
  'pwd',
  'wc',
  'file',
  'stat',
  'du',
  'df',
  'which',
  'grep',
  'rg',
  'diff',
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git remote',
  'git rev-parse',
  'git tag',
  'git stash list',
  'node --version',
  'node -v',
  'npm --version',
  'npm -v',
])

const DEFAULT_DENY: readonly RegExp[] = Object.freeze([
  /(^|\s)sudo\b/,
  /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b\s+(?:\/|~|\*|\.\.?)(?:\s|$|\/\*)/i,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^|]*\bof=\/dev\//,
  /(^|\s)(shutdown|reboot|halt|poweroff)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, // fork bomb
  /(curl|wget)\b[^|]*\|\s*(ba|z|da)?sh\b/i, // pipe download straight into a shell
  /\bchmod\s+(?:-R\s+)?777\s+\/(?:\s|$)/,
  /\bgit\s+push\b[^&;|]*(--force|-f)\b/,
  /\bdel\s+\/[fsq].*C:\\/i, // windows cmd recursion, in case bash launches cmd
])

function parseListEnv(value: string | undefined): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
}

/** Built-in defaults extended from the environment. */
export function resolveBashPolicy(env: Record<string, string | undefined> = process.env): BashPolicy {
  const extraAllow = parseListEnv(env.ZCODE_BASH_ALLOW)
  const extraDeny = parseListEnv(env.ZCODE_BASH_DENY)
    .map(source => {
      try {
        return new RegExp(source)
      } catch {
        return null // an invalid user regex must not crash the session
      }
    })
    .filter((regex): regex is RegExp => regex !== null)

  return {
    allow: [...DEFAULT_ALLOW, ...extraAllow],
    deny: [...DEFAULT_DENY, ...extraDeny],
  }
}

/** Segments a compound command into individual pipelines/statements. */
function splitSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\||\n)/)
    .map(segment => segment.trim())
    .filter(segment => segment !== '')
}

function isAllowlisted(segment: string, allow: readonly string[]): boolean {
  const lower = segment.toLowerCase()
  return allow.some(entry => {
    const prefix = entry.toLowerCase()
    return lower === prefix || lower.startsWith(`${prefix} `)
  })
}

/**
 * Classify a command:
 * - 'deny'  — matches a deny pattern; blocked in every mode.
 * - 'allow' — every segment is on the read-only allowlist and the command
 *             contains no redirection, command substitution, or globbing into
 *             unknown territory; safe to auto-approve.
 * - 'ask'   — everything else; Agent mode prompts, YOLO runs it.
 */
export function classifyBashCommand(command: string, policy: BashPolicy): BashGateDecision {
  const normalized = command.trim()
  if (normalized === '') return 'deny'

  if (policy.deny.some(regex => regex.test(normalized))) {
    return 'deny'
  }

  // Redirection, command substitution, and process substitution can turn a
  // "read-only" word into a write or an arbitrary execution — never allow.
  const hasWriteSemantics = /[>`]|<\(/.test(normalized)
  if (hasWriteSemantics) return 'ask'

  const segments = splitSegments(normalized)
  if (segments.length === 0) return 'ask'
  if (segments.every(segment => isAllowlisted(segment, policy.allow))) {
    return 'allow'
  }
  return 'ask'
}
