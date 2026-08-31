import type { ToolDefinition } from '../types.ts'
import { createReadTool } from './read.ts'
import { createGlobTool } from './glob.ts'
import { createGrepTool } from './grep.ts'
import { createWriteTool } from './write.ts'
import { createEditTool } from './edit.ts'
import { createBashTool } from './bash.ts'

export * from './registry.ts'

/**
 * The core six tools required by the v1 acceptance scenario.
 * Later milestones may add more; the loop never hardcodes names.
 */
export function createCoreTools(): ToolDefinition[] {
  return [
    createReadTool(),
    createGlobTool(),
    createGrepTool(),
    createWriteTool(),
    createEditTool(),
    createBashTool(),
  ]
}
