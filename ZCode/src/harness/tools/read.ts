import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'

const DEFAULT_LIMIT = 2000
const MAX_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

export function resolveWorkspacePath(cwd: string, filePath: string): string {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('file_path is required')
  }
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath)
}

function formatReadOutput(
  lines: string[],
  startLine: number,
): { content: string; truncatedLines: number } {
  const rendered: string[] = []
  let truncatedLines = 0

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = startLine + index
    const raw = lines[index]
    if (raw.length > MAX_LINE_LENGTH) {
      truncatedLines += 1
      rendered.push(
        `${String(lineNumber).padStart(6)}\t${raw.slice(0, MAX_LINE_LENGTH)}… [line truncated]`,
      )
      continue
    }
    rendered.push(`${String(lineNumber).padStart(6)}\t${raw}`)
  }

  return { content: rendered.join('\n'), truncatedLines }
}

export async function executeRead(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const params = (input ?? {}) as {
    file_path?: unknown
    offset?: unknown
    limit?: unknown
  }

  if (typeof params.file_path !== 'string' || params.file_path.trim() === '') {
    return {
      content: 'Error: file_path is required',
      isError: true,
    }
  }

  const absolutePath = resolveWorkspacePath(context.cwd, params.file_path)

  let stats
  try {
    stats = await fs.stat(absolutePath)
  } catch {
    return {
      content: `Error: file does not exist: ${absolutePath}`,
      isError: true,
    }
  }

  if (stats.isDirectory()) {
    return {
      content: `Error: path is a directory, not a file: ${absolutePath}`,
      isError: true,
    }
  }

  let raw
  try {
    raw = await fs.readFile(absolutePath)
  } catch (error) {
    return {
      content: `Error: cannot read file: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }

  if (raw.includes(0)) {
    return {
      content: `Error: binary file cannot be read as text: ${absolutePath}`,
      isError: true,
    }
  }

  const allLines = raw.toString('utf8').split(/\r?\n/)
  const offset =
    Number.isFinite(params.offset) && (params.offset as number) >= 1
      ? Math.floor(params.offset as number)
      : 1
  const requestedLimit =
    Number.isFinite(params.limit) && (params.limit as number) >= 1
      ? Math.min(Math.floor(params.limit as number), MAX_LIMIT)
      : DEFAULT_LIMIT
  const selected = allLines.slice(offset - 1, offset - 1 + requestedLimit)
  const { content, truncatedLines } = formatReadOutput(selected, offset)

  const totalLines = allLines.length
  const lastRenderedLine = offset + selected.length - 1
  const notes: string[] = []
  if (truncatedLines > 0) {
    notes.push(`${truncatedLines} line(s) exceeded ${MAX_LINE_LENGTH} chars and were truncated`)
  }
  if (lastRenderedLine < totalLines) {
    notes.push(
      `showing lines ${offset}-${lastRenderedLine} of ${totalLines} (use offset/limit to paginate)`,
    )
  }

  context.state.readFiles.add(absolutePath)

  const body = notes.length > 0 ? `${content}\n\n[${notes.join('; ')}]` : content
  return { content: body === '' ? '[empty file]' : body }
}

export function createReadTool(): ToolDefinition {
  return {
    name: 'Read',
    description:
      'Reads a text file from the local filesystem. Returns content with cat -n style line numbers. ' +
      'Optional offset (1-based start line) and limit (max 2000 lines) paginate long files. ' +
      'Reading is required before Edit.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file (absolute, or relative to the workspace directory)',
        },
        offset: {
          type: 'number',
          description: '1-based line number to start reading from',
        },
        limit: {
          type: 'number',
          description: 'Number of lines to read (max 2000, default 2000)',
        },
      },
      required: ['file_path'],
    },
    execute: executeRead,
  }
}
