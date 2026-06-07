/**
 * Code block extraction utilities for ZCode.
 * Extracts fenced code blocks from markdown/text and writes them to disk.
 * Used by both the public CLI (--write flag) and available for TUI integration.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const LANG_EXT_MAP = {
  js: 'module.js',
  ts: 'module.ts',
  tsx: 'Component.tsx',
  jsx: 'Component.jsx',
  py: 'script.py',
  rs: 'module.rs',
  go: 'main.go',
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
  sql: 'query.sql',
  sh: 'script.sh',
  bat: 'script.bat',
  ps1: 'script.ps1',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
}

/**
 * Extract code blocks from markdown text.
 * @param {string} text - Markdown content
 * @returns {Array<{language: string, code: string}>}
 */
export function extractCodeBlocks(text) {
  if (typeof text !== 'string' || !text) return []
  const blocks = []
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const language = match[1]?.trim() || ''
    const code = match[2]?.replace(/\n$/, '') || ''
    if (!code.trim()) continue
    blocks.push({ language, code })
  }
  return blocks
}

/**
 * Infer a filename from language hint.
 * @param {string} language - Language identifier from code fence
 * @returns {string} - Inferred filename
 */
export function inferFilename(language) {
  const lang = language.toLowerCase()
  return LANG_EXT_MAP[lang] || `output.${lang || 'txt'}`
}

/**
 * Write code blocks to files.
 * @param {Array<{language: string, code: string}>} blocks - Extracted code blocks
 * @param {string|null} writePath - Specific file path (single-file mode) or null (auto-name)
 * @param {string} cwd - Working directory
 * @returns {string[]} - Array of written file paths
 */
export function writeCodeBlocks(blocks, writePath = null, cwd = process.cwd()) {
  if (!blocks.length) return []
  const written = []

  if (writePath) {
    const block = blocks[0]
    const targetPath = path.resolve(cwd, writePath)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, block.code + '\n', 'utf8')
    written.push(targetPath)
  } else {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const filename = writePath || inferFilename(block.language)
      let targetPath = path.resolve(cwd, filename)

      // Avoid overwriting: append suffix if file exists
      if (existsSync(targetPath)) {
        const ext = path.extname(filename)
        const base = path.basename(filename, ext)
        const dir = path.dirname(targetPath)
        let counter = 1
        while (existsSync(targetPath)) {
          targetPath = path.join(dir, `${base}-${counter}${ext}`)
          counter++
        }
      }

      mkdirSync(path.dirname(targetPath), { recursive: true })
      writeFileSync(targetPath, block.code + '\n', 'utf8')
      written.push(targetPath)
    }
  }

  return written
}

/**
 * Extract code blocks from text and write them to files.
 * Convenience wrapper combining extract + write.
 * @param {string} text - Markdown content
 * @param {string|null} writePath - Specific file path or null
 * @param {string} cwd - Working directory
 * @returns {{written: string[], blocks: Array<{language: string, code: string}>}}
 */
export function applyCodeBlocks(text, writePath = null, cwd = process.cwd()) {
  const blocks = extractCodeBlocks(text)
  const written = writeCodeBlocks(blocks, writePath, cwd)
  return { blocks, written }
}
