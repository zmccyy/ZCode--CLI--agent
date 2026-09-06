/**
 * Zero-dependency line-level diff for approval previews.
 *
 * Core algorithm: Myers-inspired LCS via dynamic programming over lines.
 * Approval previews are bounded (context + changes around the first edit),
 * so the O(n*m) table is fine — inputs are capped before diffing anyway.
 *
 * Pure functions only: no ANSI here, callers style the hunks.
 */

import { promises as fs } from 'node:fs'
import { createWorkspaceBoundary } from '../harness/boundary.ts'
import { resolveWorkspacePath } from '../harness/tools/read.ts'

const MAX_DIFF_LINES = 4000
// The DP table is (oldLines+1) × (newLines+1) Uint32 cells; 4000×4000 lines
// would allocate ~64MB and stall the TUI on the approval prompt. 4M cells
// (~16MB) is plenty for real edits; beyond it the preview degrades to the
// plain input line (same as the line-count cap).
const MAX_DIFF_CELLS = 4_000_000
// Approval previews render raw line text; a single minified/bundled line can
// be megabytes. Cap what the preview shows per line.
const MAX_PREVIEW_LINE_LENGTH = 240

/**
 * Splits text into lines. "\n" separators only — tool inputs and files are
 * normalized by the callers where needed. A trailing newline does not produce
 * a phantom empty line; a single empty string yields [""].
 */
export function splitLines(text) {
  if (text === '' || text === null || text === undefined) return ['']
  const lines = String(text).split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Computes a line diff between two texts.
 * Returns { hunks, stats }: hunks is an array of
 * { type: 'context'|'add'|'del', text } entries in order; stats is
 * { added, removed, contextLines }.
 */
export function diffLines(oldText, newText) {
  const a = splitLines(oldText)
  const b = splitLines(newText)

  // Fast paths.
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return {
      hunks: null,
      stats: { added: 0, removed: 0, contextLines: 0, tooLarge: true },
    }
  }
  if (oldText === newText) {
    return { hunks: [], stats: { added: 0, removed: 0, contextLines: a.length } }
  }

  // Budget the DP table before allocating it (see MAX_DIFF_CELLS above).
  if ((a.length + 1) * (b.length + 1) > MAX_DIFF_CELLS) {
    return {
      hunks: null,
      stats: { added: 0, removed: 0, contextLines: 0, tooLarge: true },
    }
  }

  // LCS length table (DP). Rows = old lines, cols = new lines.
  const rows = a.length
  const cols = b.length
  // Use flat Uint32Array for speed on larger inputs.
  const table = new Uint32Array((rows + 1) * (cols + 1))
  const at = (r, c) => r * (cols + 1) + c
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      table[at(r, c)] =
        a[r] === b[c]
          ? table[at(r + 1, c + 1)] + 1
          : Math.max(table[at(r + 1, c)], table[at(r, c + 1)])
    }
  }

  // Walk the table to emit hunks.
  const hunks = []
  let r = 0
  let c = 0
  let added = 0
  let removed = 0
  let contextLines = 0
  const push = (type, text) => {
    const last = hunks[hunks.length - 1]
    if (last && last.type === type) {
      last.text.push(text)
    } else {
      hunks.push({ type, text: [text] })
    }
  }
  while (r < rows && c < cols) {
    if (a[r] === b[c]) {
      push('context', a[r])
      contextLines += 1
      r += 1
      c += 1
    } else if (table[at(r + 1, c)] >= table[at(r, c + 1)]) {
      push('del', a[r])
      removed += 1
      r += 1
    } else {
      push('add', b[c])
      added += 1
      c += 1
    }
  }
  while (r < rows) {
    push('del', a[r])
    removed += 1
    r += 1
  }
  while (c < cols) {
    push('add', b[c])
    added += 1
    c += 1
  }

  return { hunks, stats: { added, removed, contextLines } }
}

