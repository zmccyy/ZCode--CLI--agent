import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { evaluateGuardrails } from '../../src/harness/guardrails.ts'
import { checkPermission, describeMode } from '../../src/harness/permissions.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function makeProvider(server) {
  return createOpenAICompatibleProvider({
    provider: 'fake',
    model: 'fake-model',
    baseUrl: server.openaiBaseUrl,
    apiKey: 'test',
  })
}

// ─── Write-side scripts through the real loop ───

test('write-side script: Write → Bash verify → final report (yolo)', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      {
        toolCalls: [
          { name: 'Write', input: { file_path: 'hello.js', content: 'console.log("hello harness");\n' } },
        ],
      },
      {
        toolCalls: [{ name: 'Bash', input: { command: 'node hello.js' } }],
      },
      { text: 'Created hello.js and verified it prints: hello harness' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m2-write-')

  try {
    const result = await runAgentLoop({
      provider: makeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Create hello.js and run it.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.toolCalls.length, 2)
    assert.equal(result.toolCalls[0].name, 'Write')
    assert.equal(result.toolCalls[0].isError, false)
    assert.equal(result.toolCalls[1].name, 'Bash')
    assert.equal(result.toolCalls[1].isError, false)
    assert.match(result.toolCalls[1].result, /hello harness/)
    assert.match(result.text, /verified/)

    const written = await fs.readFile(path.join(workspace, 'hello.js'), 'utf8')
    assert.equal(written, 'console.log("hello harness");\n')
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('UC-03-shaped script: Grep → Read → Bash → Edit → Bash until tests pass', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { toolCalls: [{ name: 'Grep', input: { pattern: 'expected', glob: '*.test.js' } }] },
      { toolCalls: [{ name: 'Read', input: { file_path: 'calc.js' } }] },
      { toolCalls: [{ name: 'Bash', input: { command: 'node calc.test.js' } }] },
      {
        toolCalls: [
          {
            name: 'Edit',
            input: {
              file_path: 'calc.js',
              old_string: 'return a - b',
              new_string: 'return a + b',
            },
          },
        ],
      },
      { toolCalls: [{ name: 'Bash', input: { command: 'node calc.test.js' } }] },
      { text: 'All tests pass now. The add function had a sign error; fixed and verified.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m2-uc03-')

  try {
    await fs.writeFile(
      path.join(workspace, 'calc.js'),
      'function add(a, b) {\n  return a - b\n}\nmodule.exports = { add }\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(workspace, 'calc.test.js'),
      'const assert = require("node:assert")\n' +
        'const { add } = require("./calc.js")\n' +
        'assert.equal(add(1, 1), 2, "expected 2")\n' +
        'console.log("all tests pass")\n',
      'utf8',
    )

    const result = await runAgentLoop({
      provider: makeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Fix all failing tests.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'end_turn')
    assert.equal(result.turns, 6)
    assert.deepEqual(
      result.toolCalls.map(call => call.name),
      ['Grep', 'Read', 'Bash', 'Edit', 'Bash'],
    )
    // The first Bash intentionally runs the still-failing tests; everything else succeeds.
    assert.ok(result.toolCalls.filter((call, index) => index !== 2).every(call => call.isError === false))
    assert.match(result.toolCalls[2].result, /exited with code 1/)
    assert.match(result.toolCalls[4].result, /all tests pass/)
    assert.match(result.text, /All tests pass/)

    const fixed = await fs.readFile(path.join(workspace, 'calc.js'), 'utf8')
    assert.match(fixed, /return a \+ b/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

// ─── Agent mode confirmation flow ───

test('agent mode asks for confirmation; declining feeds the denial back', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { toolCalls: [{ name: 'Write', input: { file_path: 'declined.txt', content: 'x' } }] },
      { toolCalls: [{ name: 'Write', input: { file_path: 'approved.txt', content: 'y' } }] },
      { text: 'One write was declined, one approved.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m2-agent-')

  try {
    const decisions = [false, true]
    const confirmations = []
    const events = []
    const result = await runAgentLoop({
      provider: makeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'write two files' }],
      permissionMode: 'agent',
      confirm: request => {
        confirmations.push(request.toolName)
        return decisions.shift()
      },
      cwd: workspace,
      onEvent: event => events.push(event),
      transcript: { enabled: false },
    })

    assert.deepEqual(confirmations, ['Write', 'Write'])
    assert.equal(result.toolCalls[0].isError, true)
    assert.match(result.toolCalls[0].result, /user declined/i)
    assert.equal(result.toolCalls[1].isError, false)

    await assert.rejects(fs.access(path.join(workspace, 'declined.txt')))
    assert.equal(await fs.readFile(path.join(workspace, 'approved.txt'), 'utf8'), 'y')

    assert.ok(events.some(event => event.type === 'permission_request' && event.name === 'Write'))
    assert.ok(events.some(event => event.type === 'permission_denied' && event.name === 'Write'))

    // Read-only tools never triggered a confirmation.
    const secondRequest = server.requests[1].body
    const toolResults = secondRequest.messages.filter(message => message.role === 'tool')
    assert.equal(toolResults.length, 1)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('agent mode without an approver denies fail-closed', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { toolCalls: [{ name: 'Bash', input: { command: 'echo should-not-run' } }] },
      { text: 'Understood, I cannot run commands here.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m2-failclosed-')

  try {
    const result = await runAgentLoop({
      provider: makeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'run echo' }],
      permissionMode: 'agent',
      cwd: workspace,
      transcript: { enabled: false },
    })

    assert.equal(result.toolCalls[0].isError, true)
    assert.match(result.toolCalls[0].result, /no approver is available/)
    assert.match(result.toolCalls[0].result, /--yolo/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('checkPermission unit: plan denies, yolo allows, agent gates writes only', async () => {
  const readOnlyTool = { toolName: 'Read', readOnly: true, input: {} }
  const writeTool = { toolName: 'Write', readOnly: false, input: {} }

  assert.equal((await checkPermission({ mode: 'plan', ...readOnlyTool })).allowed, true)
  const planWrite = await checkPermission({ mode: 'plan', ...writeTool })
  assert.equal(planWrite.allowed, false)
  assert.match(planWrite.reason, /Plan mode is read-only/)

  assert.equal((await checkPermission({ mode: 'yolo', ...writeTool })).allowed, true)

  const agentWrite = await checkPermission({
    mode: 'agent',
    ...writeTool,
    confirm: () => true,
  })
  assert.equal(agentWrite.allowed, true)

  const agentDeclined = await checkPermission({
    mode: 'agent',
    ...writeTool,
    confirm: () => false,
  })
  assert.equal(agentDeclined.allowed, false)

  const agentNoApprover = await checkPermission({ mode: 'agent', ...writeTool })
  assert.equal(agentNoApprover.allowed, false)
  assert.match(agentNoApprover.reason, /no approver/)

  assert.equal(describeMode('plan'), 'Plan mode: read-only exploration, no writes or commands')
})

// ─── Guardrails ───

test('max turns guardrail stops an endless tool loop and reports progress', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [{ toolCalls: [{ name: 'Glob', input: { pattern: '*' } }] }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m2-turns-')

  try {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'a', 'utf8')
    const result = await runAgentLoop({
      provider: makeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'loop forever' }],
      permissionMode: 'yolo',
      cwd: workspace,
      maxTurns: 3,
      transcript: { enabled: false },
    })

    assert.equal(result.stopReason, 'max_turns')
    assert.equal(result.turns, 3)
    assert.equal(result.toolCalls.length, 3)
    assert.ok(result.toolCalls.every(call => call.name === 'Glob' && call.isError === false))
    // Honest progress report: the executed history is present even though the model never finished.
    assert.ok(result.messages.length >= 6)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('budget guardrail stops the loop when cumulative tokens exceed the cap', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      { toolCalls: [{ name: 'Glob', input: { pattern: '*' } }], usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 } },
      { toolCalls: [{ name: 'Glob', input: { pattern: '*' } }], usage: { prompt_tokens: 600, completion_tokens: 60, total_tokens: 660 } },
      { text: 'never reached' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-m2-budget-')

  try {
    const result = await runAgentLoop({
      provider: makeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'spend tokens' }],
      permissionMode: 'yolo',
      cwd: workspace,
      maxTurns: 10,
      budgetTokens: 1000,
      transcript: { enabled: false },
    })

    // Turn 1 spent 550 (< 1000, continue). Turn 2 spent 660 → cumulative 1210 ≥ 1000.
    assert.equal(result.stopReason, 'budget_exceeded')
    assert.equal(result.turns, 2)
    assert.equal(result.usage.totalTokens, 1210)
    assert.equal(result.toolCalls.length, 2)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('guardrail evaluation unit: max turns fires before budget on equal turns', () => {
  const usage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 }

  assert.deepEqual(evaluateGuardrails({ turnsCompleted: 30, maxTurns: 30, usage, budgetTokens: null }), {
    stop: true,
    reason: 'max_turns',
    message: 'Guardrail reached: 30 turns (max 30). The loop stopped before the model finished; progress is reported as-is.',
  })
  assert.equal(evaluateGuardrails({ turnsCompleted: 29, maxTurns: 30, usage, budgetTokens: null }).stop, false)

  const budget = evaluateGuardrails({ turnsCompleted: 5, maxTurns: 30, usage, budgetTokens: 100 })
  assert.equal(budget.stop, true)
  assert.equal(budget.reason, 'budget_exceeded')
})
