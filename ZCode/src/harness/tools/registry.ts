import {
  LOOP_CONTRACT_VERSION,
  type ToolContract,
  type ToolDefinition,
  type ToolSideEffect,
} from '../types.ts'

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined
  has(name: string): boolean
  list(): ToolDefinition[]
  /** Effective contract of a registered tool (declared fields + defaults). */
  contractOf(name: string): ToolContract | undefined
}

const SIDE_EFFECTS: readonly ToolSideEffect[] = ['read', 'write', 'process', 'network']
const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/

/**
 * Resolves a tool's effective contract from its (all-optional) declaration,
 * applying the conservative compatibility rule from contracts/22: a tool
 * without extension fields is read as
 * `{ sideEffect: readOnly ? 'read' : 'write', cancellable: false, ... }`.
 */
export function resolveToolContract(tool: ToolDefinition): ToolContract {
  return {
    version: tool.version ?? LOOP_CONTRACT_VERSION,
    sideEffect: tool.sideEffect ?? (tool.readOnly ? 'read' : 'write'),
    timeoutMs: tool.timeoutMs ?? null,
    outputLimitBytes: tool.outputLimitBytes ?? null,
    cancellable: tool.cancellable ?? false,
    idempotent: tool.idempotent ?? false,
    sensitive: tool.sensitive ?? false,
    namespace: tool.namespace ?? null,
  }
}

function validateDeclaration(tool: ToolDefinition): void {
  if (tool.version !== undefined) {
    if (!Number.isInteger(tool.version) || tool.version < 1) {
      throw new Error(`tool "${tool.name}": version must be a positive integer`)
    }
    if (tool.version > LOOP_CONTRACT_VERSION) {
      throw new Error(
        `tool "${tool.name}": contract version ${tool.version} is newer than the ` +
          `harness speaks (version ${LOOP_CONTRACT_VERSION}) — upgrade the harness or downgrade the tool`,
      )
    }
  }

  if (tool.sideEffect !== undefined) {
    if (!SIDE_EFFECTS.includes(tool.sideEffect)) {
      throw new Error(
        `tool "${tool.name}": sideEffect must be one of ${SIDE_EFFECTS.join(', ')}`,
      )
    }
    // sideEffect classifies the KIND of effect; readOnly governs permissions.
    // They are orthogonal (webFetch is 'network' and read-only; TodoWrite
    // 'write's session state and is plan-mode-safe) — the one contradiction
    // is claiming the 'read' class while needing approval for effects.
    if (tool.sideEffect === 'read' && tool.readOnly === false) {
      throw new Error(`tool "${tool.name}": sideEffect 'read' requires readOnly: true`)
    }
  }

  for (const [field, value] of [
    ['timeoutMs', tool.timeoutMs],
    ['outputLimitBytes', tool.outputLimitBytes],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`tool "${tool.name}": ${field} must be a positive number`)
    }
  }

  if (tool.namespace !== undefined && !NAMESPACE_PATTERN.test(tool.namespace)) {
    throw new Error(
      `tool "${tool.name}": namespace must look like "<scope>.<name>" (e.g. "mcp.github.create_issue")`,
    )
  }
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
    validateDeclaration(tool)
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
    contractOf(name) {
      const tool = byName.get(name)
      return tool ? resolveToolContract(tool) : undefined
    },
  }
}
