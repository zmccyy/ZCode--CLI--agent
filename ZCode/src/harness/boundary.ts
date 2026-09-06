/**
 * Workspace boundary — the hard wall around the file tools.
 *
 * File tools (Read/Glob/Grep/Write/Edit) may only touch paths inside the
 * boundary roots: the workspace cwd by default, plus explicitly trusted
 * directories (`--add-dir`). Paths outside resolve to an error the model can
 * react to. `--no-boundary` lifts the wall entirely — documented as the
 * escape hatch for users who truly want the old behavior.
 *
 * Trust-model note (deliberate, documented): Bash is NOT covered by this
 * boundary — a shell can write anywhere the user can. Shell commands are
 * gated by the Bash policy (allow/deny lists) instead. See
 * docs/references/api-reference.md for the honest statement of what each
 * layer does and does not guarantee.
 */

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { realpathSync } from 'node:fs'

export interface WorkspaceBoundary {
  /** When false, no path checking happens at all (--no-boundary). */
  enabled: boolean
  /** Absolute, normalized directory roots the file tools may access. */
  roots: readonly string[]
}

export function createWorkspaceBoundary(options: {
  cwd: string
  /** Extra trusted directories (CLI --add-dir). Invalid entries are ignored. */
  addDirs?: readonly (string | null | undefined)[]
  /** Defaults to true: the boundary is on unless explicitly disabled. */
  enabled?: boolean
}): WorkspaceBoundary {
  const enabled = options.enabled !== false
  const roots: string[] = [path.resolve(options.cwd)]
  for (const dir of options.addDirs ?? []) {
    if (typeof dir !== 'string' || dir.trim() === '') continue
    roots.push(path.resolve(options.cwd, dir.trim()))
  }
  return { enabled, roots }
}

/** Containment test by lexical path comparison (symlink caveat documented). */
export function isPathInsideBoundary(boundary: WorkspaceBoundary, absolutePath: string): boolean {
  if (!boundary.enabled) return true
  return containedIn(boundary.roots, absolutePath)
}

/** Segment-aware containment; case-insensitive on Windows filesystems. */
function containedIn(roots: readonly string[], target: string): boolean {
  const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value)
  const targetPath = fold(path.normalize(target))
  return roots.some(root => {
    const relative = path.relative(fold(path.normalize(root)), targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

/** Per-boundary cache of realpath'd roots (roots rarely change on disk). */
const realRootsCache = new WeakMap<WorkspaceBoundary, Promise<string[]>>()

function realpathRoots(boundary: WorkspaceBoundary): Promise<string[]> {
  let cached = realRootsCache.get(boundary)
  if (!cached) {
    cached = Promise.all(
      boundary.roots.map(async root => {
        try {
          return await fs.realpath(root)
        } catch {
          // Root vanished or cannot be resolved: fall back to its lexical form.
          return path.normalize(root)
        }
      }),
    )
    realRootsCache.set(boundary, cached)
  }
  return cached
}

/**
 * Resolves the deepest EXISTING ancestor of the path and returns its realpath
 * plus the lexical tail (segments that do not exist yet — a Write into a
 * not-yet-created directory). The tail cannot contain symlinks, so joining it
 * onto the resolved prefix is sound.
 */
async function resolveRealPrefix(
  absolutePath: string,
): Promise<{ real: string; tail: string[] }> {
  const tail: string[] = []
  let current = absolutePath
  for (;;) {
    try {
      const real = await fs.realpath(current)
      return { real, tail }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // EPERM/EACCES/etc. on the target itself: deny by containment failure
        // rather than leaking a confusing error — lexical check already ran.
        return { real: current, tail }
      }
      const parent = path.dirname(current)
      if (parent === current) {
        // Walked up to the filesystem root without resolving; treat the root
        // itself as the resolved prefix.
        return { real: current, tail }
      }
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Filesystem-truth containment: a path that is lexically inside the boundary
 * may still resolve OUTSIDE it through a symlink/junction placed inside the
 * workspace. This check follows the real path of the target (or its nearest
 * existing ancestor) and compares it against the realpath'd roots.
 *
 * Residual race (documented): a symlink swapped in between this check and the
 * subsequent read/write is a TOCTOU window; a true sandbox is the P2 direction.
 */
export async function assertRealpathInsideBoundary(
  boundary: WorkspaceBoundary | undefined,
  absolutePath: string,
): Promise<void> {
  if (!boundary || !boundary.enabled) return

  const { real, tail } = await resolveRealPrefix(absolutePath)
  const realTarget = path.normalize(path.join(real, ...tail))

  const roots = await realpathRoots(boundary)
  if (containedIn(roots, realTarget)) return
  if (containedIn(boundary.roots, realTarget)) return
  throw new BoundaryError(realTarget, boundary)
}

/**
 * Error thrown when a path escapes the boundary. The loop converts it into a
 * tool error the model can see and adapt to.
 */
export class BoundaryError extends Error {
  constructor(absolutePath: string, boundary: WorkspaceBoundary) {
    super(
      `path is outside the workspace boundary: ${absolutePath}. ` +
        `Allowed root(s): ${boundary.roots.join(', ')}. ` +
        'Work inside the workspace, or ask the user to extend it with --add-dir.',
    )
    this.name = 'BoundaryError'
  }
}

export function assertPathInsideBoundary(
  boundary: WorkspaceBoundary | undefined,
  absolutePath: string,
): void {
  if (!boundary) return
  if (isPathInsideBoundary(boundary, absolutePath)) return
  throw new BoundaryError(absolutePath, boundary)
}

/**
 * Sync twin of {@link assertRealpathInsideBoundary} for callers outside the
 * loop that write synchronously (e.g. the CLI's code-block write-back). Same
 * semantics: the path's real location — via its deepest existing ancestor,
 * since not-yet-existing segments carry no symlinks — must stay inside the
 * boundary's realpath'd roots. The residual TOCTOU window documented above
 * applies equally; re-run this right before the write to narrow it.
 */
export function assertRealpathInsideBoundarySync(
  boundary: WorkspaceBoundary | undefined,
  absolutePath: string,
): void {
  if (!boundary || !boundary.enabled) return

  const realTarget = foldPath(realpathViaExistingPrefixSync(absolutePath))
  const contained = boundary.roots.some(root => {
    let realRoot: string
    try {
      realRoot = realpathSync(root)
    } catch {
      realRoot = path.normalize(root)
    }
    return containedIn([realRoot], realTarget) || containedIn([root], realTarget)
  })
  if (!contained) throw new BoundaryError(realTarget, boundary)
}

function foldPath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/** Sync mirror of resolveRealPrefix: deepest existing ancestor + lexical tail. */
function realpathViaExistingPrefixSync(absolutePath: string): string {
  const tail: string[] = []
  let current = absolutePath
  for (;;) {
    try {
      return path.normalize(path.join(realpathSync(current), ...tail))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return path.normalize(absolutePath)
      }
      const parent = path.dirname(current)
      if (parent === current) return path.normalize(absolutePath)
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

export function describeBoundary(boundary: WorkspaceBoundary): string {
  if (!boundary.enabled) return 'disabled (--no-boundary): file tools can access the whole machine'
  return boundary.roots.join(', ')
}
