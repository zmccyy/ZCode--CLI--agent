// Regression tests for effective-env threading: runCli merges settings/.env
// into a single `env` object, and every consumer (TUI, print mode, doctor)
// must probe THAT environment instead of the host process's process.env.
// ZCODE_SHELL is the discriminator: the env collector reports the requested
// shell dialect (labelled "(ZCODE_SHELL)") only when it sees the injected env.

import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'

import { runTui } from '../../src/cli/tui.js'
import { runHarnessPrint } from '../../src/cli/harnessPrint.js'
import { createDoctorReport } from '../../src/cli/publicCliCore.js'

function createCollector() {  const chunks = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk))
      callback()
    },
  })
  return { stream, text: () => chunks.join('') }
}

async function waitUntil(condition, timeoutMs = 5000, message = 'condition') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (condition()) return
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${message}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/**
 * Stub provider that records the system prompt it received per turn, so tests
 * can assert which environment facts reached the system prompt. The system
 * prompt arrives as `input.system` (anthropic dialect) or as a leading
 * system-role message (openai dialect).
 */
function createSystemCapturingProvider() {
  const systems = []
  let call = 0
  return {
    id: 'stub',
    kind: 'openai',
    systems,
    listModels: () => [{ id: 'stub-model' }],
    streamChat: async function* (input) {
      const index = call
      call += 1
      const messages = Array.isArray(input?.messages) ? input.messages : []
      const systemMessage = messages.find(message => message.role === 'system')
      systems.push(input?.system ?? systemMessage?.content ?? null)
      yield { type: 'response_start', messageId: `m-${index}`, model: 'stub-model', provider: 'stub' }
      yield { type: 'text_delta', text: 'ok' }
      yield { type: 'response_end', finishReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
}

const EFFECTIVE_ENV = { ZCODE_SHELL: 'pwsh' }

test('TUI: runTui probes the injected env, not process.env', async () => {
  const provider = createSystemCapturingProvider()
  const stdin = new PassThrough()
  const out = createCollector()

  try {
    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: out.stream,
      provider,
      cwd: process.cwd(),
      env: EFFECTIVE_ENV,
      permissionMode: 'agent',
      transcript: { enabled: false },
    })

    stdin.write('hello\n')
    await waitUntil(() => provider.systems.length === 1, 5000, 'first turn system prompt')
    stdin.write('/exit\n')
    assert.equal(await exitPromise, 0)

    assert.match(provider.systems[0], /shell: .*ZCODE_SHELL/)
  } finally {
    stdin.end()
  }
})

test('print mode: runHarnessPrint probes the injected env, not process.env', async () => {
  const provider = createSystemCapturingProvider()

  const result = await runHarnessPrint({
    prompt: 'hello',
    provider,
    cwd: process.cwd(),
    env: EFFECTIVE_ENV,
    permissionMode: 'agent',
    transcript: { enabled: false },
  })

  assert.equal(result.text, 'ok')
  assert.match(provider.systems[0], /shell: .*ZCODE_SHELL/)
})

test('doctor: createDoctorReport probes the injected env, not process.env', async () => {
  const report = await createDoctorReport({
    cwd: process.cwd(),
    env: EFFECTIVE_ENV,
    version: 'test',
  })

  assert.match(report.environment.shell, /ZCODE_SHELL/)
})
