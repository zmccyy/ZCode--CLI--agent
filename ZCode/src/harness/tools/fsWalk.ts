import { promises as fs } from 'node:fs'
import path from 'node:path'

export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
])

export interface WalkOptions {
  /** Extra directory names to prune. */
  skipDirs?: Iterable<string>
  /** Include hidden entries (dotfiles/dot-directories). Default false. */
  includeHidden?: boolean
  /** Abort walk when this many entries have been produced. */
  maxResults?: number
  signal?: AbortSignal
}

export interface WalkedEntry {
  absolutePath: string
  relativePath: string
  stats: { mtimeMs: number; size: number; isFile: boolean }
}

/**
 * Breadth-first recursive walk of a directory tree, pruning common noise
 * directories. Returns files only. Results arrive in stable depth-first order
 * (callers that need mtime sorting apply it themselves).
 */
export async function walkFiles(
  rootDir: string,
  options: WalkOptions = {},
): Promise<WalkedEntry[]> {
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(options.skipDirs ?? [])])
  const includeHidden = options.includeHidden === true
  const maxResults = options.maxResults ?? Infinity
  const results: WalkedEntry[] = []

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (results.length >= maxResults) return
    if (options.signal?.aborted) return
    if (depth > 64) return

    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const dirent of dirents) {
      if (results.length >= maxResults) return
      if (!includeHidden && dirent.name.startsWith('.')) {
        continue
      }

      const absolutePath = path.join(dir, dirent.name)
      const relativePath = path.relative(rootDir, absolutePath)

      if (dirent.isDirectory()) {
        if (skipDirs.has(dirent.name)) continue
        await visit(absolutePath, depth + 1)
        continue
      }

      if (!dirent.isFile()) continue

      let stats
      try {
        stats = await fs.stat(absolutePath)
      } catch {
        continue
      }

      results.push({
        absolutePath,
        relativePath,
        stats: {
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          isFile: stats.isFile(),
        },
      })
    }
  }

  await visit(rootDir, 0)
  return results
}
