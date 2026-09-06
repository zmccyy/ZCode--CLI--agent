import { promises as fs } from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'
import { walkFiles } from './fsWalk.ts'
import { resolveWorkspacePath, toErrorResult } from './read.ts'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_LINES = 2000

interface GrepParams {
  regex: RegExp
  searchDir: string
  glob: string | null
  outputMode: 'files_with_matches' | 'content' | 'count'
  showLineNumbers: boolean
  contextBefore: number
  contextAfter: number
  headLimit: number | null
  multiline: boolean
}

async function parseParams(input: unknown, context: ToolContext): Promise<{ params: GrepParams } | { error: ToolResult }> {
  const raw = (input ?? {}) as Record<string, unknown>

  if (typeof raw.pattern !== 'string' || raw.pattern === '') {
    return { error: { content: 'Error: pattern is required', isError: true } }
  }

  let regex: RegExp
  try {
    regex = new RegExp(raw.pattern, raw['-i'] === true ? 'i' : '')
  } catch (error) {
    return {
      error: {
        content: `Error: invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      },
    }
  }

  const outputMode =
    raw.output_mode === 'content' || raw.output_mode === 'count'
      ? raw.output_mode
      : 'files_with_matches'

  let searchDir: string
  try {
    searchDir =
      typeof raw.path === 'string' && raw.path.trim() !== ''
        ? await resolveWorkspacePath(context, raw.path)
        : context.cwd
  } catch (error) {
    return { error: toErrorResult(error) }
  }

  const contextBoth = Number.isFinite(raw['-C']) ? Math.min(Math.floor(raw['-C'] as number), 20) : 0

  return {
    params: {
      regex,
      searchDir,
      glob: typeof raw.glob === 'string' && raw.glob !== '' ? raw.glob : null,
      outputMode,
      showLineNumbers: outputMode === 'content' && raw['-n'] !== false,
      contextBefore: Number.isFinite(raw['-B']) ? Math.min(Math.floor(raw['-B'] as number), 20) : contextBoth,
      contextAfter: Number.isFinite(raw['-A']) ? Math.min(Math.floor(raw['-A'] as number), 20) : contextBoth,
      headLimit: Number.isFinite(raw.head_limit) ? Math.floor(raw.head_limit as number) : null,
      multiline: raw.multiline === true,
    },
  }
}

function isTextBuffer(buffer: Buffer): boolean {
  return !buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0)
}

interface LineMatch {
  lineIndex: number
}

function countMatches(content: string, regex: RegExp, multiline: boolean): {
  matchLines: LineMatch[]
  count: number
} {
  const lines = content.split(/\r?\n/)
  const matchLines: LineMatch[] = []
  let count = 0

  if (multiline) {
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
    let hit: RegExpExecArray | null
    while ((hit = globalRegex.exec(content)) !== null) {
      count += 1
      const lineIndex = content.slice(0, hit.index).split(/\r?\n/).length - 1
      if (!matchLines.some(m => m.lineIndex === lineIndex)) {
        matchLines.push({ lineIndex })
      }
      if (hit[0] === '') globalRegex.lastIndex += 1
      if (matchLines.length >= MAX_OUTPUT_LINES) break
    }
    return { matchLines, count }
  }

  for (let index = 0; index < lines.length; index += 1) {
    regex.lastIndex = 0
    if (regex.test(lines[index])) {
      count += 1
      matchLines.push({ lineIndex: index })
    }
  }
  return { matchLines, count }
}

function renderContentMode(
  displayPath: string,
  lines: string[],
  matchLines: LineMatch[],
  params: GrepParams,
): string[] {
  const sorted = [...matchLines].sort((a, b) => a.lineIndex - b.lineIndex)
  const isMatchLine = new Set(sorted.map(m => m.lineIndex))
  const output: string[] = []
  let lastEmitted = -1

  for (const match of sorted) {
    const from = Math.max(0, match.lineIndex - params.contextBefore)
    const to = Math.min(lines.length - 1, match.lineIndex + params.contextAfter)
    if (lastEmitted >= 0 && from > lastEmitted + 1) {
      output.push(`${displayPath}-`)
    }
    for (let index = from; index <= to; index += 1) {
      if (index <= lastEmitted) continue
      const separator = isMatchLine.has(index) ? ':' : '-'
      output.push(
        params.showLineNumbers
          ? `${displayPath}:${index + 1}${separator}${lines[index]}`
          : `${displayPath}${separator}${lines[index]}`,
      )
    }
    lastEmitted = to
  }

  return output
}

export async function executeGrep(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = await parseParams(input, context)
  if ('error' in parsed) {
    return parsed.error
  }
  const params = parsed.params

  let entries
  try {
    entries = await walkFiles(params.searchDir, { maxResults: 20000, signal: context.signal })
  } catch (error) {
    return {
      content: `Error: cannot walk directory: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }

  if (context.signal?.aborted) {
    return { content: 'Error: aborted (cancelled) while scanning directories', isError: true }
  }

  const globMatcher = params.glob ? picomatch(params.glob, { dot: true }) : null

  const outputLines: string[] = []
  let totalMatches = 0
  let filesWithMatches = 0
  let truncated = false

  for (const entry of entries) {
    if (entry.stats.size > MAX_FILE_BYTES) continue
    if (globMatcher && !globMatcher(entry.relativePath.split(path.sep).join('/'))) {
      continue
    }

    let buffer: Buffer
    try {
      buffer = await fs.readFile(entry.absolutePath)
    } catch {
      continue
    }
    if (!isTextBuffer(buffer)) continue

    const text = buffer.toString('utf8')
    const { matchLines, count } = countMatches(text, params.regex, params.multiline)
    if (matchLines.length === 0) continue

    filesWithMatches += 1
    totalMatches += count

    const displayPath = entry.absolutePath
    if (params.outputMode === 'files_with_matches') {
      outputLines.push(displayPath)
    } else if (params.outputMode === 'count') {
      outputLines.push(`${displayPath}:${count}`)
    } else {
      outputLines.push(...renderContentMode(displayPath, text.split(/\r?\n/), matchLines, params))
    }

    if (params.headLimit !== null && outputLines.length >= params.headLimit) {
      outputLines.length = Math.max(0, params.headLimit)
      truncated = true
      break
    }
    if (outputLines.length >= MAX_OUTPUT_LINES) {
      outputLines.length = MAX_OUTPUT_LINES
      truncated = true
      break
    }
  }

  if (filesWithMatches === 0) {
    return { content: 'No matches found' }
  }

  const summary = `${filesWithMatches} file(s) with ${totalMatches} match(es)`
  const notes = truncated ? ' [output truncated]' : ''
  return { content: `${outputLines.join('\n')}\n\n[${summary}${notes}]` }
}

export function createGrepTool(): ToolDefinition {
  return {
    name: 'Grep',
    description:
      'Searches file contents with a regular expression (JavaScript RegExp syntax), like ' +
      'ripgrep. Use it to find definitions, call sites, config keys, and TODOs across the ' +
      'workspace. output_mode: "files_with_matches" (default, cheapest), "content" (matching ' +
      'lines with -n line numbers, optional -A/-B/-C context and head_limit), or "count". ' +
      'For plain substring searches, escape regex metacharacters. multiline allows patterns ' +
      'spanning lines. Narrow with the glob filter (e.g. "*.ts") on large trees.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression to search for' },
        path: { type: 'string', description: 'File or directory to search (default: workspace directory)' },
        glob: { type: 'string', description: 'Restrict search to files matching this glob, e.g. "*.ts"' },
        output_mode: {
          type: 'string',
          description: 'Output format (default files_with_matches)',
        },
        '-i': { type: 'boolean', description: 'Case-insensitive search' },
        '-n': { type: 'boolean', description: 'Show line numbers in content mode (default true)' },
        '-A': { type: 'number', description: 'Lines of context after each match' },
        '-B': { type: 'number', description: 'Lines of context before each match' },
        '-C': { type: 'number', description: 'Lines of context before and after each match' },
        head_limit: { type: 'number', description: 'Maximum number of output lines' },
        multiline: { type: 'boolean', description: 'Allow the pattern to span multiple lines' },
      },
      required: ['pattern'],
    },
    execute: executeGrep,
  }
}