/**
 * Trims hunks for preview: renders each change region (a maximal run of
 * changes plus `contextPadding` context lines on both sides) with fold
 * markers between them, subject to a total `maxLines` budget. Unlike a
 * first/last-change slice, two distant edits both stay visible instead of
 * spending the whole budget on the unchanged middle. Returns null when
 * nothing changed.
 */
export function trimHunksForPreview(hunks, { contextPadding = 3, maxLines = 40 } = {}) {
  if (!hunks || hunks.length === 0) return null

  const entries = hunks.flatMap(hunk =>
    hunk.text.map(text => ({ type: hunk.type, text })),
  )
  const changeIndices = entries
    .map((entry, index) => (entry.type !== 'context' ? index : -1))
    .filter(index => index !== -1)
  if (changeIndices.length === 0) return null

  // Group change indices into maximal runs, then pad each run into a region.
  const regions = []
  let runStart = changeIndices[0]
  let runEnd = changeIndices[0]
  for (const index of changeIndices.slice(1)) {
    if (index === runEnd + 1) {
      runEnd = index
    } else {
      regions.push([runStart, runEnd])
      runStart = index
      runEnd = index
    }
  }
  regions.push([runStart, runEnd])
  const padded = regions.map(([start, end]) => [
    Math.max(0, start - contextPadding),
    Math.min(entries.length, end + 1 + contextPadding),
  ])

  // Greedy selection under the line budget; the first region always renders
  // (hard-cut to the cap if it alone exceeds it, preserving the old
  // "cut around the first change" behavior).
  const selected = []
  let used = 0
  for (const [start, end] of padded) {
    const size = end - start
    if (selected.length === 0) {
      const end2 = start + Math.min(size, maxLines)
      selected.push([start, end2])
      used = end2 - start
      continue
    }
    if (used + size <= maxLines) {
      selected.push([start, end])
      used += size
    } else {
      break
    }
  }

  const parts = []
  const firstStart = selected[0][0]
  if (firstStart > 0) {
    parts.push({ type: 'fold', text: `… ${firstStart} unchanged line${firstStart === 1 ? '' : 's'} above …` })
  }
  let lastEnd = firstStart
  for (const [start, end] of selected) {
    if (start > lastEnd) {
      const gap = start - lastEnd
      parts.push({ type: 'fold', text: `… ${gap} unchanged line${gap === 1 ? '' : 's'} …` })
    }
    parts.push(...entries.slice(start, end))
    lastEnd = end
  }
  if (lastEnd < entries.length) {
    const below = entries.length - lastEnd
    parts.push({ type: 'fold', text: `… ${below} unchanged line${below === 1 ? '' : 's'} below …` })
  }
  return parts
}

/**
 * Renders trimmed diff parts as plain text lines with +/- /space prefixes
 * (no ANSI — callers add color). Fold lines use `…`.
 */
export function renderDiffPlain(parts) {
  if (!parts) return null
  return parts.map(part => {
    if (part.type === 'fold') return part.text
    if (part.type === 'add') return `+ ${part.text}`
    if (part.type === 'del') return `- ${part.text}`
    return `  ${part.text}`
  })
}

// ---------------------------------------------------------------------------
// Tool-approval previews (Edit / Write)
// ---------------------------------------------------------------------------

const WRITE_NEW_FILE_PREVIEW_LINES = 30

/** Caps one preview line; long (minified) lines get an ellipsis tail. */
function truncatePreviewLine(text) {
  return text.length > MAX_PREVIEW_LINE_LENGTH
    ? `${text.slice(0, MAX_PREVIEW_LINE_LENGTH)}…`
    : text
}

function truncateParts(parts) {
  return parts?.map(part =>
    part.type === 'fold' ? part : { ...part, text: truncatePreviewLine(part.text) },
  )
}

