// Tests for the tool contract layer (P1.1 / contracts/22 v2): registry
// validation of frozen declaration fields, conservative default resolution,
// loop enforcement of deadlines and output budgets, and the tool error-code
// vocabulary surfaced on executed calls.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createToolRegistry, resolveToolContract } from '../../src/harness/tools/registry.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { runAgentLoop } from '../../src/harness/loop.ts'
import { LOOP_CONTRACT_VERSION } from '../../src/harness/types.ts'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function makeContext(cwd) {
  return { cwd, state: { readFiles: new Set() } }
}

function baseTool(overrides = {}) {
  return {
    name: 'Stub',
    description: 'stub',
    readOnly: true,
    inputSchema: { type: 'object' },
    execute: async () => ({ content: 'ok' }),
    ...overrides,
  }
}

// ── registry validation ──

test('registry: accepts a plain v1-shaped tool and resolves conservative defaults', () => {
  const registry = createToolRegistry([baseTool()])
  assert.deepEqual(registry.contractOf('Stub'), {
    version: LOOP_CONTRACT_VERSION,
    sideEffect: 'read',
    timeoutMs: null,
    outputLimitBytes: null,
    cancellable: false,
    idempotent: false,
    sensitive: false,
    namespace: null,
  })
})

test('registry: tools without extensions default their sideEffect from readOnly', () => {
  const registry = createToolRegistry([
    baseTool({ name: 'Writer', readOnly: false }),
  ])
  assert.equal(registry.contractOf('Writer').sideEffect, 'write')
})

test('registry: rejects unknown/newer contract versions', () => {
  assert.throws(() => createToolRegistry([baseTool({ version: 2 })]), /newer than the harness speaks/)
  assert.throws(() => createToolRegistry([baseTool({ version: 0 })]), /positive integer/)
  assert.throws(() => createToolRegistry([baseTool({ version: 1.5 })]), /positive integer/)
})

test('registry: rejects bad sideEffect values and the read/readOnly contradiction', () => {
  assert.throws(() => createToolRegistry([baseTool({ sideEffect: 'quantum' })]), /sideEffect must be one of/)
  assert.throws(
    () => createToolRegistry([baseTool({ sideEffect: 'read', readOnly: false })]),
    /sideEffect 'read' requires readOnly: true/,
  )
  // Orthogonal combos stay legal: read-only network access, plan-safe writes.
  assert.doesNotThrow(() => createToolRegistry([baseTool({ sideEffect: 'network' })]))
  assert.doesNotThrow(() =>
    createToolRegistry([baseTool({ name: 'State', sideEffect: 'write' })]),
  )
})

test('registry: rejects non-positive budgets and malformed namespaces', () => {
  assert.throws(() => createToolRegistry([baseTool({ timeoutMs: 0 })]), /timeoutMs must be a positive number/)
  assert.throws(() => createToolRegistry([baseTool({ outputLimitBytes: -5 })]), /outputLimitBytes must be a positive number/)
  assert.throws(() => createToolRegistry([baseTool({ namespace: 'no-separator' })]), /namespace/)
  assert.doesNotThrow(() => createToolRegistry([baseTool({ namespace: 'mcp.github.create_issue' })]))
})

test('core tools: every declaration resolves version 1 and consistent classes', () => {
  const registry = createToolRegistry(createCoreTools())
  const expectedSideEffect = {
    Read: 'read',
    Glob: 'read',
    Grep: 'read',
    Write: 'write',
    Edit: 'write',
    Bash: 'process',
    TodoWrite: 'write',
    WebFetch: 'network',
  }
  for (const tool of registry.list()) {
    const contract = resolveToolContract(tool)
    assert.equal(contract.version, 1, `${tool.name} version`)
    assert.equal(contract.sideEffect, expectedSideEffect[tool.name], `${tool.name} sideEffect`)
    assert.equal(typeof contract.outputLimitBytes, 'number', `${tool.name} output budget`)
  }
  // Read-class tools declare cancellable + a loop deadline.
  for (const name of ['Read', 'Glob', 'Grep', 'WebFetch']) {
    const contract = registry.contractOf(name)
    assert.equal(contract.cancellable, true, `${name} cancellable`)
    assert.ok(contract.timeoutMs > 0, `${name} deadline`)
  }
  // Bash manages its own internal deadline; no loop-level double-kill.
  assert.equal(registry.contractOf('Bash').timeoutMs, null)
})

// ── loop enforcement ──

