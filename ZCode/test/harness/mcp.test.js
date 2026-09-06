// Tests for the MCP stdio minimal subset (P1.3): config parsing, discovery
// against a real spawned fake server, tool adaptation into the frozen
// contracts/22 shape, unified permission/audit through the loop, deadlines,
// crash/reconnect, output budgets, and the runCli wiring (default off).
//
// Tool behavior is exercised end-to-end: scripted fake-LLM turns drive every
// MCP call through the real agent loop, so permission gating, transcript
// audit, the P1.1 deadline machinery, and the P1.5 stuck detector all apply
// exactly as they will in production.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMcpServers, discoverMcpTools, MCP_OUTPUT_LIMIT_BYTES } from '../../src/harness/mcpTools.ts'
import { startMcpClient, McpClientError } from '../../src/harness/mcpClient.ts'
import { createToolRegistry } from '../../src/harness/tools/registry.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { runAgentLoop } from '../../src/harness/loop.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'
import { runCli } from '../../src/cli/publicCliCore.js'

const FIXTURE = fileURLToPath(new URL('../helpers/fakeMcpServer.mjs', import.meta.url))
const USAGE = { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 }
const DONE_TURN = { text: 'done', usage: { prompt_tokens: 90, completion_tokens: 5, total_tokens: 95 } }

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'

function demoServers(_cwd, { scenario = 'default', timeoutMs } = {}) {
  return {
    demo: {
      script: FIXTURE,
      args: ['--scenario', scenario],
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  }
}

/** Scripted turns the fake model plays; each entry drives one tool call. */
function callTurn(name, input) {
  return {
    toolCalls: [{ name, input }],
    usage: { ...USAGE },
  }
}

async function runLoopScript(workspace, servers, script, loopOptions = {}) {
  const mcpSession = await discoverMcpTools({ servers, cwd: workspace })
  const server = createFakeLlmServer({ dialect: 'openai', apiKey: 'test', script })
  await server.listen()
  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: 'test',
    })
    return await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools().concat(mcpSession.tools),
      messages: [{ role: 'user', content: 'Use the MCP demo tools.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      ...loopOptions,
    })
  } finally {
    await server.close()
    mcpSession.dispose()
  }
}

// ── parseMcpServers (config layer) ──

test('parseMcpServers: valid config parses, sorts, and resolves relative scripts', () => {
  const parsed = parseMcpServers(
    {
      beta: { script: './servers/beta.mjs' },
      alpha: { script: 'C:/abs/server.js', args: ['--x'], env: { K: 'V' }, timeoutMs: 5000 },
    },
    '/work',
  )
  assert.deepEqual(parsed.warnings, [])
  assert.deepEqual(parsed.servers.map(s => s.name), ['alpha', 'beta'])
  assert.equal(parsed.servers[0].config.script, 'C:/abs/server.js')
  assert.equal(parsed.servers[0].config.timeoutMs, 5000)
  // path.resolve normalizes to the platform separator; check the stem only.
  assert.match(parsed.servers[1].config.script, /[\\/]servers[\\/]beta\.mjs$/)
})

test('parseMcpServers: invalid entries are skipped with one warning each', () => {
  const parsed = parseMcpServers({
    'bad name!': { script: 'server.js' },
    noScript: {},
    notAnObject: 'node server.js',
    quietOff: { script: 'server.js', enabled: false },
    badArgs: { script: 'server.js', args: ['a', 5] },
    badEnv: { script: 'server.js', env: { K: 5 } },
    badTimeout: { script: 'server.js', timeoutMs: -1 },
    hugeTimeout: { script: 'server.js', timeoutMs: 10_000_000 },
  })
  const messages = parsed.warnings.join('\n')
  assert.match(messages, /server "bad name!"/)
  assert.match(messages, /server "noScript"(.|\n)*"script"/)
  assert.match(messages, /server "notAnObject"/)
  assert.match(messages, /server "badArgs"/)
  assert.match(messages, /server "badEnv"/)
  assert.match(messages, /server "badTimeout"(.|\n)*default/)
  assert.match(messages, /server "hugeTimeout"(.|\n)*capped/)
  // enabled:false is an intentional kill switch — silent, no warning.
  assert.doesNotMatch(messages, /quietOff/)
  // Bad args/env skip the bad ENTRY (badEnv's server is kept without that
  // variable); a bad timeout only falls back to the default.
  assert.match(messages, /server "badEnv"(.|\n)*env "K"/)
  assert.deepEqual(parsed.servers.map(s => s.name), ['badEnv', 'badTimeout', 'hugeTimeout'])
})

