/**
 * Session transcript — JSONL persistence for one harness session.
 *
 * Default location: ~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl
 * Failure to persist is reported via the returned writer but never breaks
 * the agent loop (the loop surfaces it as a result warning).
 *
 * Sensitive values are redacted at the serialization boundary: anything that
 * looks like an API key or an auth header is replaced with [REDACTED] before
 * the line hits the disk.
 */

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Secret shapes redacted from persisted lines. Applied to the serialized
 * JSON so every string field (prompts, tool inputs/outputs, summaries) is
 * covered; replacements contain no JSON-special characters, so the line
 * stays parseable.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Common provider key prefixes (sk-…, key-…, rk-…).
  [/\b(?:sk|key|rk)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED]'],
  // Authorization / api-key style headers and env assignments.
  [/((?:authorization|auth)\s*["']?\s*[:=]\s*["']?(?:bearer\s+)?)[^\s"',}]{8,}/gi, '$1[REDACTED]'],
  [/((?:x-?api-?key|api[-_]?key|anthropic[-_]?api[-_]?key|openai[-_]?api[-_]?key)\s*["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/gi, '$1[REDACTED]'],
]

function redactSecrets(serialized: string): string {
  let output = serialized
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

export interface TranscriptEntry {
  type: string
  timestamp: string
  [key: string]: unknown
}

export interface TranscriptWriter {
  sessionId: string
  path: string | null
  enabled: boolean
  append(entry: Record<string, unknown>): void
  flush(): Promise<void>
}

export function hashCwd(cwd: string): string {
  return createHash('sha256').update(path.resolve(cwd)).digest('hex')
}

export function defaultTranscriptDir(cwd: string): string {
  return path.join(os.homedir(), '.zcode', 'projects', hashCwd(cwd))
}

export function createTranscriptWriter(options: {
  cwd: string
  enabled?: boolean
  dir?: string
  /** Bind the transcript to the loop's session id (file name). */
  sessionId?: string
}): TranscriptWriter {
  const enabled = options.enabled !== false
  const sessionId = options.sessionId ?? randomUUID()
  const dir = options.dir ?? defaultTranscriptDir(options.cwd)
  const filePath = enabled
    ? path.join(dir, `${sessionId}.jsonl`)
    : null

  let chain: Promise<void> = Promise.resolve()
  let writeError: Error | null = null
  let initialized = false

  const ensureDir = async (): Promise<void> => {
    if (initialized) return
    initialized = true
    await fs.mkdir(dir, { recursive: true })
  }

  const append = (entry: Record<string, unknown>): void => {
    if (!enabled || !filePath) return

    const record: TranscriptEntry = {
      type: 'entry',
      timestamp: new Date().toISOString(),
      ...entry,
    }
    const line = `${redactSecrets(JSON.stringify(record))}\n`

    chain = chain
      .then(async () => {
        await ensureDir()
        await fs.appendFile(filePath, line, 'utf8')
      })
      .catch(error => {
        if (!writeError) {
          writeError = error instanceof Error ? error : new Error(String(error))
        }
      })
  }

  return {
    sessionId,
    path: filePath,
    enabled,
    append,
    async flush() {
      await chain
      if (writeError) {
        throw new Error(`transcript write failed: ${writeError.message}`)
      }
    },
  }
}
