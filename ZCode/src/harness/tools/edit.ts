import { promises as fs } from 'node:fs'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'
import { resolveWorkspacePath, toErrorResult } from './read.ts'

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function renderSnippet(content: string, markerIndex: number, length: number): string {
  const from = Math.max(0, markerIndex - 60)
  const to = Math.min(content.length, markerIndex + length + 60)
  const prefix = from > 0 ? '…' : ''
  const suffix = to < content.length ? '…' : ''
  return `${prefix}${content.slice(from, to)}${suffix}`
}

export async function executeEdit(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const params = (input ?? {}) as {
    file_path?: unknown
    old_string?: unknown
    new_string?: unknown
    replace_all?: unknown
  }

  if (typeof params.file_path !== 'string' || params.file_path.trim() === '') {
    return { content: 'Error: file_path is required', isError: true }
  }
  if (typeof params.old_string !== 'string' || params.old_string === '') {
    return { content: 'Error: old_string is required and must not be empty', isError: true }
  }
  if (typeof params.new_string !== 'string') {
    return { content: 'Error: new_string is required and must be a string', isError: true }
  }

  let absolutePath: string
  try {
    absolutePath = await resolveWorkspacePath(context, params.file_path)
  } catch (error) {
    return toErrorResult(error)
  }

  let content: string
  try {
    content = await fs.readFile(absolutePath, 'utf8')
  } catch {
    return { content: `Error: file does not exist: ${absolutePath}`, isError: true }
  }

  if (!context.state.readFiles.has(absolutePath)) {
    return {
      content:
        `Error: file has not been read yet. Read it with the Read tool before editing: ${absolutePath}`,
      isError: true,
    }
  }

  const occurrences = countOccurrences(content, params.old_string)
  const replaceAll = params.replace_all === true

  if (occurrences === 0) {
    return {
      content:
        `Error: old_string not found in ${absolutePath}. It must match the file content exactly, including whitespace.`,
      isError: true,
    }
  }

  if (occurrences > 1 && !replaceAll) {
    return {
      content:
        `Error: old_string appears ${occurrences} times in ${absolutePath}. ` +
        'It must be unique — provide more surrounding context, or set replace_all to true.',
      isError: true,
    }
  }

  const firstIndex = content.indexOf(params.old_string)
  const updated = replaceAll
    ? content.split(params.old_string).join(params.new_string)
    : content.slice(0, firstIndex) + params.new_string + content.slice(firstIndex + params.old_string.length)

  try {
    await fs.writeFile(absolutePath, updated, 'utf8')
  } catch (error) {
    return {
      content: `Error: cannot write file: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }

  const replaced = replaceAll ? occurrences : 1
  return {
    content:
      `File edited successfully: ${absolutePath} (${replaced} replacement${replaced > 1 ? 's' : ''}). ` +
      `Near the edit: ${JSON.stringify(renderSnippet(updated, replaceAll ? updated.indexOf(params.new_string) : firstIndex, params.new_string.length))}`,
  }
}

export function createEditTool(): ToolDefinition {
  return {
    name: 'Edit',
    description:
      'Replaces an exact string in an existing file — the surgical way to change code. ' +
      'old_string must match the file content exactly, including whitespace and indentation, ' +
      'and must appear exactly once unless replace_all is true; include a few surrounding ' +
      'lines to guarantee uniqueness. The file must have been read with the Read tool first ' +
      'in this session (enforced). On mismatch the error reports the occurrence count so you ' +
      'can adjust the match instead of guessing.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file (absolute, or relative to the workspace directory)',
        },
        old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence instead of requiring uniqueness (default false)',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    execute: executeEdit,
  }
}
