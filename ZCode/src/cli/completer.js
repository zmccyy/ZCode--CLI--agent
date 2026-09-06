/**
 * Readline completion for the TUI input line.
 *
 * - line starts with "/": completes slash commands (with a short hint each).
 * - last word starts with "@": completes workspace file paths as
 *   `@<relative/path> ` (async shallow walk, cached for the session,
 *   newest-first, capped) — the relative path kills same-basename ambiguity.
 * - anything else: no completion.
 *
 * Readline contract (verified against Node 24's _tabComplete): the second
 * element of the returned pair is the already-typed region the completions
 * REPLACE — it must be a suffix of the line, and completions replace it as a
 * whole. Returning the last word (not the whole line) is what makes mid-line
 * completion keep the text before it.
 *
 * Pure factory: the file lister is injected for tests.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SLASH_COMMANDS = Object.freeze([
  { name: '/help', hint: 'Show available commands' },
  { name: '/clear', hint: 'Start a fresh conversation' },
  { name: '/compact', hint: 'Summarize older history now' },
  { name: '/sessions', hint: 'List recent sessions' },
  { name: '/cost', hint: 'Token totals and estimated cost' },
  { name: '/model', hint: 'List or switch the model' },
  { name: '/mode', hint: 'Show or set plan/agent/yolo' },
  { name: '/reasoning', hint: 'Toggle reasoning display' },
  { name: '/save', hint: 'Save code blocks from the last reply' },
  { name: '/memory', hint: 'Show injected project memory' },
  { name: '/exit', hint: 'Leave the session' },
])

const MAX_FILE_COMPLETIONS = 50
const MAX_WALK_FILES = 2000
const MAX_WALK_DEPTH = 6
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])

/**
 * Shallow recursive walk for completion candidates. Returns workspace-relative
 * paths with forward slashes. Skips heavy directories, caps total files and
 * real directory depth; errors degrade to an empty list.
 */
export async function listWorkspaceFiles(cwd, deps = {}) {
  const fsModule = deps.fs ?? fs
  const results = []
  const walk = async (dir, prefix, depth) => {
    if (results.length >= MAX_WALK_FILES) return
    let entries
    try {
      entries = await fsModule.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= MAX_WALK_FILES) return
      if (entry.isFile()) {
        // Workspace-relative, separator-normalized (readline completes plain
        // text; forward slashes keep candidates unambiguous across platforms).
        results.push(prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        if (depth + 1 > MAX_WALK_DEPTH) continue
        await walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1)
      }
    }
  }
  await walk(cwd, '', 0)
  return results
}

/**
 * Creates the readline completer callback.
 * readline calls completer(line) → [[completions], rest] (sync or callback).
 * Completions replace the returned `rest` region of the line — the last word
 * for file paths, the whole line for slash commands.
 *
 * Callback API on purpose: Node 24's readline applies PROMISE results by
 * displaying them but never inserting into the line (verified experimentally);
 * the callback form is the one that actually completes. Without a callback
 * the same result is returned as a Promise for direct callers/tests.
 */
export function createCompleter({ cwd, listFiles = listWorkspaceFiles } = {}) {
  let fileCache = null
  let cacheTime = 0
  const CACHE_TTL_MS = 30_000

  const getFileCandidates = async () => {
    const now = Date.now()
    if (fileCache === null || now - cacheTime > CACHE_TTL_MS) {
      fileCache = await listFiles(cwd)
      cacheTime = now
    }
    return fileCache
  }

  const complete = async line => {
    if (line.startsWith('/')) {
      const token = line.slice(1).toLowerCase()
      const matches = SLASH_COMMANDS.filter(command => command.name.slice(1).startsWith(token))
      return [matches.map(command => command.name), line]
    }
    const lastWord = line.match(/(\S+)$/)?.[1] ?? ''
    if (lastWord.startsWith('@')) {
      const token = lastWord.slice(1)
      const files = await getFileCandidates()
      const lowerToken = token.toLowerCase()
      // Prefix hits rank above substring hits (typing "src" should offer
      // "src/…" before "x/src-helper.js"); ties break by match position then
      // alphabetically for stable, predictable ordering.
      const rank = file => {
        const lower = file.toLowerCase()
        if (lower.startsWith(lowerToken)) return 0
        const at = lower.indexOf(lowerToken)
        return at === -1 ? Number.MAX_SAFE_INTEGER : 1 + Math.min(at, 1000)
      }
      const matches = files
        .filter(file => file.toLowerCase().includes(lowerToken))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .slice(0, MAX_FILE_COMPLETIONS)
      // Completions must start with the region they replace: keep the "@",
      // use the full relative path, and end with a space so typing can go on.
      return [matches.map(file => `@${file} `), lastWord]
    }
    return [[], line]
  }

  return (line, callback) => {
    if (typeof callback === 'function') {
      complete(line).then(
        result => callback(null, result),
        () => callback(null, [[], line]),
      )
      return
    }
    return complete(line)
  }
}
