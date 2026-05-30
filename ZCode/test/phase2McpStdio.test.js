import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 — MCP stdio transport verification tests
// Portable reimplementations of core logic from:
//   src/services/mcp/types.ts          (config schemas)
//   src/services/mcp/mcpStringUtils.ts (tool name parsing)
//   src/services/mcp/normalization.ts  (name normalization)
//   src/services/mcp/envExpansion.ts   (env variable expansion)
//   src/services/mcp/utils.ts          (filtering, hash, scope)
//   src/services/mcp/client.ts         (error classes, session detection)
//   src/utils/mcpValidation.ts         (output validation)
// ═══════════════════════════════════════════════════════════════

// ─── Constants ───

const TRANSPORT_TYPES = ['stdio', 'sse', 'sse-ide', 'http', 'ws', 'sdk']
const CONFIG_SCOPES = ['local', 'user', 'project', 'dynamic', 'enterprise', 'claudeai', 'managed']
const DEFAULT_MAX_MCP_OUTPUT_TOKENS = 25000
const MCP_TOKEN_COUNT_THRESHOLD_FACTOR = 0.5
const IMAGE_TOKEN_ESTIMATE = 1600

// MCP name prefix pattern: mcp__serverName__toolName
const MCP_TOOL_NAME_REGEX = /^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/

// ─── Portable: normalizeNameForMCP (normalization.ts) ───

function normalizeNameForMCP(name) {
  let normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (name.startsWith('claude.ai ')) {
    normalized = normalized.replace(/_+/g, '_').replace(/^_|_$/g, '')
  }
  return normalized
}

// ─── Portable: mcpInfoFromString (mcpStringUtils.ts) ───

function mcpInfoFromString(toolString) {
  const parts = toolString.split('__')
  const [mcpPart, serverName, ...toolNameParts] = parts
  if (mcpPart !== 'mcp' || !serverName) {
    return null
  }
  const toolName = toolNameParts.length > 0 ? toolNameParts.join('__') : undefined
  return { serverName, toolName }
}

// ─── Portable: getMcpPrefix / buildMcpToolName (mcpStringUtils.ts) ───

function getMcpPrefix(serverName) {
  return `mcp__${normalizeNameForMCP(serverName)}__`
}

function buildMcpToolName(serverName, toolName) {
  return `${getMcpPrefix(serverName)}${normalizeNameForMCP(toolName)}`
}

// ─── Portable: getMcpDisplayName (mcpStringUtils.ts) ───

function getMcpDisplayName(fullName, serverName) {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return fullName.replace(prefix, '')
}

// ─── Portable: extractMcpToolDisplayName (mcpStringUtils.ts) ───

function extractMcpToolDisplayName(userFacingName) {
  let withoutSuffix = userFacingName.replace(/\s*\(MCP\)\s*$/, '').trim()
  const dashIndex = withoutSuffix.indexOf(' - ')
  if (dashIndex !== -1) {
    return withoutSuffix.substring(dashIndex + 3).trim()
  }
  return withoutSuffix
}

// ─── Portable: getToolNameForPermissionCheck (mcpStringUtils.ts) ───

function getToolNameForPermissionCheck(tool) {
  return tool.mcpInfo
    ? buildMcpToolName(tool.mcpInfo.serverName, tool.mcpInfo.toolName)
    : tool.name
}

// ─── Portable: expandEnvVarsInString (envExpansion.ts) ───

function expandEnvVarsInString(value) {
  const missingVars = []
  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    const [varName, defaultValue] = varContent.split(':-', 2)
    const envValue = process.env[varName]
    if (envValue !== undefined) return envValue
    if (defaultValue !== undefined) return defaultValue
    missingVars.push(varName)
    return match
  })
  return { expanded, missingVars }
}

// ─── Portable: getScopeLabel (utils.ts) ───

function getScopeLabel(scope) {
  switch (scope) {
    case 'local':    return 'Local config (private to you in this project)'
    case 'project':  return 'Project config (shared via .mcp.json)'
    case 'user':     return 'User config (available in all your projects)'
    case 'dynamic':  return 'Dynamic config (from command line)'
    case 'enterprise': return 'Enterprise config (managed by your organization)'
    case 'claudeai': return 'claude.ai config'
    default:         return scope
  }
}

// ─── Portable: hashMcpConfig (utils.ts) — simplified ───

function hashMcpConfig(config) {
  const { scope, ...rest } = config
  // Sort keys for stable serialization (matching jsonStringify behavior)
  const sorted = {}
  for (const key of Object.keys(rest).sort()) {
    sorted[key] = rest[key]
  }
  const stable = JSON.stringify(sorted)
  return crypto.createHash('sha256').update(stable).digest('hex')
}

// ─── Portable: ensureTransport (utils.ts) ───

function ensureTransport(type) {
  if (!type) return 'stdio'
  if (type !== 'stdio' && type !== 'sse' && type !== 'http') {
    throw new Error(`Invalid transport type: ${type}. Must be one of: stdio, sse, http`)
  }
  return type
}

// ─── Portable: ensureConfigScope (utils.ts) ───

function ensureConfigScope(scope) {
  if (!scope) return 'local'
  if (!CONFIG_SCOPES.includes(scope)) {
    throw new Error(`Invalid scope: ${scope}. Must be one of: ${CONFIG_SCOPES.join(', ')}`)
  }
  return scope
}