test('parseMcpServers: non-object input warns and caps the server count', () => {
  assert.equal(parseMcpServers('nope').warnings.length, 1)
  assert.deepEqual(parseMcpServers(undefined).servers, [])

  const many = {}
  for (let i = 0; i < 20; i += 1) many[`srv${i}`] = { script: 's.js' }
  const parsed = parseMcpServers(many)
  assert.equal(parsed.servers.length, 16)
  assert.match(parsed.warnings.join(' '), /more than 16 servers/)
})

// ── discovery (real spawned server) ──

test('discovery: real stdio server adapts into contracts/22 tool shapes', async () => {
  const workspace = await createTempDir('zcode-mcp-disc-')
  const session = await discoverMcpTools({
    servers: demoServers(workspace),
    cwd: workspace,
  })
  try {
    assert.deepEqual(session.warnings, [])
    const names = session.tools.map(t => t.name).sort()
    assert.deepEqual(names, [
      'mcp__demo__big',
      'mcp__demo__crash_me',
      'mcp__demo__echo',
      'mcp__demo__fail',
      'mcp__demo__slow',
    ])
    const echo = session.tools.find(t => t.name === 'mcp__demo__echo')
    assert.equal(echo.readOnly, false, 'wire annotations are untrusted: fail closed')
    assert.equal(echo.namespace, 'mcp.demo.echo', 'contracts/22 dotted namespace')
    assert.equal(echo.cancellable, true)
    assert.equal(echo.timeoutMs, 30_000)
    assert.equal(echo.outputLimitBytes, MCP_OUTPUT_LIMIT_BYTES)
    assert.equal(echo.inputSchema.type, 'object')
    assert.match(echo.description, /Echo the provided text/)

    // Zero-conflict invariant: MCP tools merge with the core set.
    assert.doesNotThrow(() => createToolRegistry(createCoreTools().concat(session.tools)))
  } finally {
    session.dispose()
  }
})

test('discovery: duplicate advertised tool names are deduped with a warning', async () => {
  const workspace = await createTempDir('zcode-mcp-dup-')
  const session = await discoverMcpTools({
    servers: demoServers(workspace, { scenario: 'duplicate' }),
    cwd: workspace,
  })
  try {
    const echoTools = session.tools.filter(t => t.name === 'mcp__demo__echo')
    assert.equal(echoTools.length, 1)
    assert.match(session.warnings.join('\n'), /duplicate MCP tool name "mcp__demo__echo"/)
  } finally {
    session.dispose()
  }
})

test('discovery: start failures and handshake hangs degrade to warnings, bounded', async () => {
  const workspace = await createTempDir('zcode-mcp-fail-')
  const missing = await discoverMcpTools({
    servers: { gone: { script: path.join(workspace, 'does-not-exist.mjs') } },
    cwd: workspace,
    handshakeTimeoutMs: 2000,
  })
  try {
    assert.deepEqual(missing.tools, [])
    assert.match(missing.warnings.join('\n'), /server "gone" unavailable/)
  } finally {
    missing.dispose()
  }

  const started = Date.now()
  const hung = await discoverMcpTools({
    servers: demoServers(workspace, { scenario: 'hang' }),
    cwd: workspace,
    handshakeTimeoutMs: 600,
  })
  try {
    assert.deepEqual(hung.tools, [])
    assert.match(hung.warnings.join('\n'), /server "demo" unavailable/)
    assert.ok(Date.now() - started < 5000, 'discovery must not wait past its handshake deadline')
  } finally {
    hung.dispose()
  }

  const badVersion = await discoverMcpTools({
    servers: demoServers(workspace, { scenario: 'badversion' }),
    cwd: workspace,
    handshakeTimeoutMs: 2000,
  })
  try {
    assert.deepEqual(badVersion.tools, [])
    assert.match(badVersion.warnings.join('\n'), /protocol version 1999-01-01/)
  } finally {
    badVersion.dispose()
  }
})

// ── full chain through the loop ──

