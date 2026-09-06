import path from 'node:path'
import picomatch from 'picomatch'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'
import { walkFiles } from './fsWalk.ts'
import { resolveWorkspacePath, toErrorResult } from './read.ts'

const MAX_RESULTS = 1000

export async function executeGlob(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const params = (input ?? {}) as { pattern?: unknown; path?: unknown }

  if (typeof params.pattern !== 'string' || params.pattern.trim() === '') {
    return { content: 'Error: pattern is required', isError: true }
  }

  let searchDir: string
  try {
    searchDir =
      typeof params.path === 'string' && params.path.trim() !== ''
        ? await resolveWorkspacePath(context, params.path)
        : context.cwd
  } catch (error) {
    return toErrorResult(error)
  }

  const isMatch = picomatch(params.pattern, {
    dot: true,
    nobrace: false,
    noglobstar: false,
  })

  let entries
  try {
    entries = await walkFiles(searchDir, { maxResults: 20000, signal: context.signal })
  } catch (error) {
    return {
      content: `Error: cannot walk directory: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }

  if (context.signal?.aborted) {
    return { content: 'Error: aborted (cancelled) while scanning directories', isError: true }
  }

  const matched = entries
    .filter(entry => {
      const normalized = entry.relativePath.split(path.sep).join('/')
      return isMatch(normalized) || isMatch(path.basename(normalized))
    })
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
    .slice(0, MAX_RESULTS)

  if (matched.length === 0) {
    return { content: 'No files found' }
  }

  const lines = matched.map(entry => entry.absolutePath)
  if (entries.length > 0 && matched.length === MAX_RESULTS) {
    lines.push(`[truncated at ${MAX_RESULTS} results]`)
  }

  return { content: lines.join('\n') }
}

export function createGlobTool(): ToolDefinition {
  return {
    name: 'Glob',
    description:
      'Finds files by glob pattern (e.g. "src/**/*.ts", "**/*.{js,json}") and returns paths ' +
      'sorted by modification time (newest first). Use it to map the project layout, locate ' +
      'files by name or extension, or check whether a file exists — for file contents use ' +
      'Grep instead. Results respect the workspace boundary and skip symlinks/junctions.',
    readOnly: true,
    version: 1,
    sideEffect: 'read',
    cancellable: true,
    timeoutMs: 30_000,
    outputLimitBytes: 1_000_000,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern, e.g. "**/*.test.js"',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: workspace directory)',
        },
      },
      required: ['pattern'],
    },
    execute: executeGlob,
  }
}
