/**
 * MCP tool adapter (P1.3 minimal subset) — turns configured stdio MCP servers
 * into ToolDefinitions the agent loop already knows how to gate, run, and
 * audit.
 *
 * Nothing here bypasses the harness (contracts/22 invariant 3): discovered
 * tools go through the same registry, permission gate, boundary context, and
 * transcript as the built-ins. The `mcp.<server>.<tool>` naming keeps the
 * registry's uniqueness invariant trivially satisfied and matches the
 * namespace shape frozen in contracts/22.
 *
 * Trust posture (contracts/22 MCP note): wire annotations (readOnlyHint etc.)
 * are UNTRUSTED hints — every MCP tool is therefore registered with
 * `readOnly: false` (approval required in Agent mode, denied in Plan mode,
 * auto-run in YOLO). The per-call deadline comes from the server config and
 * is enforced by the loop's P1.1 contract machinery; the adapter only maps
 * transport failures onto the tool error-code vocabulary.
 *
 * v1 launcher boundary: servers are Node scripts (`spawn('node', [script,
 * ...args])` — see mcpClient.ts). Arbitrary executables are a P2 item gated
 * on the project security policy's binary allowlist.
 */

import path from 'node:path'
import type { JsonSchemaObject, ToolDefinition, ToolResult } from './types.ts'
import {
  MCP_REQUEST_TIMEOUT_MS,
  McpClientError,
  startMcpClient,
  type McpClient,
} from './mcpClient.ts'

export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/
const MCP_SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])

/** Default per-call deadline, exposed as the tool contract's timeoutMs. */
export const MCP_TOOL_TIMEOUT_MS = MCP_REQUEST_TIMEOUT_MS
/** Config may extend the deadline, but a runaway server cannot pin the loop. */
export const MCP_MAX_TIMEOUT_MS = 600_000
/** Loop-enforced output budget for every MCP tool (P1.1 machinery truncates). */
export const MCP_OUTPUT_LIMIT_BYTES = 256 * 1024
/** Bound on configured servers per session (sorted; extras are skipped). */
export const MCP_MAX_SERVERS = 16

export interface McpServerConfig {
  /** Path to the server's Node script; relative paths resolve against cwd. */
  script: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  enabled?: boolean
}

export interface ParsedMcpServer {
  name: string
  config: McpServerConfig
}

export interface ParsedMcpServers {
  servers: ParsedMcpServer[]
  warnings: string[]
}

export interface McpSession {
  /** Tools to merge after the core set (createCoreTools().concat(...)). */
  readonly tools: ToolDefinition[]
  readonly warnings: string[]
  /** Kill every server process; safe to call more than once. */
  dispose(): void
}

/**
 * Shape-level validation of the `mcpServers` settings record. Invalid entries
 * produce warnings and are skipped — a bad server must never block the run.
 */
export function parseMcpServers(raw: unknown, cwd?: string): ParsedMcpServers {
  const warnings: string[] = []
  const servers: ParsedMcpServer[] = []
  if (raw === undefined || raw === null) return { servers, warnings }
  if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
    warnings.push('mcpServers must be an object mapping server names to configs — ignored')
    return { servers, warnings }
  }

  const names = Object.keys(raw as Record<string, unknown>).sort()
  for (const name of names) {
    const value = (raw as Record<string, unknown>)[name]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      warnings.push(`server "${name}": config must be an object — skipped`)
      continue
    }
    if (!MCP_SERVER_NAME_PATTERN.test(name)) {
      warnings.push(
        `server "${name}": name may only contain letters, digits, "_" and "-" — skipped`,
      )
      continue
    }
    const record = value as Record<string, unknown>

    if (record.enabled === false) continue // intentional kill switch: silent

    const rawScript = typeof record.script === 'string' ? record.script.trim() : ''
    if (rawScript === '') {
      warnings.push(`server "${name}": "script" (path to a Node script) is required — skipped`)
      continue
    }
    if (!MCP_SCRIPT_EXTENSIONS.has(path.extname(rawScript).toLowerCase())) {
      warnings.push(
        `server "${name}": script must be a .js/.mjs/.cjs file (v1 launches Node scripts only) — skipped`,
      )
      continue
    }
    const script = path.isAbsolute(rawScript) ? rawScript : path.resolve(cwd ?? process.cwd(), rawScript)

    let args: string[] | undefined
    if (record.args !== undefined) {
      if (!Array.isArray(record.args) || record.args.some(arg => typeof arg !== 'string')) {
        warnings.push(`server "${name}": "args" must be an array of strings — skipped`)
        continue
      }
      args = record.args as string[]
    }

    let env: Record<string, string> | undefined
    if (record.env !== undefined) {
      if (typeof record.env !== 'object' || record.env === null || Array.isArray(record.env)) {
        warnings.push(`server "${name}": "env" must be an object of strings — skipped`)
        continue
      }
      env = {}
      for (const [key, value] of Object.entries(record.env as Record<string, unknown>)) {
        if (typeof value !== 'string') {
          warnings.push(`server "${name}": env "${key}" must be a string — entry skipped`)
          continue
        }
        env[key] = value
      }
    }

    let timeoutMs: number | undefined
    if (record.timeoutMs !== undefined) {
      const value = record.timeoutMs
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        warnings.push(`server "${name}": timeoutMs must be a positive number — using the default`)
      } else if (value > MCP_MAX_TIMEOUT_MS) {
        warnings.push(
          `server "${name}": timeoutMs capped at ${MCP_MAX_TIMEOUT_MS}ms`,
        )
        timeoutMs = MCP_MAX_TIMEOUT_MS
      } else {
        timeoutMs = value
      }
    }

    servers.push({ name, config: { script, ...(args ? { args } : {}), ...(env ? { env } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) } })
  }

  if (servers.length > MCP_MAX_SERVERS) {
    warnings.push(
      `more than ${MCP_MAX_SERVERS} servers configured — keeping the first ${MCP_MAX_SERVERS} (sorted by name)`,
    )
    servers.length = MCP_MAX_SERVERS
  }
  return { servers, warnings }
}

