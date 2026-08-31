import { spawn } from 'node:child_process'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_CHARS = 30_000

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
  spawnError: string | null
}

function runBash(command: string, timeoutMs: number, context: ToolContext): Promise<RunOutcome> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn('bash', ['-c', command], {
        cwd: context.cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error),
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // process may already be gone
      }
    }, timeoutMs)

    child.stdout?.on('data', chunk => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += String(chunk)
    })

    const finish = (exitCode: number | null, spawnError: string | null = null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode, timedOut, spawnError })
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
    return {
      content: `Error: failed to start bash (is Git Bash installed and on PATH?): ${outcome.spawnError}`,
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
  return {
    name: 'Bash',
    description:
      'Executes a shell command via bash -c (Git Bash on Windows) in the workspace directory. ' +
      'Use for running tests, builds, and git. Optional timeout in ms (default 120000, max 600000). ' +
      'Returns stdout and stderr; a non-zero exit code is reported as an error.',
    readOnly: false,
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