/**
 * Reads the existing content of a Write target for the approval preview —
 * ONLY after the path passes the same workspace boundary checks the file
 * tools use. Resolution is delegated to the harness's audited
 * `resolveWorkspacePath` (lexical + realpath containment; a symlink inside
 * the workspace may not resolve outside it). Without this, a model could
 * point the preview at a file outside the workspace and have the approval
 * prompt echo that file's contents to the terminal.
 *
 * `boundary` uses the CLI option shape: false (--no-boundary) or
 * { enabled, addDirs } — normalized here exactly like the loop does.
 *
 * Returns { oldContent, blocked, absolutePath }: blocked=true means the path
 * is outside the boundary and the content was NOT read (callers show a note
 * instead of a diff).
 */
export async function readOldContentForPreview({ toolName, input, cwd, boundary }) {
  if (toolName !== 'Write' || !input || typeof input.file_path !== 'string') {
    return { oldContent: null, blocked: false }
  }
  const wsBoundary =
    boundary === false
      ? undefined
      : createWorkspaceBoundary({
          cwd,
          addDirs: boundary?.addDirs,
          enabled: boundary?.enabled !== false,
        })
  let absolutePath
  try {
    absolutePath = await resolveWorkspacePath({ cwd, boundary: wsBoundary }, input.file_path)
  } catch {
    return { oldContent: null, blocked: true }
  }
  try {
    return { oldContent: await fs.readFile(absolutePath, 'utf8'), blocked: false, absolutePath }
  } catch {
    return { oldContent: null, blocked: false, absolutePath } // new file
  }
}

/**
 * Builds the approval preview for an Edit/Write tool call.
 *
 * - Edit: diffs old_string → new_string (raw strings, not whole files — this
 *   shows exactly what the model wants to change, which is the decision the
 *   user is making).
 * - Write over an existing file: diffs the current file content against the
 *   new content (`oldContent` is read by the caller).
 * - Write of a new file (no oldContent): shows the first lines of content as
 *   additions.
 *
 * Returns null when nothing previewable was provided. Pure & synchronous:
 * file reading stays with the caller.
 */
export function buildDiffPreviewForTool(toolName, input, { oldContent = null, maxLines = 30 } = {}) {
  if (!input || typeof input !== 'object') return null

  if (toolName === 'Edit') {
    const { file_path: file, old_string: oldString, new_string: newString, replace_all: replaceAll } = input
    if (typeof oldString !== 'string' || typeof newString !== 'string') return null
    if (oldString === newString) return null
    const { hunks, stats } = diffLines(oldString, newString)
    if (stats.tooLarge) return null
    const parts = trimHunksForPreview(hunks, { maxLines })
    return {
      file,
      kind: replaceAll === true ? 'edit (replace all)' : 'edit',
      parts: truncateParts(parts),
      stats,
      note: replaceAll === true ? 'replace_all: every occurrence of old_string is replaced.' : null,
    }
  }

  if (toolName === 'Write') {
    const { file_path: file, content } = input
    if (typeof content !== 'string') return null
    if (oldContent !== null && oldContent !== undefined) {
      if (oldContent === content) return null
      const { hunks, stats } = diffLines(oldContent, content)
      if (stats.tooLarge) return null
      return {
        file,
        kind: 'overwrite',
        parts: truncateParts(trimHunksForPreview(hunks, { maxLines })),
        stats,
        note: null,
      }
    }
    // New file: preview the head of the content as additions.
    const lines = splitLines(content)
    const shown = lines.slice(0, WRITE_NEW_FILE_PREVIEW_LINES).map(text => truncatePreviewLine(text))
    const parts = shown.map(text => ({ type: 'add', text }))
    if (lines.length > shown.length) {
      parts.push({ type: 'fold', text: `… ${lines.length - shown.length} more lines …` })
    }
    return {
      file,
      kind: 'new file',
      parts,
      stats: { added: lines.length, removed: 0, contextLines: 0 },
      note: null,
    }
  }

  return null
}

