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
  const target = path.normalize(absolutePath)
  return boundary.roots.some(root => {
    const relative = path.relative(root, target)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
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

export function describeBoundary(boundary: WorkspaceBoundary): string {
  if (!boundary.enabled) return 'disabled (--no-boundary): file tools can access the whole machine'
  return boundary.roots.join(', ')
}
