/**
 * Markdown code-block extraction and workspace-safe writing.
 *
 * Shared by print mode (--write) and the interactive TUI (/save); kept in its
 * own module so the TUI can use it without importing the CLI core (which
 * itself imports the TUI).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createWorkspaceBoundary, assertRealpathInsideBoundarySync } from '../harness/boundary.ts'

/**
 * Extract code blocks from markdown text. Returns an array of { language, code }.
 * Matches ```language\n...\n``` fenced blocks.
 */
export function extractCodeBlocks(text) {
  if (typeof text !== 'string' || !text) return []
  const blocks = []
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g
  for (const match of text.matchAll(regex)) {
    const language = match[1]?.trim() || ''
    const code = match[2]?.replace(/\n$/, '') || ''
    if (!code.trim()) continue
    blocks.push({ language, code })
  }
  return blocks
}

/**
 * Infer a filename from a code block's language and existing project structure.
 * Falls back to a generic name when language-specific detection fails.
 */
export function inferFilename(language, _cwd = process.cwd()) {
  const extMap = {
    js: 'module.js',
    javascript: 'module.js',
    mjs: 'module.mjs',
    cjs: 'module.cjs',
    ts: 'module.ts',
    typescript: 'module.ts',
    tsx: 'Component.tsx',
    jsx: 'Component.jsx',
    py: 'script.py',
    python: 'script.py',
    rs: 'module.rs',
    rust: 'module.rs',
    go: 'module.go',
    golang: 'module.go',
    java: 'Main.java',
    rb: 'script.rb',
    php: 'script.php',
    css: 'style.css',
    html: 'index.html',
    json: 'data.json',
    yaml: 'config.yaml',
    yml: 'config.yml',
    toml: 'config.toml',
    md: 'README.md',
    markdown: 'README.md',
    sql: 'query.sql',
    sh: 'script.sh',
    bash: 'script.sh',
    shell: 'script.sh',
    bat: 'script.bat',
    ps1: 'script.ps1',
    powershell: 'script.ps1',
    dockerfile: 'Dockerfile',
  }
  const lang = language.toLowerCase()
  // The language tag comes from model output (untrusted); keep the fallback
  // filename free of path separators so a malicious tag cannot traverse.
  const safeName = lang.replace(/[^a-z0-9_]/gi, '')
  return extMap[lang] || `output.${safeName || 'txt'}`
}

/**
 * Resolve a write target to an absolute path and refuse to write outside the
 * workspace (out-of-workspace writes are a traversal risk, and inferred names
 * come from untrusted model output).
 *
 * Two containment layers, delegated to the harness boundary so the semantics
 * can never drift from the file tools:
 * 1. lexical — the resolved path must be inside the workspace root;
 * 2. realpath — a path that is lexically inside may still resolve OUTSIDE
 *    through a symlink/junction placed inside the workspace.
 *
 * Residual race (documented, same as the harness): a symlink swapped in
 * between this check and the write is a TOCTOU window — writeCodeBlocks
 * re-verifies immediately before each write to narrow it.
 */
export function resolveWithinWorkspace(cwd, target) {
  const root = path.resolve(cwd)
  const resolved = path.resolve(root, target)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside the workspace: ${resolved}`)
  }
  try {
    assertRealpathInsideBoundarySync(createWorkspaceBoundary({ cwd: root }), resolved)
  } catch (error) {
    if (error instanceof Error && error.name === 'BoundaryError') {
      throw new Error(`Refusing to write outside the workspace (symlink escape): ${resolved}`)
    }
    throw error
  }
  return resolved
}

/** Re-verifies containment right before the actual write (TOCTOU narrowing). */
function writeVerified(targetPath, content) {
  resolveWithinWorkspace(path.dirname(targetPath), path.basename(targetPath))
  writeFileSync(targetPath, content, 'utf8')
}

/**
 * Write code blocks to files. Returns an array of written file paths.
 * If a writePath is provided (single file), writes only the first code block.
 * Exported for security regression tests.
 */
export function writeCodeBlocks(blocks, writePath, cwd = process.cwd()) {
  if (!blocks.length) return []

  const written = []

  if (writePath) {
    // Single file mode: write first block
    const block = blocks[0]
    const targetPath = resolveWithinWorkspace(cwd, writePath)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeVerified(targetPath, block.code + '\n')
    written.push(targetPath)
  } else {
    // Multi-file mode: infer filenames
    for (const block of blocks) {
      const filename = inferFilename(block.language, cwd)
      const targetPath = resolveWithinWorkspace(cwd, filename)
      mkdirSync(path.dirname(targetPath), { recursive: true })

      // Avoid overwriting: append suffix if file exists
      let finalPath = targetPath
      let counter = 1
      while (existsSync(finalPath)) {
        const ext = path.extname(targetPath)
        const base = path.basename(targetPath, ext)
        const dir = path.dirname(targetPath)
        finalPath = path.join(dir, `${base}-${counter}${ext}`)
        counter++
      }

      writeVerified(finalPath, block.code + '\n')
      written.push(finalPath)
    }
  }

  return written
}
