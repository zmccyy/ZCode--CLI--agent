import { spawn, type ChildProcess } from 'node:child_process'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_CHARS = 30_000

export type ShellPreference = {
  /** Executable to spawn. */
  file: string
  /** Arguments placed before the command string. */
  argsPrefix: string[]
  /** Human-readable label for errors and the system prompt. */
  label: string
}

/**
 * Resolves which shell executes Bash-tool commands. Git Bash is the default
 * (its POSIX semantics are what the system prompt teaches); Windows users can
 * opt into PowerShell via ZCODE_SHELL=powershell|pwsh when Git Bash is not
 * installed. Injectable via `env` for tests.
 */
export function resolveShellPreference(env: Record<string, string | undefined> = process.env): ShellPreference {
  const requested = (env.ZCODE_SHELL ?? '').trim().toLowerCase()
  if (requested === 'powershell') {
    return { file: 'powershell', argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'], label: 'Windows PowerShell' }
  }
  if (requested === 'pwsh') {
    return { file: 'pwsh', argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'], label: 'PowerShell (pwsh)' }
  }
  return { file: 'bash', argsPrefix: ['-c'], label: 'Git Bash (bash)' }
}

/**
 * Decodes command output. Node decodes buffers as UTF-8; on Windows the
 * console code page is often GBK-family, which would turn Chinese output into
 * U+FFFD mojibake. When the UTF-8 decode shows replacement characters, retry
 * with GB18030 (a GBK superset) and keep whichever lost fewer bytes.
 */
export function decodeOutput(buffer: Buffer, platform: string = process.platform): string {
  if (buffer.length === 0) return ''
  const utf8 = buffer.toString('utf8')
  if (platform !== 'win32') return utf8
  const utf8Losses = countReplacementChars(utf8)
  if (utf8Losses === 0) return utf8
  try {
    const gb = new TextDecoder('gb18030').decode(buffer)
    if (countReplacementChars(gb) < utf8Losses) return gb
  } catch {
    // ICU without gb18030 support: keep the UTF-8 decode.
  }
  return utf8
}

function countReplacementChars(text: string): number {
  let count = 0
  for (const char of text) {
    if (char === '\uFFFD') count += 1
  }
  return count
}

interface BashParams {
  command: string
  timeoutMs: number
}

function parseParams(input: unknown): { params: BashParams } | { error: ToolResult } {
  const raw = (input ?? {}) as Record<string, unknown>

  if (typeof raw.command !== 'string' || raw.command.trim() === '') {
    return { error: { content: 'Error: command is required', isError: true } }
  }

  const requested = Number.isFinite(raw.timeout) ? (raw.timeout as number) : DEFAULT_TIMEOUT_MS
  const timeoutMs = Math.min(Math.max(requested, 1), MAX_TIMEOUT_MS)

  return { params: { command: raw.command, timeoutMs } }
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { text, truncated: false }
  }
  return {
    text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated at ${MAX_OUTPUT_CHARS} characters]`,
    truncated: true,
  }
}

interface RunOutcome {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
  spawnError: string | null
}

/**
 * Kills the shell AND its descendants. `child.kill()` only reaches the shell
 * itself; `bash -c 'sleep 30 & wait'` would leave orphans behind. On Windows
 * `taskkill /T` walks the tree; on POSIX the child is spawned detached (its
 * own process group), so a negative-pid signal reaches the whole group.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.unref()
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
}

function runBash(command: string, timeoutMs: number, context: ToolContext): Promise<RunOutcome> {
  return new Promise(resolve => {
    const abortedAlready = context.signal?.aborted === true
    if (abortedAlready) {
      resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, aborted: true, spawnError: null })
      return
    }

    const shell = resolveShellPreference()
    let child
    try {
      child = spawn(shell.file, [...shell.argsPrefix, command], {
        cwd: context.cwd,
        env: process.env,
        windowsHide: true,
        // POSIX only: makes the shell a process-group leader so the whole
        // tree can be signalled. On Windows the tree is killed via taskkill.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        aborted: false,
        spawnError: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const stdout: Buffer[] = []
    let stdoutBytes = 0
    const stderr: Buffer[] = []
    let stderrBytes = 0
    let timedOut = false
    let aborted = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)

    const onAbort = (): void => {
      if (settled) return
      aborted = true
      killTree(child)
    }
    context.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      // Cap collection well above the truncation limit so the cap itself
      // never dominates the output.
      if (stdoutBytes < MAX_OUTPUT_CHARS * 4) {
        stdout.push(chunk)
        stdoutBytes += chunk.length
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_OUTPUT_CHARS * 4) {
        stderr.push(chunk)
        stderrBytes += chunk.length
      }
    })

    const finish = (exitCode: number | null, spawnError: string | null = null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', onAbort)
      resolve({
        stdout: decodeOutput(Buffer.concat(stdout)),
        stderr: decodeOutput(Buffer.concat(stderr)),
        exitCode,
        timedOut,
        aborted,
        spawnError,
      })
    }

    child.on('error', error => {
      finish(null, error.message)
    })
    child.on('close', code => {
      finish(code)
    })
  })
}

export async function executeBash(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = parseParams(input)
  if ('error' in parsed) {
    return parsed.error
  }
  const { command, timeoutMs } = parsed.params

  const outcome = await runBash(command, timeoutMs, context)

  if (outcome.spawnError !== null) {
    const shell = resolveShellPreference()
    return {
      content:
        `Error: failed to start ${shell.label}` +
        (shell.file === 'bash' ? ' (is Git Bash installed and on PATH?)' : '') +
        `: ${outcome.spawnError}`,
      isError: true,
    }
  }

  if (outcome.aborted) {
    return {
      content:
        `Error: command aborted (cancelled) before completion.\n` +
        `stdout: ${outcome.stdout.trim() || '(empty)'}\n` +
        `stderr: ${outcome.stderr.trim() || '(empty)'}`,
      isError: true,
    }
  }

  if (outcome.timedOut) {
    return {
      content:
        `Error: command timed out after ${timeoutMs} ms and was killed.\n` +
        `stdout: ${outcome.stdout.trim() || '(empty)'}\n` +
        `stderr: ${outcome.stderr.trim() || '(empty)'}`,
      isError: true,
    }
  }

  const stdout = truncateOutput(outcome.stdout)
  const stderr = truncateOutput(outcome.stderr)

  if (outcome.exitCode === 0) {
    const parts: string[] = []
    if (stdout.text.trim() !== '') parts.push(stdout.text.replace(/\n$/, ''))
    if (stderr.text.trim() !== '') parts.push(`[stderr]\n${stderr.text.replace(/\n$/, '')}`)
    return { content: parts.join('\n') || '(no output)' }
  }

  const sections = [
    `Error: command exited with code ${outcome.exitCode}`,
    `stdout: ${stdout.text.trim() || '(empty)'}`,
    `stderr: ${stderr.text.trim() || '(empty)'}`,
  ]
  return { content: sections.join('\n'), isError: true }
}

export function createBashTool(): ToolDefinition {
  const shell = resolveShellPreference()
  return {
    name: 'Bash',
    description:
      `Executes a shell command via ${shell.label} in the workspace directory ` +
      'and returns stdout/stderr. Use for tests, builds, linters, git, and package managers — ' +
      'not for file inspection covered by Read/Glob/Grep. Non-interactive: stdin is not ' +
      'connected, so avoid commands that prompt (use `git commit -m`, `npm install --yes`, ' +
      'never editors or pagers). Output past 30,000 characters is truncated; a non-zero exit ' +
      'code returns stdout/stderr as an error result. Optional timeout in ms (default 120000, ' +
      'max 600000) — set a larger value for slow installs or test suites.' +
      (shell.file === 'bash'
        ? ' Commands use POSIX/bash syntax (Git Bash on Windows); ZCODE_SHELL=powershell switches the dialect.'
        : ` Commands use ${shell.label} syntax (set via ZCODE_SHELL).`),
    readOnly: false,
    version: 1,
    sideEffect: 'process',
    cancellable: true,
    // Internal timeout management (default 120s, max 600s) stays authoritative:
    // the loop would only double-kill, so no loop-level deadline is declared.
    outputLimitBytes: 200_000,
    idempotent: false,
    sensitive: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000)' },
        description: { type: 'string', description: 'Short human-readable description of the command' },
      },
      required: ['command'],
    },
    execute: executeBash,
  }
}
