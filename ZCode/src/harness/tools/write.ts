import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolContext, ToolDefinition, ToolResult } from '../types.ts'
import { resolveWorkspacePath, toErrorResult } from './read.ts'

export async function executeWrite(
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const params = (input ?? {}) as { file_path?: unknown; content?: unknown }

  if (typeof params.file_path !== 'string' || params.file_path.trim() === '') {
    return { content: 'Error: file_path is required', isError: true }
  }
  if (typeof params.content !== 'string') {
    return { content: 'Error: content is required and must be a string', isError: true }
  }

  let absolutePath: string
  try {
    absolutePath = resolveWorkspacePath(context, params.file_path)
  } catch (error) {
    return toErrorResult(error)
  }

  try {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    let existed = false
    try {
      await fs.access(absolutePath)
      existed = true
    } catch {
      existed = false
    }
    await fs.writeFile(absolutePath, params.content, 'utf8')
    context.state.readFiles.add(absolutePath)
    return {
      content: `${existed ? 'File updated' : 'File created'} successfully: ${absolutePath} (${params.content.length} bytes)`,
    }
  } catch (error) {
    return {
      content: `Error: cannot write file: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }
}

export function createWriteTool(): ToolDefinition {
  return {
    name: 'Write',
    description:
      'Writes content to a file, creating parent directories as needed. ' +
      'Overwrites the file completely when it exists. For partial changes prefer Edit.',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file (absolute, or relative to the workspace directory)',
        },
        content: { type: 'string', description: 'Full content to write' },
      },
      required: ['file_path', 'content'],
    },
    execute: executeWrite,
  }
}
