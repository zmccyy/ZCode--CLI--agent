/**
 * Session resume — rebuild a conversation from its JSONL transcript.
 *
 * The transcript is the source of truth: `message` entries become the
 * provider-agnostic ChatMessage history, and past Read tool executions seed
 * the read-before-edit precondition for the new session.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ChatMessage } from './types.ts'

export interface SessionSummary {
  sessionId: string
  path: string
  mtimeMs: number
  sizeBytes: number
}

export interface ResumeSnapshot {
  sessionId: string
  path: string
  cwd: string | null
  model: string | null
  provider: string | null
  permissionMode: string | null
  /** Session this transcript itself resumed from, when chained. */
  resumedFrom: string | null
  messages: ChatMessage[]
  /** Files Read in the prior session (absolute paths). */
  readFiles: string[]
  skippedLines: number
}

export class ResumeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeError'
  }
}

/** All transcript files for a directory, most recently modified first. */
export async function listSessions(dir: string): Promise<SessionSummary[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const sessions: SessionSummary[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const fullPath = path.join(dir, entry.name)
    try {
      const stats = await fs.stat(fullPath)
      sessions.push({
        sessionId: entry.name.slice(0, -'.jsonl'.length),
        path: fullPath,
        mtimeMs: stats.mtimeMs,
        sizeBytes: stats.size,
      })
    } catch {
      // Unreadable entries are not resumable; skip them.
    }
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return sessions
}

export async function findLatestSession(dir: string): Promise<SessionSummary | null> {
  const sessions = await listSessions(dir)
  return sessions[0] ?? null
}

/**
 * Resolve a `--resume` reference to a transcript file path. Accepts a session
 * id (uuid or file stem) or a direct path to a .jsonl file.
 */
export async function resolveSessionPath(dir: string, ref: string): Promise<string> {
  const trimmed = ref.trim()
  if (trimmed === '') {
    throw new ResumeError('--resume requires a session id or transcript path')
  }

  if (path.isAbsolute(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
    if (trimmed.endsWith('.jsonl')) return trimmed
    return `${trimmed}.jsonl`
  }

  const candidate = path.join(dir, `${trimmed}.jsonl`)
  try {
    await fs.access(candidate)
    return candidate
  } catch {
    throw new ResumeError(
      `No transcript found for session "${trimmed}" in ${dir}. Run \`zcode sessions\` to list recent sessions.`,
    )
  }
}

function isValidMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (message.role === 'user') return typeof message.content === 'string'
  if (message.role === 'assistant') {
    return Array.isArray(message.toolCalls) || message.text === null || typeof message.text === 'string'
  }
  if (message.role === 'tool') {
    return typeof message.toolCallId === 'string' && typeof message.content === 'string'
  }
  return false
}

function resolveWorkspacePath(cwd: string | null, filePath: string): string | null {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null
  if (path.isAbsolute(filePath)) return path.normalize(filePath)
  return cwd ? path.resolve(cwd, filePath) : null
}

/**
 * Collects the files that were SUCCESSFULLY Read during a session, for the
 * read-before-edit precondition.
 *
 * Only execution facts count: a Read call seeds a file only when its tool
 * result message exists AND reports no error. A Read the model *requested*
 * but that failed, was denied, or never executed (interrupted turn) must not
 * mark the file as read — otherwise a resumed session could edit a file it
 * never actually saw. Calls and results are paired in transcript order
 * (the loop executes tool calls sequentially and appends in order).
 */
export function collectReadFilesFromMessages(
  messages: readonly ChatMessage[],
  cwd: string | null,
): Set<string> {
  const pending: Array<{ id: string | null; file: string }> = []
  const readFiles = new Set<string>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call.name !== 'Read') continue
        const input =
          call.input && typeof call.input === 'object'
            ? (call.input as Record<string, unknown>)
            : {}
        const resolved = resolveWorkspacePath(cwd, String(input.file_path ?? ''))
        if (resolved) pending.push({ id: call.id ?? null, file: resolved })
      }
      continue
    }
    if (message.role !== 'tool' || message.toolName !== 'Read') continue

    const index = pending.findIndex(
      candidate => candidate.id === null || candidate.id === message.toolCallId,
    )
    if (index === -1) continue
    const [matched] = pending.splice(index, 1)
    if (message.isError === true) continue
    readFiles.add(matched.file)
  }

  return readFiles
}

export async function loadSessionForResume(filePath: string): Promise<ResumeSnapshot> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new ResumeError(`Cannot read transcript ${filePath}: ${detail}`)
  }

  const fallbackSessionId = path.basename(filePath).replace(/\.jsonl$/, '')
  const snapshot: ResumeSnapshot = {
    sessionId: fallbackSessionId,
    path: filePath,
    cwd: null,
    model: null,
    provider: null,
    permissionMode: null,
    resumedFrom: null,
    messages: [],
    readFiles: [],
    skippedLines: 0,
  }

  const readFiles = new Set<string>()
  const lines = raw.split('\n')
  /** Messages in transcript order, for fact-based Read seeding. */
  const scannedMessages: ChatMessage[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine === '') continue

    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmedLine)
    } catch {
      snapshot.skippedLines += 1
      continue
    }

    switch (entry.type) {
      case 'session_start': {
        if (typeof entry.sessionId === 'string') snapshot.sessionId = entry.sessionId
        if (typeof entry.cwd === 'string') snapshot.cwd = entry.cwd
        if (typeof entry.model === 'string') snapshot.model = entry.model
        if (typeof entry.provider === 'string') snapshot.provider = entry.provider
        if (typeof entry.permissionMode === 'string') snapshot.permissionMode = entry.permissionMode
        if (typeof entry.resumedFrom === 'string') snapshot.resumedFrom = entry.resumedFrom
        break
      }
      case 'message': {
        const message = entry.message
        if (isValidMessage(message)) {
          snapshot.messages.push(message)
          scannedMessages.push(message)
        } else {
          snapshot.skippedLines += 1
        }
        break
      }
      case 'resumed': {
        if (typeof entry.fromSessionId === 'string' && snapshot.resumedFrom === null) {
          snapshot.resumedFrom = entry.fromSessionId
        }
        break
      }
      default:
        break
    }
  }

  if (snapshot.messages.length === 0) {
    throw new ResumeError(`Transcript ${filePath} contains no messages to resume from.`)
  }

  for (const file of collectReadFilesFromMessages(scannedMessages, snapshot.cwd)) {
    readFiles.add(file)
  }
  snapshot.readFiles = [...readFiles]
  return snapshot
}