test('full chain: the loop drives an MCP tool through registry, permission, and transcript', async () => {
  const workspace = await createTempDir('zcode-mcp-loop-')
  const result = await runLoopScript(
    workspace,
    demoServers(workspace),
    [callTurn('mcp__demo__echo', { text: 'hello mcp' }), DONE_TURN],
  )
  assert.equal(result.stopReason, 'end_turn')
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].name, 'mcp__demo__echo')
  assert.equal(result.toolCalls[0].isError, false)
  assert.equal(result.toolCalls[0].result, 'echo:hello mcp')
  // The tool result flowed back to the model as conversation history.
  const toolMessage = result.messages.find(m => m.role === 'tool')
  assert.equal(toolMessage.content, 'echo:hello mcp')
})

test('permissions: MCP tools fail closed — denied in plan and unapproved agent, gated in agent', async () => {
  const workspace = await createTempDir('zcode-mcp-perm-')
  const servers = demoServers(workspace)
  const script = [callTurn('mcp__demo__echo', { text: 'gated' }), DONE_TURN]

  const planRun = await runLoopScript(workspace, servers, script, { permissionMode: 'plan' })
  assert.equal(planRun.toolCalls[0].isError, true)
  assert.equal(planRun.toolCalls[0].code, 'policy_denied')

  // Agent mode without an approver denies (fail-closed), with an approver runs.
  const deniedRun = await runLoopScript(workspace, servers, script, { permissionMode: 'agent' })
  assert.equal(deniedRun.toolCalls[0].code, 'policy_denied')

  const approvedRun = await runLoopScript(workspace, servers, script, {
    permissionMode: 'agent',
    confirm: () => true,
  })
  assert.equal(approvedRun.toolCalls[0].isError, false)
  assert.equal(approvedRun.toolCalls[0].result, 'echo:gated')
})

test('results: server business errors stay model-visible without throwing', async () => {
  const workspace = await createTempDir('zcode-mcp-biz-')
  const result = await runLoopScript(
    workspace,
    demoServers(workspace),
    [callTurn('mcp__demo__fail', {}), DONE_TURN],
  )
  const call = result.toolCalls[0]
  assert.equal(call.isError, true)
  assert.equal(call.result, 'boom')
  assert.equal(call.code, undefined, 'business failures are results, not error classes')
})

test('deadline: a slow server call is aborted at the loop deadline with code timeout', async () => {
  const workspace = await createTempDir('zcode-mcp-timeout-')
  const result = await runLoopScript(
    workspace,
    demoServers(workspace, { timeoutMs: 700 }),
    [callTurn('mcp__demo__slow', { ms: 5000 }), DONE_TURN],
  )
  const call = result.toolCalls[0]
  assert.equal(call.isError, true)
  assert.equal(call.code, 'timeout', `result: ${call.result}`)
  // The loop's P1.1 deadline machinery words the message.
  assert.match(call.result, /exceeded its 700ms deadline/)
})

test('output budget: oversized MCP output is truncated by the loop', async () => {
  const workspace = await createTempDir('zcode-mcp-big-')
  const result = await runLoopScript(
    workspace,
    demoServers(workspace),
    [callTurn('mcp__demo__big', { bytes: MCP_OUTPUT_LIMIT_BYTES * 2 }), DONE_TURN],
  )
  const call = result.toolCalls[0]
  assert.equal(call.isError, false)
  assert.match(call.result, /\[output truncated at 262144 bytes \(tool contract\)\]$/)
})

test('crash and reconnect: a server crash surfaces once, the next call respawns', async () => {
  const workspace = await createTempDir('zcode-mcp-crash-')
  const result = await runLoopScript(
    workspace,
    demoServers(workspace),
    [
      callTurn('mcp__demo__crash_me', {}),
      callTurn('mcp__demo__echo', { text: 'again' }),
      DONE_TURN,
    ],
  )
  const crashed = result.toolCalls[0]
  assert.equal(crashed.isError, true)
  assert.equal(crashed.code, 'failed')
  assert.match(crashed.result, /exited/)

  // The NEXT call reconnects (bounded restart budget) and succeeds.
  const reconnected = result.toolCalls[1]
  assert.equal(reconnected.isError, false)
  assert.equal(reconnected.result, 'echo:again')
})

