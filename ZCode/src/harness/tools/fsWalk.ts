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
  /** Abort walk once the accumulated file sizes reach this many bytes. */
  maxTotalBytes?: number
  /** Abort walk once this much wall-clock time has elapsed (ms). */
  maxWalkMs?: number
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
 *
 * Filesystem-truth rules:
 * - Symlinks/junctions are NEVER followed and never produced as entries — a
 *   link inside the workspace may point outside the boundary. Direct path
 *   access is guarded by the boundary's realpath check instead.
 * - Budgets (results/bytes/time) stop the walk early; callers cannot
 *   distinguish a truncated walk from a complete one, so tools treat the
 *   result as "up to N" rather than exhaustive.
 */
export async function walkFiles(
  rootDir: string,
  options: WalkOptions = {},
): Promise<WalkedEntry[]> {
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(options.skipDirs ?? [])])
  const includeHidden = options.includeHidden === true
  const maxResults = options.maxResults ?? Infinity
  const maxTotalBytes = options.maxTotalBytes ?? Infinity
  const startedAt = Date.now()
  const results: WalkedEntry[] = []
  let totalBytes = 0

  const outOfBudget = (): boolean =>
    results.length >= maxResults ||
    totalBytes >= maxTotalBytes ||
    (options.maxWalkMs !== undefined && Date.now() - startedAt >= options.maxWalkMs)

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (outOfBudget()) return
    if (options.signal?.aborted) return
    if (depth > 64) return

    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      // The walk root itself may be a single file — produce it as the one
      // entry instead of a silently empty result.
      if (dir === rootDir && depth === 0) {
        try {
          const stats = await fs.stat(rootDir)
          if (stats.isFile()) {
            results.push({
              absolutePath: rootDir,
              relativePath: path.basename(rootDir),
              stats: { mtimeMs: stats.mtimeMs, size: stats.size, isFile: true },
            })
          }
        } catch {
          // unreadable root: nothing to report
        }
      }
      return
    }

    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const dirent of dirents) {
      if (outOfBudget()) return
      if (options.signal?.aborted) return
      if (!includeHidden && dirent.name.startsWith('.')) {
        continue
      }

      const absolutePath = path.join(dir, dirent.name)
      const relativePath = path.relative(rootDir, absolutePath)

      // Never follow links: symlink/junction directories could escape the
      // workspace or create cycles, and link targets are out of boundary.
      if (dirent.isSymbolicLink()) continue

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

      totalBytes += stats.size
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