test('loop: unknown tool and denied calls carry machine-readable codes', async () => {
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      yield { type: 'tool_call', toolCall: { id: 'c1', name: 'NoSuchTool', input: {} } }
      yield { type: 'response_end', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      // Second turn: a denied Write in plan mode.
      yield { type: 'response_start', messageId: 'm2', model: 'stub-model', provider: 'stub' }
      yield { type: 'tool_call', toolCall: { id: 'c2', name: 'Write', input: { file_path: 'x.txt', content: 'y' } } }
      yield { type: 'response_end', finishReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  }
  const writeTool = createCoreTools().find(tool => tool.name === 'Write')
  const result = await runAgentLoop({
    provider,
    model: 'stub-model',
    system: 'sys',
    tools: [writeTool],
    messages: [{ role: 'user', content: 'go' }],
    permissionMode: 'plan',
    cwd: process.cwd(),
    transcript: { enabled: false },
  })

  const unknown = result.toolCalls.find(call => call.name === 'NoSuchTool')
  assert.equal(unknown.code, 'not_found')
  const denied = result.toolCalls.find(call => call.name === 'Write')
  assert.equal(denied.code, 'policy_denied')
})

test('loop: boundary violations surface the boundary error code', async () => {
  const workspace = await createTempDir('zcode-contract-boundary-')
  const outside = await createTempDir('zcode-contract-outside-')
  try {
    const provider = {
      id: 'stub',
      kind: 'openai',
      streamChat: async function* () {
        yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
        yield {
          type: 'tool_call',
          toolCall: { id: 'c1', name: 'Read', input: { file_path: path.join(outside, 'secret.txt') } },
        }
        yield { type: 'response_end', finishReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      },
    }
    const readTool = createCoreTools().find(tool => tool.name === 'Read')
    const result = await runAgentLoop({
      provider,
      model: 'stub-model',
      system: 'sys',
      tools: [readTool],
      messages: [{ role: 'user', content: 'read it' }],
      permissionMode: 'yolo',
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
      transcript: { enabled: false },
    })
    assert.equal(result.toolCalls[0].isError, true)
    assert.equal(result.toolCalls[0].code, 'boundary')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('loop: cancellable tool with a deadline is stopped at the timeout with code timeout', async () => {
  let sawAbort = false
  const slowTool = baseTool({
    name: 'Slow',
    cancellable: true,
    timeoutMs: 50,
    execute: async (_input, context) =>
      new Promise(resolve => {
        context.signal?.addEventListener('abort', () => {
          sawAbort = true
        })
        setTimeout(() => resolve({ content: 'too late' }), 5_000)
      }),
  })
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      yield { type: 'tool_call', toolCall: { id: 'c1', name: 'Slow', input: {} } }
      yield { type: 'response_end', finishReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  }
  const result = await runAgentLoop({
    provider,
    model: 'stub-model',
    system: 'sys',
    tools: [slowTool],
    messages: [{ role: 'user', content: 'go' }],
    permissionMode: 'yolo',
    cwd: process.cwd(),
    transcript: { enabled: false },
  })
  assert.equal(result.toolCalls[0].isError, true)
  assert.equal(result.toolCalls[0].code, 'timeout')
  assert.match(result.toolCalls[0].result, /exceeded its 50ms deadline/)
  assert.equal(sawAbort, true, 'the tool signal was aborted at the deadline')
})

test('loop: declared output budget truncates oversized results', async () => {
  const chattyTool = baseTool({
    name: 'Chatty',
    outputLimitBytes: 100,
    execute: async () => ({ content: 'x'.repeat(500) }),
  })
  const provider = {
    id: 'stub',
    kind: 'openai',
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
      yield { type: 'tool_call', toolCall: { id: 'c1', name: 'Chatty', input: {} } }
      yield { type: 'response_end', finishReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  }
  const result = await runAgentLoop({
    provider,
    model: 'stub-model',
    system: 'sys',
    tools: [chattyTool],
    messages: [{ role: 'user', content: 'go' }],
    permissionMode: 'yolo',
    cwd: process.cwd(),
    transcript: { enabled: false },
  })
  const call = result.toolCalls[0]
  assert.ok(call.result.length < 500, 'truncated')
  assert.match(call.result, /\[output truncated at 100 bytes \(tool contract\)\]/)
})

test('loop: provider declaring an unknown contract version fails fast at start', async () => {
  const provider = {
    id: 'stub',
    contractVersion: 99,
    streamChat: async function* () {
      yield { type: 'response_start', messageId: 'm1', model: 'stub-model', provider: 'stub' }
    },
  }
  await assert.rejects(
    () =>
      runAgentLoop({
        provider,
        system: 'sys',
        tools: [],
        messages: [{ role: 'user', content: 'hi' }],
        permissionMode: 'yolo',
        cwd: process.cwd(),
        transcript: { enabled: false },
      }),
    /contract version 99/,
  )
})