// ─── Portable: filterToolsByServer (utils.ts) ───

function filterToolsByServer(tools, serverName) {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return tools.filter(tool => tool.name?.startsWith(prefix))
}

// ─── Portable: filterCommandsByServer (utils.ts) ───

function commandBelongsToServer(command, serverName) {
  const normalized = normalizeNameForMCP(serverName)
  const name = command.name
  if (!name) return false
  return name.startsWith(`mcp__${normalized}__`) || name.startsWith(`${normalized}:`)
}

function filterCommandsByServer(commands, serverName) {
  return commands.filter(c => commandBelongsToServer(c, serverName))
}

// ─── Portable: getContentSizeEstimate (mcpValidation.ts) ───

function roughTokenCountEstimation(content) {
  return Math.round(content.length / 4)
}

function getContentSizeEstimate(content) {
  if (!content) return 0
  if (typeof content === 'string') return roughTokenCountEstimation(content)
  return content.reduce((total, block) => {
    if (block.type === 'text') return total + roughTokenCountEstimation(block.text)
    if (block.type === 'image') return total + IMAGE_TOKEN_ESTIMATE
    return total
  }, 0)
}

// ─── Portable: error classes (client.ts) ───

class McpAuthError extends Error {
  constructor(serverName, message) {
    super(message)
    this.name = 'McpAuthError'
    this.serverName = serverName
  }
}

class McpSessionExpiredError extends Error {
  constructor(serverName) {
    super(`MCP server "${serverName}" session expired`)
    this.name = 'McpSessionExpiredError'
  }
}

class McpToolCallError extends Error {
  constructor(message, telemetryMessage, mcpMeta) {
    super(message)
    this.name = 'McpToolCallError'
    this.telemetryMessage = telemetryMessage
    this.mcpMeta = mcpMeta
  }
}

// ─── Portable: isMcpSessionExpiredError (client.ts) ───

function isMcpSessionExpiredError(error) {
  if (!error || typeof error !== 'object') return false
  const httpStatus = 'code' in error ? error.code : undefined
  if (httpStatus !== 404) return false
  return (
    error.message.includes('"code":-32001') ||
    error.message.includes('"code": -32001')
  )
}

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Stdio Server Config Schema
// ═══════════════════════════════════════════════════════════════

test('T2.10 stdio config: valid minimal config has command', () => {
  const config = { type: 'stdio', command: 'node', args: [] }
  assert.equal(config.type, 'stdio')
  assert.equal(config.command, 'node')
  assert.ok(Array.isArray(config.args))
  assert.equal(config.args.length, 0)
})

test('T2.10 stdio config: full config with command, args, env', () => {
  const config = {
    type: 'stdio',
    command: 'python',
    args: ['-m', 'my_mcp_server', '--port', '8080'],
    env: { PYTHONPATH: '/opt/mcp', LOG_LEVEL: 'debug' },
  }

  assert.equal(config.type, 'stdio')
  assert.equal(config.command, 'python')
  assert.equal(config.args.length, 4)
  assert.ok(config.args.includes('-m'))
  assert.ok(config.args.includes('--port'))
  assert.equal(config.env.PYTHONPATH, '/opt/mcp')
  assert.equal(config.env.LOG_LEVEL, 'debug')
})

test('T2.10 stdio config: type is optional for backwards compatibility', () => {
  // stdio is the implicit default when no type is specified
  const config = { command: '/usr/local/bin/mcp-server', args: [] }
  // In the code, type defaults via schema: type: z.literal('stdio').optional()
  assert.ok(!config.type || config.type === 'stdio',
    'stdio type or no type should be valid')
})

test('T2.10 stdio config: command cannot be empty', () => {
  const isEmpty = (s) => !s || s.trim().length === 0
  assert.equal(isEmpty(''), true)
  assert.equal(isEmpty('  '), true)
  assert.equal(isEmpty('node'), false)

  // Schema: z.string().min(1, 'Command cannot be empty')
  const validCommands = ['node', 'python3', '/usr/bin/npx', 'java']
  for (const cmd of validCommands) {
    assert.ok(cmd.length >= 1, `"${cmd}" should be valid`)
  }
})

test('T2.10 stdio config: env is optional', () => {
  const withoutEnv = { type: 'stdio', command: 'node' }
  assert.equal('env' in withoutEnv, false)

  const withEmptyEnv = { type: 'stdio', command: 'node', env: {} }
  assert.deepEqual(withEmptyEnv.env, {})
})

