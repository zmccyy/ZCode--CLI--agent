/**
 * Project memory — AGENTS.md / ZCODE.md discovery and injection.
 *
 * Follows the cross-tool AGENTS.md convention (agents.md spec): per-directory
 * instruction files are loaded from the workspace upward (max 3 levels, for
 * monorepo roots) plus one global file, and rendered into the system prompt.
 * Each directory's AGENTS.md wins over its ZCODE.md; files are capped to keep
 * prompt injection bounded. Discovery failures never block a run.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const MAX_PARENT_LEVELS = 3
const MAX_FILE_BYTES = 8 * 1024

/**
 * File names considered for instruction files — a fixed whitelist, never
 * derived from user or model input.
 */
const INSTRUCTION_FILE_NAMES = Object.freeze(['AGENTS.md', 'ZCODE.md'])

/**
 * Resolves `name` inside `dir` and asserts the result stays inside it. The
 * name comes from a fixed whitelist, so this is defense-in-depth: any future
 * caller passing dynamic names cannot escape the base directory.
 */
function resolveInsideDir(dir, name) {
  const base = path.resolve(dir)
  const target = path.resolve(base, name)
  if (target !== base && !target.startsWith(base + path.sep)) {
    return null
  }
  return target
}

/**
 * Reads one instruction file from a directory: AGENTS.md first, then
 * ZCODE.md. Returns { path, source, truncated } or null.
 */
async function readInstructionFile(dir, names = INSTRUCTION_FILE_NAMES) {
  for (const name of names) {
    const filePath = resolveInsideDir(dir, name)
    if (!filePath) continue
    let raw
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) continue
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const content = raw.trim()
    if (content === '') continue
    // Byte-based cap: JS string .length counts UTF-16 code units, so a file
    // full of CJK/emoji would blow far past MAX_FILE_BYTES in actual bytes.
    const byteLength = Buffer.byteLength(content, 'utf8')
    const truncated = byteLength > MAX_FILE_BYTES
    const source = truncated ? truncateUtf8(content, MAX_FILE_BYTES) : content
    return {
      path: filePath,
      source,
      truncated,
    }
  }
  return null
}

/**
 * Cuts `text` to at most `maxBytes` UTF-8 bytes without splitting a code
 * point mid-sequence (a plain Buffer slice would end in replacement chars).
 */
function truncateUtf8(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  let end = maxBytes
  // Walk back over continuation bytes (10xxxxxx) to a code-point boundary.
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return buffer.subarray(0, end).toString('utf8')
}

/** Escapes characters that would break out of a double-quoted XML attribute. */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Collects project memory for `cwd`: workspace files from cwd upward (at
 * most MAX_PARENT_LEVELS directories) plus the global ~/.zcode file.
 * Returns { files: [{ path, source, truncated, scope }], text } where text
 * is the rendered prompt block (empty when no memory exists).
 */
export async function collectProjectMemory(cwd = process.cwd(), deps = {}) {
  const home = deps.home ?? os.homedir()
  const root = deps.root ?? path.parse(path.resolve(cwd)).root
  const files = []

  let current = path.resolve(cwd)
  for (let level = 0; level <= MAX_PARENT_LEVELS; level += 1) {
    const found = await readInstructionFile(current)
    if (found) {
      found.scope = level === 0 ? 'workspace' : `parent (${current})`
      files.push(found)
    }
    const parent = path.dirname(current)
    if (parent === current || current === root) break
    current = parent
  }

  const globalHome = await readInstructionFile(path.join(home, '.zcode'))
  if (globalHome) {
    globalHome.scope = 'global (~/.zcode)'
    files.push(globalHome)
  }

  return { files, text: renderMemoryBlock(files) }
}

/** Renders the prompt block; empty string when there is no memory. */
export function renderMemoryBlock(files) {
  if (!files || files.length === 0) return ''
  const sections = files.map(
    file =>
      `<memory source="${escapeAttribute(file.path)}" scope="${escapeAttribute(file.scope)}"${file.truncated ? ' truncated="true"' : ''}>\n${file.source}\n</memory>`,
  )
  return [
    '# Project memory',
    '',
    'The following instructions come from AGENTS.md/ZCODE.md files the user maintains in this',
    'workspace (trusted configuration). Follow them when they apply; when they conflict with',
    'the current user message, the message wins.',
    '',
    ...sections,
  ].join('\n')
}
