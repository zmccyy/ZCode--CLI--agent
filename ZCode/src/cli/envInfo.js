/**
 * Environment facts for the agent system prompt: OS, local date, shell
 * availability, and the workspace's git state.
 *
 * Every probe degrades gracefully — a missing tool, a slow repo, or a probe
 * error must never block a turn. Each probe runs with a short timeout and
 * reports `null`/"unavailable" instead of throwing.
 *
 * Probes are injectable (`run`, `platform`, `env`, `now`, `os`) so tests can
 * script outcomes without spawning real processes.
 */

import { execFile } from 'node:child_process'
import os from 'node:os'

const PROBE_TIMEOUT_MS = 2000
// The default execFile maxBuffer (64KB) truncates `git status --porcelain`
// on large repos; the status probe needs more headroom than the others.
const STATUS_MAX_BUFFER = 1024 * 1024
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Runs a command, resolving { ok, stdout } instead of rejecting. */
function probeRun(command, args, cwd, { maxBuffer = 64 * 1024 } = {}) {
  return new Promise(resolve => {
    execFile(
      command,
      args,
      { cwd, timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer },
      (error, stdout) => {
        resolve({
          ok: error === null,
          stdout: typeof stdout === 'string' ? stdout : '',
        })
      },
    )
  })
}

const WEEKDAY = date => WEEKDAYS[date.getDay()]
const toDateLabel = date => `${formatLocalDate(date)} (${WEEKDAY(date)})`

function formatLocalDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function probeGit(cwd, run) {
  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], cwd)
  if (!inside.ok || inside.stdout.trim() !== 'true') return null
  const [branch, status] = await Promise.all([
    run('git', ['branch', '--show-current'], cwd),
    // -z: NUL-separated entries — filenames with newlines cannot inflate or
    // corrupt the count, and the bigger maxBuffer covers large repos.
    run('git', ['status', '--porcelain', '-z'], cwd, { maxBuffer: STATUS_MAX_BUFFER }),
  ])
  const branchName = branch.ok && branch.stdout.trim() !== '' ? branch.stdout.trim() : '(detached)'
  // dirtyCount null means the status probe failed (slow repo, maxBuffer…) —
  // reported as "unknown" so it can never masquerade as a clean tree.
  const dirtyCount = status.ok
    ? status.stdout.split('\0').filter(entry => entry.trim() !== '').length
    : null
  return { branch: branchName, dirtyCount }
}

async function probeShell(cwd, run, platform, env) {
  if (platform === 'win32') {
    // The Bash tool honors ZCODE_SHELL — report the effective dialect.
    const requested = (env.ZCODE_SHELL ?? '').trim().toLowerCase()
    if (requested === 'powershell' || requested === 'pwsh') {
      const file = requested === 'pwsh' ? 'pwsh' : 'powershell'
      const version = await run(file, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], cwd)
      const label = requested === 'pwsh' ? 'PowerShell (pwsh)' : 'Windows PowerShell'
      return version.ok ? `${label} ${version.stdout.trim()} (ZCODE_SHELL)` : `${label} (ZCODE_SHELL; probe failed)`
    }
    const bash = await run('bash', ['--version'], cwd)
    if (bash.ok) return 'Git Bash (bash)'
    const pwsh = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], cwd)
    if (pwsh.ok) return `Windows PowerShell ${pwsh.stdout.trim()}`
    return 'unavailable'
  }
  return env.SHELL ? `${env.SHELL}` : 'unavailable'
}

/**
 * Collects prompt-facing environment info for `cwd`. Never rejects: failed
 * probes are omitted or reported as null. The `git` field is null outside a
 * git work tree.
 */
export async function collectEnvironmentInfo(cwd = process.cwd(), deps = {}) {
  const run = deps.run ?? probeRun
  const platform = deps.platform ?? process.platform
  const osModule = deps.os ?? os
  const now = deps.now ?? (() => new Date())
  const shellEnv = deps.env ?? process.env

  const safeCwd = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd()

  const [git, shell] = await Promise.all([
    probeGit(safeCwd, run).catch(() => null),
    probeShell(safeCwd, run, platform, shellEnv).catch(() => 'unavailable'),
  ])

  return {
    cwd: safeCwd,
    platform,
    osType: osModule.type(),
    osRelease: osModule.release(),
    dateLabel: toDateLabel(now()),
    shell,
    git,
  }
}

/** Renders one `<environment>` line per fact; unknown facts are skipped. */
export function formatEnvironmentBlock(info) {
  const lines = [`cwd: ${info.cwd}`]
  if (info.osType) {
    lines.push(`platform: ${info.platform} (${info.osType} ${info.osRelease})`)
  } else {
    lines.push(`platform: ${info.platform}`)
  }
  if (info.dateLabel) lines.push(`date: ${info.dateLabel}`)
  if (info.shell) lines.push(`shell: ${info.shell}`)
  if (info.git) {
    const dirty =
      info.git.dirtyCount == null
        ? ' · state unknown'
        : info.git.dirtyCount > 0
          ? ` · ${info.git.dirtyCount} uncommitted file(s)`
          : ' · clean'
    lines.push(`git: on branch ${info.git.branch}${dirty}`)
  } else if (info.git === null) {
    lines.push('git: not a git repository (or git unavailable)')
  }
  return lines.join('\n')
}
