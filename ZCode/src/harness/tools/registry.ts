import type { ToolDefinition } from '../types.ts'

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined
  has(name: string): boolean
  list(): ToolDefinition[]
}

export function createToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  const byName = new Map<string, ToolDefinition>()
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || tool.name.trim() === '') {
      throw new Error('tool definition requires a name')
    }
    if (byName.has(tool.name)) {
      throw new Error(`duplicate tool name: ${tool.name}`)
    }
    byName.set(tool.name, tool)
  }

  return {
    get(name) {
      return byName.get(name)
    },
    has(name) {
      return byName.has(name)
    },
    list() {
      return [...byName.values()]
    },
  }
}
