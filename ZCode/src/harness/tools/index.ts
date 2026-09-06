import type { ToolDefinition } from '../types.ts'
import { createReadTool } from './read.ts'
import { createGlobTool } from './glob.ts'
import { createGrepTool } from './grep.ts'
import { createWriteTool } from './write.ts'
import { createEditTool } from './edit.ts'
import { createBashTool } from './bash.ts'
import { createTodoTool } from './todo.ts'
import { createWebFetchTool } from './webFetch.ts'

export * from './registry.ts'

/**
 * The core toolset: the v1 six (Read/Glob/Grep/Write/Edit/Bash) plus the v1.5
 * working-tool additions (TodoWrite task tracking, WebFetch documentation
 * lookup). The loop never hardcodes names.
 */
export function createCoreTools(): ToolDefinition[] {
  return [
    createReadTool(),
    createGlobTool(),
    createGrepTool(),
    createWriteTool(),
    createEditTool(),
    createBashTool(),
    createTodoTool(),
    createWebFetchTool(),
  ]
}