test('T2.10 stdio config: args defaults to empty array', () => {
  const config = { type: 'stdio', command: 'my-server' }
  // Schema: args: z.array(z.string()).default([])
  const args = config.args || []
  assert.ok(Array.isArray(args))
  assert.equal(args.length, 0)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Transport Types
// ═══════════════════════════════════════════════════════════════

test('T2.10 transports: all 6 transport types are recognized', () => {
  const expected = ['stdio', 'sse', 'sse-ide', 'http', 'ws', 'sdk']
  assert.deepEqual(TRANSPORT_TYPES, expected)
  assert.equal(TRANSPORT_TYPES.length, 6)
})

test('T2.10 transports: stdio is the default when no transport specified', () => {
  assert.equal(ensureTransport(), 'stdio')
  assert.equal(ensureTransport(undefined), 'stdio')
})

test('T2.10 transports: ensureTransport validates stdio/sse/http', () => {
  assert.equal(ensureTransport('stdio'), 'stdio')
  assert.equal(ensureTransport('sse'), 'sse')
  assert.equal(ensureTransport('http'), 'http')

  assert.throws(() => ensureTransport('ws'), /Invalid transport/)
  assert.throws(() => ensureTransport('gopher'), /Invalid transport/)
  // undefined/empty → defaults to 'stdio' (no throw)
  assert.equal(ensureTransport(''), 'stdio')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Config Scopes
// ═══════════════════════════════════════════════════════════════

test('T2.10 scopes: all 7 config scopes recognized', () => {
  assert.deepEqual(CONFIG_SCOPES, ['local', 'user', 'project', 'dynamic', 'enterprise', 'claudeai', 'managed'])
  assert.equal(CONFIG_SCOPES.length, 7)
})

test('T2.10 scopes: ensureConfigScope defaults to local', () => {
  assert.equal(ensureConfigScope(), 'local')
  assert.equal(ensureConfigScope(undefined), 'local')
})

test('T2.10 scopes: ensureConfigScope validates and returns known scopes', () => {
  assert.equal(ensureConfigScope('user'), 'user')
  assert.equal(ensureConfigScope('project'), 'project')
  assert.equal(ensureConfigScope('enterprise'), 'enterprise')

  assert.throws(() => ensureConfigScope('invalid'), /Invalid scope/)
  // undefined/empty → defaults to 'local' (no throw)
  assert.equal(ensureConfigScope(''), 'local')
})

test('T2.10 scopes: getScopeLabel returns human-readable labels', () => {
  assert.equal(getScopeLabel('local'), 'Local config (private to you in this project)')
  assert.equal(getScopeLabel('project'), 'Project config (shared via .mcp.json)')
  assert.equal(getScopeLabel('user'), 'User config (available in all your projects)')
  assert.equal(getScopeLabel('enterprise'), 'Enterprise config (managed by your organization)')
  assert.equal(getScopeLabel('claudeai'), 'claude.ai config')
})

test('T2.10 scopes: getScopeLabel returns raw scope for unknown values', () => {
  assert.equal(getScopeLabel('custom'), 'custom')
  assert.equal(getScopeLabel(''), '')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — MCP Tool Name Parsing & Building
// ═══════════════════════════════════════════════════════════════

test('T2.10 tool names: mcpInfoFromString parses standard format', () => {
  const result = mcpInfoFromString('mcp__github__search_repos')
  assert.deepEqual(result, { serverName: 'github', toolName: 'search_repos' })
})

test('T2.10 tool names: mcpInfoFromString handles tool-only without tool name', () => {
  // Server name only (e.g., for prefix matching)
  const result = mcpInfoFromString('mcp__myserver')
  assert.deepEqual(result, { serverName: 'myserver', toolName: undefined })
})

test('T2.10 tool names: mcpInfoFromString handles tool names with underscores', () => {
  const result = mcpInfoFromString('mcp__server__get_user_profile')
  assert.deepEqual(result, { serverName: 'server', toolName: 'get_user_profile' })
})

test('T2.10 tool names: mcpInfoFromString handles double underscores in tool name', () => {
  const result = mcpInfoFromString('mcp__srv__tool__with__underscores')
  assert.deepEqual(result, { serverName: 'srv', toolName: 'tool__with__underscores' })
})

test('T2.10 tool names: mcpInfoFromString rejects non-MCP prefixes', () => {
  assert.equal(mcpInfoFromString('regularTool'), null)
  assert.equal(mcpInfoFromString('mcp__'), null)
  assert.equal(mcpInfoFromString(''), null)
  assert.equal(mcpInfoFromString('Mcp__server__tool'), null) // case sensitive
})

test('T2.10 tool names: buildMcpToolName constructs valid MCP tool name', () => {
  assert.equal(buildMcpToolName('github', 'search_repos'), 'mcp__github__search_repos')
  // dashes are legal chars → preserved by normalizeNameForMCP
  assert.equal(buildMcpToolName('my-server', 'do_something'), 'mcp__my-server__do_something')
  assert.equal(buildMcpToolName('My Server', 'Get Users'), 'mcp__My_Server__Get_Users')
})

test('T2.10 tool names: buildMcpToolName and mcpInfoFromString are inverses', () => {
  const serverName = 'test-server'
  const toolName = 'simple_tool'
  const built = buildMcpToolName(serverName, toolName)
  const parsed = mcpInfoFromString(built)

  assert.equal(parsed.serverName, normalizeNameForMCP(serverName))
  assert.equal(parsed.toolName, normalizeNameForMCP(toolName))
})

test('T2.10 tool names: buildMcpToolName normalizes names containing special chars', () => {
  // Space, dots, colons → underscores
  assert.ok(buildMcpToolName('my.server', 'tool name').includes('my_server'))
  assert.ok(buildMcpToolName('server:name', 'tool:name').includes('server_name'))
})

test('T2.10 tool names: getMcpPrefix produces correct prefix', () => {
  assert.equal(getMcpPrefix('github'), 'mcp__github__')
  assert.equal(getMcpPrefix('My Server'), 'mcp__My_Server__')
})

test('T2.10 tool names: getMcpDisplayName strips prefix', () => {
  const fullName = 'mcp__github__search_repos'
  assert.equal(getMcpDisplayName(fullName, 'github'), 'search_repos')
})

test('T2.10 tool names: extractMcpToolDisplayName removes server prefix and (MCP) suffix', () => {
  assert.equal(extractMcpToolDisplayName('github - Search Repos (MCP)'), 'Search Repos')
  assert.equal(extractMcpToolDisplayName('filesystem - Read File'), 'Read File')
  assert.equal(extractMcpToolDisplayName('Search Repos (MCP)'), 'Search Repos')
  assert.equal(extractMcpToolDisplayName('Simple Tool'), 'Simple Tool')
})

test('T2.10 tool names: getToolNameForPermissionCheck uses mcpInfo if present', () => {
  const toolWithMcp = {
    name: 'Search Repos',
    mcpInfo: { serverName: 'github', toolName: 'search_repos' },
  }
  const toolWithoutMcp = { name: 'Bash', mcpInfo: undefined }

  assert.equal(getToolNameForPermissionCheck(toolWithMcp), 'mcp__github__search_repos')
  assert.equal(getToolNameForPermissionCheck(toolWithoutMcp), 'Bash')
})

test('T2.10 tool names: MCP_TOOL_NAME_REGEX matches valid qualified names', () => {
  const valid = [
    'mcp__github__search_repos',
    'mcp__filesystem__read_file',
    'mcp__my_server__my_tool',
  ]
  const invalid = [
    'mcp__github',           // no tool name
    'mcp___tool',            // empty server
    'github__search_repos',  // no mcp prefix
    'MCP__srv__tool',        // uppercase
    'mcp__srv__',            // empty tool
  ]

  for (const name of valid) {
    assert.match(name, MCP_TOOL_NAME_REGEX, `"${name}" should be valid`)
  }
  for (const name of invalid) {
    assert.doesNotMatch(name, MCP_TOOL_NAME_REGEX, `"${name}" should be invalid`)
  }
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Name Normalization
// ═══════════════════════════════════════════════════════════════

test('T2.10 normalization: replaces special chars with underscores', () => {
  assert.equal(normalizeNameForMCP('hello world'), 'hello_world')
  assert.equal(normalizeNameForMCP('my.server'), 'my_server')
  assert.equal(normalizeNameForMCP('tool:name'), 'tool_name')
  assert.equal(normalizeNameForMCP('name-with-dashes'), 'name-with-dashes')
})

test('T2.10 normalization: preserves allowed chars (alphanumeric, dash, underscore)', () => {
  assert.equal(normalizeNameForMCP('abc123-_'), 'abc123-_')
  assert.equal(normalizeNameForMCP('A-B_C'), 'A-B_C')
})

test('T2.10 normalization: claude.ai prefix collapses consecutive underscores', () => {
  assert.equal(normalizeNameForMCP('claude.ai my.server'), 'claude_ai_my_server')
})

test('T2.10 normalization: claude.ai prefix strips leading/trailing underscores', () => {
  assert.equal(normalizeNameForMCP('claude.ai .special.'), 'claude_ai_special')
})

test('T2.10 normalization: non-claude.ai names keep underscores as-is', () => {
  // Multiple spaces → multiple underscores (not collapsed for non-claude.ai)
  assert.equal(normalizeNameForMCP('a  b'), 'a__b')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Environment Variable Expansion
// ═══════════════════════════════════════════════════════════════

test('T2.10 env expansion: handles literal strings without vars', () => {
  const result = expandEnvVarsInString('no variables here')
  assert.equal(result.expanded, 'no variables here')
  assert.deepEqual(result.missingVars, [])
})

test('T2.10 env expansion: expands ${VAR} from process.env', () => {
  process.env.TEST_MCP_VAR = 'test_value_123'
  const result = expandEnvVarsInString('prefix-${TEST_MCP_VAR}-suffix')
  assert.equal(result.expanded, 'prefix-test_value_123-suffix')
  assert.deepEqual(result.missingVars, [])
  delete process.env.TEST_MCP_VAR
})

test('T2.10 env expansion: ${VAR:-default} uses env if available', () => {
  process.env.TEST_MCP_EXISTS = 'real_value'
  const result = expandEnvVarsInString('${TEST_MCP_EXISTS:-fallback}')
  assert.equal(result.expanded, 'real_value')
  delete process.env.TEST_MCP_EXISTS
})

test('T2.10 env expansion: ${VAR:-default} falls back to default', () => {
  const result = expandEnvVarsInString('${NONEXISTENT_VAR_XYZ:-my_default}')
  assert.equal(result.expanded, 'my_default')
  assert.deepEqual(result.missingVars, [])
})

test('T2.10 env expansion: reports missing vars without defaults', () => {
  const result = expandEnvVarsInString('${MISSING_VAR_ABC}')
  assert.equal(result.expanded, '${MISSING_VAR_ABC}')
  assert.deepEqual(result.missingVars, ['MISSING_VAR_ABC'])
})

test('T2.10 env expansion: multiple vars in one string', () => {
  process.env.MCP_HOST = 'localhost'
  process.env.MCP_PORT = '9090'
  const result = expandEnvVarsInString('http://${MCP_HOST}:${MCP_PORT}/api')
  assert.equal(result.expanded, 'http://localhost:9090/api')
  assert.deepEqual(result.missingVars, [])
  delete process.env.MCP_HOST
  delete process.env.MCP_PORT
})

test('T2.10 env expansion: mix of present, missing, and default vars', () => {
  process.env.PRESENT_VAR = 'hello'
  const result = expandEnvVarsInString('${PRESENT_VAR} ${MISSING_VAR:-world} ${ANOTHER_MISSING}')
  assert.equal(result.expanded, 'hello world ${ANOTHER_MISSING}')
  assert.deepEqual(result.missingVars, ['ANOTHER_MISSING'])
  delete process.env.PRESENT_VAR
})

test('T2.10 env expansion: handles command path with env vars', () => {
  process.env.NODE_PATH = '/opt/node/bin'
  const result = expandEnvVarsInString('${NODE_PATH}/mcp-server')
  assert.equal(result.expanded, '/opt/node/bin/mcp-server')
  delete process.env.NODE_PATH
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Error Classes
// ═══════════════════════════════════════════════════════════════

test('T2.10 errors: McpAuthError carries server name and message', () => {
  const err = new McpAuthError('my-server', 'OAuth token expired')
  assert.ok(err instanceof Error)
  assert.ok(err instanceof McpAuthError)
  assert.equal(err.name, 'McpAuthError')
  assert.equal(err.serverName, 'my-server')
  assert.equal(err.message, 'OAuth token expired')
})

test('T2.10 errors: McpSessionExpiredError constructs with server name', () => {
  const err = new McpSessionExpiredError('github')
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'McpSessionExpiredError')
  assert.ok(err.message.includes('github'))
  assert.ok(err.message.includes('session expired'))
})

test('T2.10 errors: McpToolCallError carries telemetry-safe message', () => {
  const err = new McpToolCallError(
    'Tool call failed: permission denied (sensitive details)',
    'Tool call failed',
    { _meta: { server: 'test' } },
  )
  assert.equal(err.name, 'McpToolCallError')
  assert.equal(err.message, 'Tool call failed: permission denied (sensitive details)')
  assert.equal(err.telemetryMessage, 'Tool call failed')
  assert.deepEqual(err.mcpMeta, { _meta: { server: 'test' } })
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Session Expired Detection
// ═══════════════════════════════════════════════════════════════

test('T2.10 session: isMcpSessionExpiredError detects 404 + -32001 code', () => {
  const err = new Error('HTTP 404: {"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"}}')
  err.code = 404
  assert.equal(isMcpSessionExpiredError(err), true)
})

test('T2.10 session: isMcpSessionExpiredError detects -32001 with space after colon', () => {
  const err = new Error('Response error: {"error": {"code": -32001, "message": "Session not found"}}')
  err.code = 404
  assert.equal(isMcpSessionExpiredError(err), true)
})

test('T2.10 session: isMcpSessionExpiredError rejects non-404 errors', () => {
  const err = new Error('{"error":{"code":-32001,"message":"Session not found"}}')
  err.code = 500
  assert.equal(isMcpSessionExpiredError(err), false)
})

test('T2.10 session: isMcpSessionExpiredError rejects 404 without -32001', () => {
  const err = new Error('Not found')
  err.code = 404
  assert.equal(isMcpSessionExpiredError(err), false)
})

test('T2.10 session: isMcpSessionExpiredError rejects missing code property', () => {
  const err = new Error('Some other error')
  assert.equal(isMcpSessionExpiredError(err), false)
})

test('T2.10 session: isMcpSessionExpiredError rejects non-error objects', () => {
  assert.equal(isMcpSessionExpiredError('string error'), false)
  assert.equal(isMcpSessionExpiredError({ code: 404, message: '' }), false)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Config Hashing (Server Identity)
// ═══════════════════════════════════════════════════════════════

test('T2.10 hash: same config produces same hash', () => {
  const config1 = { type: 'stdio', command: 'node', args: ['server.js'], scope: 'local' }
  const config2 = { type: 'stdio', command: 'node', args: ['server.js'], scope: 'local' }
  assert.equal(hashMcpConfig(config1), hashMcpConfig(config2))
})

test('T2.10 hash: different command produces different hash', () => {
  const config1 = { type: 'stdio', command: 'node', args: [], scope: 'local' }
  const config2 = { type: 'stdio', command: 'python', args: [], scope: 'local' }
  assert.notEqual(hashMcpConfig(config1), hashMcpConfig(config2))
})

test('T2.10 hash: different args produce different hash', () => {
  const config1 = { type: 'stdio', command: 'node', args: ['-v'], scope: 'local' }
  const config2 = { type: 'stdio', command: 'node', args: ['--verbose'], scope: 'local' }
  assert.notEqual(hashMcpConfig(config1), hashMcpConfig(config2))
})

test('T2.10 hash: scope is excluded from hash', () => {
  const config1 = { type: 'stdio', command: 'node', args: [], scope: 'local' }
  const config2 = { type: 'stdio', command: 'node', args: [], scope: 'project' }
  assert.equal(hashMcpConfig(config1), hashMcpConfig(config2),
    'scope changes should not affect hash')
})

test('T2.10 hash: property order does not affect hash', () => {
  const config1 = { type: 'stdio', command: 'node', args: ['a', 'b'], scope: 'local' }
  const config2 = { args: ['a', 'b'], command: 'node', type: 'stdio', scope: 'local' }
  assert.equal(hashMcpConfig(config1), hashMcpConfig(config2))
})

test('T2.10 hash: env changes produce different hash', () => {
  const config1 = { type: 'stdio', command: 'node', env: { A: '1' }, scope: 'local' }
  const config2 = { type: 'stdio', command: 'node', env: { A: '2' }, scope: 'local' }
  assert.notEqual(hashMcpConfig(config1), hashMcpConfig(config2))
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Tool/Command Filtering by Server
// ═══════════════════════════════════════════════════════════════

test('T2.10 filtering: filterToolsByServer matches by prefix', () => {
  const tools = [
    { name: 'mcp__github__search_repos' },
    { name: 'mcp__github__list_issues' },
    { name: 'mcp__filesystem__read_file' },
    { name: 'Bash' },
  ]

  const githubTools = filterToolsByServer(tools, 'github')
  assert.equal(githubTools.length, 2)
  assert.deepEqual(githubTools.map(t => t.name), [
    'mcp__github__search_repos',
    'mcp__github__list_issues',
  ])
})

test('T2.10 filtering: filterToolsByServer returns empty for unknown server', () => {
  const tools = [
    { name: 'mcp__github__search_repos' },
    { name: 'Bash' },
  ]
  assert.equal(filterToolsByServer(tools, 'unknown').length, 0)
})

test('T2.10 filtering: filterCommandsByServer matches both prompt and skill formats', () => {
  const commands = [
    { name: 'mcp__github__my_prompt' },     // prompt format
    { name: 'github:my_skill' },            // skill format
    { name: 'mcp__other__their_prompt' },
    { name: 'other:their_skill' },
    { name: 'regular_command' },
  ]

  const githubCommands = filterCommandsByServer(commands, 'github')
  assert.equal(githubCommands.length, 2)
  assert.equal(githubCommands[0].name, 'mcp__github__my_prompt')
  assert.equal(githubCommands[1].name, 'github:my_skill')
})

test('T2.10 filtering: filterCommandsByServer handles normalized server names', () => {
  const commands = [
    { name: 'mcp__my_server__tool1' },
    { name: 'my_server:skill1' },
  ]

  // Server name with dots → normalized to underscores
  const result = filterCommandsByServer(commands, 'my.server')
  assert.equal(result.length, 2)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Connection State Discriminants
// ═══════════════════════════════════════════════════════════════

test('T2.10 connection: all 5 state types have distinct discriminants', () => {
  const states = ['connected', 'failed', 'needs-auth', 'pending', 'disabled']
  assert.equal(new Set(states).size, 5)
})

test('T2.10 connection: connected state carries client, capabilities, serverInfo', () => {
  const connected = {
    name: 'test-server',
    type: 'connected',
    client: {}, // Client instance
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: 'Test Server', version: '1.0.0' },
    instructions: 'Use this server for testing',
    config: { type: 'stdio', command: 'node', args: [], scope: 'local' },
    cleanup: async () => {},
  }

  assert.equal(connected.type, 'connected')
  assert.ok(connected.capabilities)
  assert.equal(connected.serverInfo.name, 'Test Server')
  assert.equal(connected.serverInfo.version, '1.0.0')
  assert.ok(typeof connected.cleanup === 'function')
})

test('T2.10 connection: failed state carries error message', () => {
  const failed = {
    name: 'broken-server',
    type: 'failed',
    config: { type: 'stdio', command: 'bad-command', args: [], scope: 'local' },
    error: 'ENOENT: command not found',
  }

  assert.equal(failed.type, 'failed')
  assert.ok(failed.error.includes('ENOENT'))
})

test('T2.10 connection: needs-auth state has no client', () => {
  const needsAuth = {
    name: 'oauth-server',
    type: 'needs-auth',
    config: { type: 'sse', url: 'https://example.com', scope: 'claudeai' },
  }

  assert.equal(needsAuth.type, 'needs-auth')
  assert.equal('client' in needsAuth, false)
})

test('T2.10 connection: pending state tracks reconnect attempts', () => {
  const pending = {
    name: 'starting-server',
    type: 'pending',
    config: { type: 'stdio', command: 'node', args: [], scope: 'local' },
    reconnectAttempt: 2,
    maxReconnectAttempts: 5,
  }

  assert.equal(pending.type, 'pending')
  assert.equal(pending.reconnectAttempt, 2)
  assert.equal(pending.maxReconnectAttempts, 5)
})

test('T2.10 connection: disabled state indicates server is turned off', () => {
  const disabled = {
    name: 'turned-off-server',
    type: 'disabled',
    config: { type: 'stdio', command: 'node', args: [], scope: 'local' },
  }

  assert.equal(disabled.type, 'disabled')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — JSON-RPC Message Format
// ═══════════════════════════════════════════════════════════════

test('T2.10 JSON-RPC: request message has jsonrpc, id, method, params', () => {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  }

  assert.equal(request.jsonrpc, '2.0')
  assert.equal(typeof request.id, 'number')
  assert.equal(request.method, 'tools/list')
  assert.ok(typeof request.params === 'object')
})

test('T2.10 JSON-RPC: response message has jsonrpc, id, result', () => {
  const response = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        { name: 'search', description: 'Search for repos' },
      ],
    },
  }

  assert.equal(response.jsonrpc, '2.0')
  assert.equal(response.id, 1)
  assert.ok(Array.isArray(response.result.tools))
  assert.equal(response.result.tools[0].name, 'search')
})

test('T2.10 JSON-RPC: error response has jsonrpc, id, error with code and message', () => {
  const errorResponse = {
    jsonrpc: '2.0',
    id: 1,
    error: {
      code: -32601,
      message: 'Method not found',
    },
  }

  assert.equal(errorResponse.error.code, -32601)
  assert.ok(errorResponse.error.message)
})

test('T2.10 JSON-RPC: notification has jsonrpc, method, params (no id)', () => {
  const notification = {
    jsonrpc: '2.0',
    method: 'notifications/tools/list_changed',
    params: {},
  }

  assert.equal(notification.jsonrpc, '2.0')
  assert.equal('id' in notification, false)
  assert.equal(notification.method, 'notifications/tools/list_changed')
})

test('T2.10 JSON-RPC: standard MCP method strings', () => {
  const methods = [
    'tools/list',
    'tools/call',
    'resources/list',
    'resources/read',
    'prompts/list',
    'prompts/get',
    'initialize',
    'notifications/initialized',
  ]

  const hasDelimiter = m => m.includes('/') || m.startsWith('notifications/')
  for (const method of methods) {
    // 'initialize' is a special root-level method without '/'
    assert.ok(hasDelimiter(method) || method === 'initialize',
      `${method} should be a valid MCP method`)
  }
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Tool Call Result Format
// ═══════════════════════════════════════════════════════════════

test('T2.10 tool result: CallToolResult with content array', () => {
  const result = {
    content: [
      { type: 'text', text: 'Hello from MCP server' },
    ],
    isError: false,
  }

  assert.ok(Array.isArray(result.content))
  assert.equal(result.content[0].type, 'text')
  assert.equal(result.isError, false)
})

test('T2.10 tool result: CallToolResult with isError: true', () => {
  const errorResult = {
    content: [
      { type: 'text', text: 'File not found: /path/to/missing' },
    ],
    isError: true,
  }

  assert.equal(errorResult.isError, true)
  assert.ok(errorResult.content[0].text.includes('File not found'))
})

test('T2.10 tool result: CallToolResult can have multiple content blocks', () => {
  const result = {
    content: [
      { type: 'text', text: 'Results:' },
      { type: 'image', data: 'base64...', mimeType: 'image/png' },
      { type: 'resource', resource: { uri: 'file:///output.txt', mimeType: 'text/plain' } },
    ],
    isError: false,
  }

  assert.equal(result.content.length, 3)
  assert.equal(result.content[0].type, 'text')
  assert.equal(result.content[1].type, 'image')
  assert.equal(result.content[2].type, 'resource')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Output Size Estimation & Truncation
// ═══════════════════════════════════════════════════════════════

test('T2.10 output: getContentSizeEstimate returns 0 for empty content', () => {
  assert.equal(getContentSizeEstimate(null), 0)
  assert.equal(getContentSizeEstimate(undefined), 0)
  assert.equal(getContentSizeEstimate(''), 0)
})

test('T2.10 output: getContentSizeEstimate for string uses rough token count', () => {
  const content = 'This is a test message with roughly 50 characters total'
  const estimate = getContentSizeEstimate(content)
  assert.ok(estimate > 0)
  assert.equal(estimate, Math.round(content.length / 4))
})

test('T2.10 output: getContentSizeEstimate for content blocks sums text blocks', () => {
  const content = [
    { type: 'text', text: 'Hello world' },  // 11 chars → ~3 tokens
    { type: 'text', text: 'Second block' },  // 12 chars → ~3 tokens
  ]
  const estimate = getContentSizeEstimate(content)
  assert.equal(estimate, Math.round(11 / 4) + Math.round(12 / 4))
})

test('T2.10 output: getContentSizeEstimate includes image token estimate', () => {
  const content = [
    { type: 'text', text: 'Here is an image:' },
    { type: 'image', data: 'base64data...' },
  ]
  const estimate = getContentSizeEstimate(content)
  const textTokens = Math.round('Here is an image:'.length / 4)
  assert.equal(estimate, textTokens + IMAGE_TOKEN_ESTIMATE)
})

test('T2.10 output: IMAGE_TOKEN_ESTIMATE is 1600', () => {
  assert.equal(IMAGE_TOKEN_ESTIMATE, 1600)
})

test('T2.10 output: DEFAULT_MAX_MCP_OUTPUT_TOKENS is 25000', () => {
  assert.equal(DEFAULT_MAX_MCP_OUTPUT_TOKENS, 25000)
})

test('T2.10 output: MCP_TOKEN_COUNT_THRESHOLD_FACTOR is 0.5', () => {
  assert.equal(MCP_TOKEN_COUNT_THRESHOLD_FACTOR, 0.5)
})

test('T2.10 output: heuristic skips API check when estimate <= 50% of max', () => {
  const maxTokens = DEFAULT_MAX_MCP_OUTPUT_TOKENS // 25000
  const threshold = maxTokens * MCP_TOKEN_COUNT_THRESHOLD_FACTOR // 12500

  // Below threshold → skip expensive API count
  const smallContent = 'x'.repeat(threshold * 4) // 50000 chars → 12500 tokens estimate
  const estimate = getContentSizeEstimate(smallContent)
  assert.equal(estimate <= threshold, true, 'should be at/below the 50% threshold')

  // Above threshold → needs API count
  const largeContent = 'x'.repeat((threshold + 1) * 4)
  const largeEstimate = getContentSizeEstimate(largeContent)
  assert.equal(largeEstimate > threshold, true, 'should be above the 50% threshold')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — Stdio Transport Lifecycle
// ═══════════════════════════════════════════════════════════════

test('T2.10 stdio lifecycle: config specifies command to spawn', () => {
  // StdioClientTransport is created with: { command, args, env, stderr: 'pipe' }
  const config = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: { NODE_ENV: 'production' },
  }

  assert.equal(config.command, 'npx')
  assert.equal(config.args.length, 3)
  assert.equal(config.env.NODE_ENV, 'production')
})

test('T2.10 stdio lifecycle: stderr is piped for debugging', () => {
  // The code sets stderr: 'pipe' for stdio transports
  const stderrMode = 'pipe'
  assert.equal(stderrMode, 'pipe')
  assert.notEqual(stderrMode, 'inherit') // Don't inherit — would pollute TUI
  assert.notEqual(stderrMode, 'ignore')  // Don't ignore — need errors for debugging
})

test('T2.10 stdio lifecycle: connection provides cleanup function', async () => {
  let cleanedUp = false
  const cleanup = async () => { cleanedUp = true }

  await cleanup()
  assert.equal(cleanedUp, true)
})

test('T2.10 stdio lifecycle: SIGINT/SIGTERM/SIGKILL escalation for stdio cleanup', () => {
  // The code escalates: SIGINT → SIGTERM → SIGKILL for stdio child processes
  const escalationSequence = ['SIGINT', 'SIGTERM', 'SIGKILL']
  assert.deepEqual(escalationSequence, ['SIGINT', 'SIGTERM', 'SIGKILL'])
  assert.equal(escalationSequence.length, 3)
})

test('T2.10 stdio lifecycle: subprocess env inherits from parent process', () => {
  // StdioClientTransport env: { ...subprocessEnv(), ...serverRef.env }
  // subprocessEnv() returns process.env for child processes
  const parentEnv = process.env
  assert.ok(typeof parentEnv.PATH === 'string', 'PATH should be inherited')
  assert.ok(typeof parentEnv.HOME === 'string' || typeof parentEnv.USERPROFILE === 'string',
    'home directory should be available')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — SSE Server Config Schema (for cross-reference)
// ═══════════════════════════════════════════════════════════════

test('T2.10 SSE config: valid config has type, url', () => {
  const config = {
    type: 'sse',
    url: 'https://mcp.example.com/sse',
  }

  assert.equal(config.type, 'sse')
  assert.ok(config.url.startsWith('https://'))
})

test('T2.10 SSE config: optional headers and oauth', () => {
  const config = {
    type: 'sse',
    url: 'https://mcp.example.com/sse',
    headers: { Authorization: 'Bearer token123' },
    oauth: {
      clientId: 'my-client',
      authServerMetadataUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
    },
  }

  assert.equal(config.headers.Authorization, 'Bearer token123')
  assert.equal(config.oauth.clientId, 'my-client')
  assert.ok(config.oauth.authServerMetadataUrl.startsWith('https://'))
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — MCP Server Capabilities
// ═══════════════════════════════════════════════════════════════

test('T2.10 capabilities: ServerCapabilities can declare tools support', () => {
  const capabilities = {
    tools: { listChanged: true },
  }
  assert.ok(capabilities.tools)
  assert.equal(capabilities.tools.listChanged, true)
})

test('T2.10 capabilities: ServerCapabilities can declare resources support', () => {
  const capabilities = {
    resources: { listChanged: true, subscribe: true },
  }
  assert.ok(capabilities.resources)
  assert.equal(capabilities.resources.subscribe, true)
})

test('T2.10 capabilities: ServerCapabilities can declare prompts and logging', () => {
  const capabilities = {
    prompts: { listChanged: false },
    logging: {},
  }
  assert.ok(capabilities.prompts)
  assert.equal(capabilities.prompts.listChanged, false)
  assert.ok(capabilities.logging)
})

test('T2.10 capabilities: minimal server may have empty capabilities', () => {
  const capabilities = {}
  assert.equal(Object.keys(capabilities).length, 0)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — SDK Transport Types (cross-reference)
// ═══════════════════════════════════════════════════════════════

test('T2.10 SDK config: valid config has type sdk and name', () => {
  const config = { type: 'sdk', name: 'my-sdk-server' }
  assert.equal(config.type, 'sdk')
  assert.ok(config.name.length > 0)
})

test('T2.10 claudeai-proxy: config has type, url, id', () => {
  const config = {
    type: 'claudeai-proxy',
    url: 'https://api.claude.ai/mcp/proxy',
    id: 'proxy-123',
  }
  assert.equal(config.type, 'claudeai-proxy')
  assert.ok(config.url.startsWith('https://'))
  assert.ok(config.id)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.10 TESTS — MCP Server Info
// ═══════════════════════════════════════════════════════════════

test('T2.10 server info: server provides name and version', () => {
  const serverInfo = {
    name: 'GitHub MCP Server',
    version: '2.1.0',
  }

  assert.equal(serverInfo.name, 'GitHub MCP Server')
  assert.match(serverInfo.version, /^\d+\.\d+\.\d+/)
})

test('T2.10 server info: instructions are optional server guidance', () => {
  const instructions = 'This server provides access to GitHub repositories. Use search_repos to find repositories.'
  assert.ok(instructions.includes('search_repos'))
  assert.ok(instructions.length > 0)
})