/**
 * Start every enabled server, run the handshake + tools/list discovery, and
 * adapt the results into loop-ready ToolDefinitions. A server that fails to
 * start or answer degrades to a warning — never a failed session.
 */
export async function discoverMcpTools(options: {
  /** The raw `mcpServers` record from settings (already merged across layers). */
  servers?: unknown
  /** Workspace root: resolves relative script paths and is the server cwd. */
  cwd?: string
  /** Handshake deadline override (tests; keeps discovery bounded). */
  handshakeTimeoutMs?: number
} = {}): Promise<McpSession> {
  const parsed = parseMcpServers(options.servers, options.cwd)
  const warnings = [...parsed.warnings]
  const tools: ToolDefinition[] = []
  const clients: McpClient[] = []
  const usedNames = new Set<string>()

  for (const { name, config } of parsed.servers) {
    let client: McpClient | undefined
    try {
      client = await startMcpClient({
        serverName: name,
        script: config.script,
        ...(config.args ? { args: config.args } : {}),
        ...(config.env ? { env: config.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.handshakeTimeoutMs !== undefined
          ? { handshakeTimeoutMs: options.handshakeTimeoutMs }
          : {}),
      })
      const infos = await client.listTools()
      for (const info of infos) {
        const tool = buildTool(name, config, client, info, usedNames, warnings)
        if (tool) tools.push(tool)
      }
      clients.push(client)
    } catch (error) {
      warnings.push(
        `server "${name}" unavailable: ${describeError(error)} — its tools are skipped for this session`,
      )
      client?.dispose()
    }
  }

  return {
    tools,
    warnings,
    dispose(): void {
      for (const client of clients) client.dispose()
    },
  }
}

function buildTool(
  serverName: string,
  config: McpServerConfig,
  client: McpClient,
  info: { name: string; description?: string; inputSchema?: unknown },
  usedNames: Set<string>,
  warnings: string[],
): ToolDefinition | null {
  if (!MCP_TOOL_NAME_PATTERN.test(info.name)) {
    warnings.push(
      `server "${serverName}": tool name "${info.name}" contains unsupported characters — skipped`,
    )
    return null
  }
  // Two name forms (contracts/25):
  // - registry name  `mcp__<server>__<tool>` — the wire-safe form; the OpenAI
  //   and Anthropic tool-name grammars only accept [A-Za-z0-9_-], so dots
  //   would be rejected by real providers (hence the Claude-Code-style `__`).
  // - namespace      `mcp.<server>.<tool>` — the dotted form frozen in
  //   contracts/22, carried on the namespace contract field.
  const fullName = `mcp__${serverName}__${info.name}`
  const dottedNamespace = `mcp.${serverName}.${info.name}`
  if (usedNames.has(fullName)) {
    warnings.push(`duplicate MCP tool name "${fullName}" — the later entry was skipped`)
    return null
  }
  usedNames.add(fullName)

  const deadlineMs = config.timeoutMs ?? MCP_TOOL_TIMEOUT_MS
  // The loop's P1.1 deadline is authoritative; the client's own request timer
  // is a backstop for direct (non-loop) registry use, so it fires only after
  // the loop deadline had its chance.
  const backstopMs = deadlineMs + 1_000

  return {
    name: fullName,
    description:
      info.description ??
      `MCP tool "${info.name}" provided by the "${serverName}" MCP server.`,
    inputSchema: sanitizeInputSchema(info.inputSchema),
    // Wire annotations are untrusted hints (contracts/22): fail closed.
    readOnly: false,
    namespace: dottedNamespace,
    cancellable: true,
    timeoutMs: deadlineMs,
    outputLimitBytes: MCP_OUTPUT_LIMIT_BYTES,
    async execute(input: unknown, context): Promise<ToolResult> {
      try {
        const result = await client.callTool(info.name, input, {
          signal: context.signal,
          timeoutMs: backstopMs,
        })
        return result.isError
          ? { content: result.content, isError: true }
          : { content: result.content }
      } catch (error) {
        return failureToResult(fullName, deadlineMs, error)
      }
    },
  }
}

function sanitizeInputSchema(schema: unknown): JsonSchemaObject {
  if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)
    && (schema as { type?: unknown }).type === 'object') {
    return schema as JsonSchemaObject
  }
  // A server without a usable object schema gets a permissive placeholder —
  // the wire needs an object schema; argument validation stays server-side.
  return { type: 'object' }
}

function failureToResult(toolName: string, deadlineMs: number, error: unknown): ToolResult {
  const kind = error instanceof McpClientError ? error.kind : 'protocol'
  const detail = describeError(error)
  switch (kind) {
    case 'timeout':
      return {
        content: `Error: MCP tool "${toolName}" timed out after ${deadlineMs}ms. The server may be overloaded — retry once, then report the failure.`,
        isError: true,
        code: 'timeout',
      }
    case 'aborted':
      return {
        content: `Error: MCP tool "${toolName}" was aborted before the server answered.`,
        isError: true,
        code: 'aborted',
      }
    case 'restart_exhausted':
    case 'disposed':
      return {
        content: `Error: MCP tool "${toolName}" is unavailable this session: ${detail}`,
        isError: true,
        code: 'failed',
      }
    default:
      return {
        content: `Error: MCP tool "${toolName}" failed: ${detail}`,
        isError: true,
        code: 'failed',
      }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
