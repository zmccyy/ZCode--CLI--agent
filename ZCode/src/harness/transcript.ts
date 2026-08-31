/**
 * Session transcript — JSONL persistence for one harness session.
 *
 * Default location: ~/.zcode/projects/<cwd-hash>/<sessionId>.jsonl
 * Failure to persist is reported via the returned writer but never breaks
 * the agent loop.
 */

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
    const line = `${JSON.stringify(record)}\n`

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