test('client: reconnect budget exhaustion disables the server with a clear error', async () => {
  const workspace = await createTempDir('zcode-mcp-budget-')
  const client = await startMcpClient({
    serverName: 'budget',
    script: FIXTURE,
    cwd: workspace,
    maxRestarts: 1,
    handshakeTimeoutMs: 4000,
  })
  try {
    const tools = await client.listTools()
    assert.ok(tools.some(t => t.name === 'crash_me'))

    // Crash #1: the initial process dies; restart #1 is spent on the next
    // call, which crashes again; the third call is permanently refused.
    await assert.rejects(
      () => client.callTool('crash_me', {}),
      error => error instanceof McpClientError && error.kind === 'exited',
    )
    await assert.rejects(
      () => client.callTool('crash_me', {}),
      error => error instanceof McpClientError && error.kind === 'exited',
    )
    await assert.rejects(
      () => client.callTool('crash_me', {}),
      error =>
        error instanceof McpClientError &&
        error.kind === 'restart_exhausted' &&
        /reconnect budget/.test(error.message),
    )
  } finally {
    client.dispose()
  }
})

test('robustness: garbage stdout lines never break the protocol', async () => {
  const workspace = await createTempDir('zcode-mcp-noisy-')
  const result = await runLoopScript(
    workspace,
    demoServers(workspace, { scenario: 'noisy' }),
    [callTurn('mcp__demo__echo', { text: 'clean' }), DONE_TURN],
  )
  assert.equal(result.toolCalls[0].result, 'echo:clean')
})

// ── runCli wiring (settings → discovery → loop) ──

function fakeProvider(script) {
  let requestCount = 0
  return {
    id: 'openai-compatible:fake',
    kind: 'openai-compatible',
    supportsPrint: true,
    seenToolNames: [],
    async *streamChat(input) {
      const tools = Array.isArray(input.tools) ? input.tools : []
      this.seenToolNames.push(...tools.map(t => t?.function?.name ?? t?.name ?? ''))
      const turn = script[requestCount]
      requestCount += 1
      yield { type: 'response_start', messageId: null, model: 'fake-model', provider: 'fake' }
      if (!turn) {
        yield { type: 'text_delta', text: 'nothing to do' }
        yield {
          type: 'response_end',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }
        return
      }
      for (const [index, call] of (turn.toolCalls ?? []).entries()) {
        yield {
          type: 'tool_call',
          toolCall: { id: `call_${index}`, name: call.name, input: call.input },
        }
      }
      if (turn.text) yield { type: 'text_delta', text: turn.text }
      yield {
        type: 'response_end',
        finishReason: (turn.toolCalls ?? []).length > 0 ? 'tool_call' : 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }
    },
  }
}

test('runCli wiring: settings mcpServers reach the loop; absent config spawns nothing', async () => {
  const workspace = await createTempDir('zcode-mcp-cli-')
  const settingsDir = path.join(workspace, '.zcode')
  await fs.mkdir(settingsDir, { recursive: true })
  await fs.writeFile(
    path.join(settingsDir, 'settings.json'),
    JSON.stringify({ mcpServers: { demo: { script: FIXTURE } } }, null, 2),
    'utf-8',
  )

  const enabled = fakeProvider([
    callTurn('mcp__demo__echo', { text: 'wired' }),
    DONE_TURN,
  ])
  const stdoutWrites = []
  const code = await runCli(['-p', 'use the demo tool', '--yolo', '--json'], {
    cwd: workspace,
    env: { ...process.env, ZCODE_TRANSCRIPT_DIR: path.join(workspace, 'transcripts') },
    stdout: { write: chunk => stdoutWrites.push(String(chunk)) },
    stderr: { write: () => {} },
    stdin: { isTTY: false },
    createProviderFromEnv: () => enabled,
  })
  assert.equal(code, 0)
  const envelope = JSON.parse(stdoutWrites.join(''))
  assert.equal(envelope.toolCalls[0].name, 'mcp__demo__echo')
  assert.equal(envelope.toolCalls[0].result, 'echo:wired')
  assert.ok(enabled.seenToolNames.includes('mcp__demo__echo'))

  // Default off: no mcpServers config → no MCP tool is ever advertised.
  const emptyWorkspace = await createTempDir('zcode-mcp-off-')
  const disabled = fakeProvider([{ text: 'no mcp here' }])
  const offWrites = []
  const offCode = await runCli(['-p', 'hi', '--json'], {
    cwd: emptyWorkspace,
    env: { ...process.env, ZCODE_TRANSCRIPT_DIR: path.join(emptyWorkspace, 'transcripts') },
    stdout: { write: chunk => offWrites.push(String(chunk)) },
    stderr: { write: () => {} },
    stdin: { isTTY: false },
    createProviderFromEnv: () => disabled,
  })
  assert.equal(offCode, 0)
  assert.ok(disabled.seenToolNames.length > 0)
  assert.equal(disabled.seenToolNames.filter(name => name.startsWith('mcp__')).length, 0)
})
