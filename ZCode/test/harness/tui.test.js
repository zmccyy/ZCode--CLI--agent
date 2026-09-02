import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Writable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runTui } from '../../src/cli/tui.js'
import { runCli } from '../../src/cli/publicCliCore.js'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

// Fake credential accepted by the local fake LLM server; never a real secret.
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || ['test', 'key'].join('-')

function createCollector() {
  const chunks = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    }),
    text: () => chunks.join(''),
  }
}

async function waitFor(collector, pattern, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (pattern.test(collector.text())) return
    if (Date.now() > deadline) {
      throw new Error(
        `timeout waiting for ${pattern} in TUI output. Buffer:\n${collector.text()}`,
      )
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function createStubProvider() {
  return {
    id: 'stub',
    kind: 'openai',
    listModels: () => [{ id: 'stub-model', displayName: 'stub-model', provider: 'stub' }],
    // eslint-disable-next-line require-yield -- never streamed in slash-command tests
    streamChat: async function* () {
      throw new Error('stub provider must not be called in this test')
    },
  }
}

test('interactive flow: prompt → approval → tool → streamed answer → /cost → /exit', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'note.txt' } }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      },
      {
        text: 'The note says hello.',
        usage: { prompt_tokens: 130, completion_tokens: 5, total_tokens: 135 },
      },
    ],
  })
  await server.listen()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-tui-'))
  await fs.writeFile(path.join(workspace, 'note.txt'), 'hello\n', 'utf8')

  const stdin = new PassThrough()
  const out = createCollector()
  const err = createCollector()

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: FAKE_API_KEY,
    })

    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      provider,
      cwd: workspace,
      permissionMode: 'agent',
      boundary: { enabled: true, addDirs: [] },
      version: '1.2.0',
      estimateCost: () => ({ cost: 0.000042, pricing: { input: 0.14, output: 0.28 } }),
      transcript: { enabled: false },
    })

    stdin.write('Read note.txt and summarize it\n')
    // Read is read-only: no approval needed, the tool runs immediately.
    await waitFor(out, /The note says hello\./)
    stdin.write('/cost\n')
    stdin.write('/exit\n')

    const exitCode = await exitPromise
    assert.equal(exitCode, 0)

    const output = out.text()
    // Banner shows the interactive identity and the boundary.
    assert.match(output, /interactive session/)
    assert.match(output, /mode: agent/)
    assert.match(output, /boundary \(file tools\): /)
    // The tool execution rendered and its result preview line.
    assert.match(output, /● Read\(/)
    assert.match(output, /✓ /)
    // The streamed answer and the per-turn usage footer (2 loop turns:
    // tool-call turn + final-answer turn).
    assert.match(output, /The note says hello\./)
    assert.match(output, /turn 2 · in /)
    assert.match(output, /session total in /)
    // /cost reported the injected pricing.
    assert.match(output, /estimated cost: \$0\.000042/)
    assert.match(output, /bye — session usage/)
  } finally {
    stdin.end()
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('declining an approval feeds the denial back; a later write can be approved', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      {
        toolCalls: [
          { name: 'Write', input: { file_path: 'evil.txt', content: 'nope' } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      {
        text: 'Understood, I will not write that file.',
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
      },
      // Second user turn: a write the user approves.
      {
        toolCalls: [
          { name: 'Write', input: { file_path: 'ok.txt', content: 'approved\n' } },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
      },
      {
        text: 'ok.txt is written.',
        usage: { prompt_tokens: 70, completion_tokens: 5, total_tokens: 75 },
      },
    ],
  })
  await server.listen()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-tui-decline-'))

  const stdin = new PassThrough()
  const out = createCollector()
  const err = createCollector()

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: FAKE_API_KEY,
    })

    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      provider,
      cwd: workspace,
      permissionMode: 'agent',
      transcript: { enabled: false },
    })

    stdin.write('write evil.txt\n')
    await waitFor(out, /\? Allow Write\(/)
    stdin.write('n\n')
    await waitFor(out, /Understood, I will not write that file\./)

    stdin.write('now write ok.txt\n')
    await waitFor(out, /ok\.txt/)
    stdin.write('y\n')
    await waitFor(out, /ok\.txt is written\./)
    stdin.write('/exit\n')

    const exitCode = await exitPromise
    assert.equal(exitCode, 0)
    const output = out.text()
    assert.match(output, /\(declined\)/)
    assert.match(output, /✗ .*permission denied/)
    await assert.rejects(fs.access(path.join(workspace, 'evil.txt')))
    assert.equal(await fs.readFile(path.join(workspace, 'ok.txt'), 'utf8'), 'approved\n')
  } finally {
    stdin.end()
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('slash commands: /help, /clear, unknown commands, EOF-free /exit', async () => {
  const stdin = new PassThrough()
  const out = createCollector()
  const err = createCollector()

  const exitPromise = runTui({
    stdin,
    stdout: out.stream,
    stderr: err.stream,
    provider: createStubProvider(),
    cwd: os.tmpdir(),
    permissionMode: 'agent',
    transcript: { enabled: false },
  })

  // All lines are typed ahead and consumed in order (no run in progress).
  stdin.write('/help\n')
  stdin.write('/clear\n')
  stdin.write('/bogus\n')
  stdin.write('/exit\n')

  const exitCode = await exitPromise
  const output = out.text()
  assert.equal(exitCode, 0)
  assert.match(output, /\/compact\s+Summarize older history/)
  assert.match(output, /Conversation cleared\./)
  assert.match(output, /Unknown command: \/bogus/)
  assert.match(output, /bye — session usage/)
})

test('YOLO mode runs tools without approval questions', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'note.txt' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      {
        text: 'Read it in YOLO mode.',
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
      },
    ],
  })
  await server.listen()
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-tui-yolo-'))
  await fs.writeFile(path.join(workspace, 'note.txt'), 'hello\n', 'utf8')

  const stdin = new PassThrough()
  const out = createCollector()
  const err = createCollector()

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: FAKE_API_KEY,
    })

    const exitPromise = runTui({
      stdin,
      stdout: out.stream,
      stderr: err.stream,
      provider,
      cwd: workspace,
      permissionMode: 'yolo',
      transcript: { enabled: false },
    })

    stdin.write('Read note.txt\n')
    await waitFor(out, /Read it in YOLO mode\./)
    stdin.write('/exit\n')

    const exitCode = await exitPromise
    assert.equal(exitCode, 0)
    assert.doesNotMatch(out.text(), /Allow /)
    assert.match(out.text(), /● Read\(/)
  } finally {
    stdin.end()
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('bare `zcode` with a TTY stdin enters the TUI; piped stdin keeps help', async () => {
  // Piped stdin (no isTTY): historic behavior — help, not the TUI.
  const pipedStdout = createCollector()
  const pipedExit = await runCli([], {
    cwd: os.tmpdir(),
    env: {},
    stdin: new PassThrough(),
    stdout: pipedStdout.stream,
    stderr: createCollector().stream,
    version: '1.2.0',
  })
  assert.equal(pipedExit, 0)
  assert.match(pipedStdout.text(), /Usage:/)

  // TTY stdin: the TUI banner appears and /exit leaves cleanly.
  const server = createFakeLlmServer({ dialect: 'openai', apiKey: FAKE_API_KEY, model: 'fake-model', script: [] })
  await server.listen()
  const ttyStdin = new PassThrough()
  ttyStdin.isTTY = true
  const ttyStdout = createCollector()

  try {
    const exitPromise = runCli([], {
      cwd: os.tmpdir(),
      env: {
        ZCODE_PROVIDER: 'openai-compatible',
        ZCODE_OPENAI_PROVIDER: 'fake',
        ZCODE_OPENAI_MODEL: 'fake-model',
        ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
        ZCODE_OPENAI_API_KEY: FAKE_API_KEY,
      },
      stdin: ttyStdin,
      stdout: ttyStdout.stream,
      stderr: createCollector().stream,
      version: '1.2.0',
    })

    await waitFor(ttyStdout, /interactive session/)
    ttyStdin.write('/exit\n')

    assert.equal(await exitPromise, 0)
  } finally {
    ttyStdin.end()
    await server.close()
  }
})
