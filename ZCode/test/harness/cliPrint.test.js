import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runCli } from '../../src/cli/publicCliCore.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function createMemoryWriter() {
  let buffer = ''
  return {
    write(chunk) {
      buffer += String(chunk)
    },
    read() {
      return buffer
    },
  }
}

test('CLI print mode runs the full agent loop headless (-p --yolo --json)', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'greeting.txt' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      },
      {
        toolCalls: [
          {
            name: 'Write',
            input: { file_path: 'greeting.txt', content: 'hello from the harness\n' },
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
      },
      {
        text: 'Updated greeting.txt to say hello from the harness.',
        usage: { prompt_tokens: 500, completion_tokens: 30, total_tokens: 530 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-cli-harness-')
  const transcriptDir = path.join(workspace, '.transcripts')

  try {
    await fs.writeFile(path.join(workspace, 'greeting.txt'), 'stale content\n', 'utf8')

    const stdout = createMemoryWriter()
    const stderr = createMemoryWriter()

    const exitCode = await runCli(['-p', 'update greeting.txt', '--yolo', '--json'], {
      cwd: workspace,
      env: {
        ZCODE_PROVIDER: 'openai-compatible',
        ZCODE_OPENAI_PROVIDER: 'fake',
        ZCODE_OPENAI_MODEL: 'fake-model',
        ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
        ZCODE_OPENAI_API_KEY: 'test',
        ZCODE_TRANSCRIPT_DIR: transcriptDir,
      },
      stdout,
      stderr,
      version: '0.1.0',
    })

    assert.equal(exitCode, 0)
    const payload = JSON.parse(stdout.read())

    assert.equal(payload.provider, 'openai-compatible:fake')
    assert.equal(payload.model, 'fake-model')
    assert.equal(payload.text, 'Updated greeting.txt to say hello from the harness.')
    assert.equal(payload.stopReason, 'end_turn')
    assert.equal(payload.runMode, 'yolo')
    assert.equal(payload.turns, 3)
    assert.equal(payload.usage.totalTokens, 960)

    // Executed tool calls with results in the envelope.
    assert.deepEqual(payload.toolCalls.map(call => call.name), ['Read', 'Write'])
    assert.match(payload.toolCalls[0].result, /stale content/)
    assert.match(payload.toolCalls[1].result, /File (created|updated) successfully/)

    // The tool really mutated the workspace.
    assert.equal(
      await fs.readFile(path.join(workspace, 'greeting.txt'), 'utf8'),
      'hello from the harness\n',
    )

    // The transcript landed in the configured directory.
    const transcriptFiles = await fs.readdir(transcriptDir)
    assert.equal(transcriptFiles.length, 1)
    const raw = await fs.readFile(path.join(transcriptDir, transcriptFiles[0]), 'utf8')
    const entryTypes = raw.trim().split('\n').map(line => JSON.parse(line).type)
    assert.equal(entryTypes[0], 'session_start')
    assert.equal(entryTypes[entryTypes.length - 1], 'result')

    // All three requests hit the fake server (multi-turn loop through the CLI).
    assert.equal(server.requestCount, 3)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('CLI text mode renders progress lines and the final answer', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    model: 'fake-model',
    script: [
      { toolCalls: [{ name: 'Glob', input: { pattern: '*.md' } }] },
      { text: 'The workspace has one markdown file.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-cli-text-')
  const transcriptDir = path.join(workspace, '.transcripts')

  try {
    await fs.writeFile(path.join(workspace, 'notes.md'), '# notes\n', 'utf8')

    const stdout = createMemoryWriter()
    const stderr = createMemoryWriter()

    const exitCode = await runCli(['-p', 'what docs exist?', '--yolo'], {
      cwd: workspace,
      env: {
        ZCODE_PROVIDER: 'openai-compatible',
        ZCODE_OPENAI_PROVIDER: 'fake',
        ZCODE_OPENAI_MODEL: 'fake-model',
        ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
        ZCODE_OPENAI_API_KEY: 'test',
        ZCODE_TRANSCRIPT_DIR: transcriptDir,
      },
      stdout,
      stderr,
      version: '0.1.0',
    })

    assert.equal(exitCode, 0)
    const output = stdout.read()
    // Styled streams split tool names from args with color codes; strip them
    // so the structural assertions stay readable. (Escape char built from a
    // char code: the no-control-regex rule bans it in pattern literals.)
    const esc = String.fromCharCode(27)
    const plain = output.replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '')

    // YOLO banner, tool progress line, result preview, final text, usage footer.
    assert.match(plain, /── YOLO MODE ──/)
    assert.match(plain, /● Glob\(/)
    assert.match(plain, /✓|notes\.md/)
    assert.match(plain, /The workspace has one markdown file\./)
    assert.match(plain, /in · .*out|in/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('CLI plan mode explores read-only: writes are denied, reads proceed', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    model: 'fake-model',
    script: [
      { toolCalls: [{ name: 'Write', input: { file_path: 'no.txt', content: 'x' } }] },
      { toolCalls: [{ name: 'Read', input: { file_path: 'notes.md' } }] },
      { text: 'Plan: notes.md exists; I would add a summary section.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-cli-plan-')
  const transcriptDir = path.join(workspace, '.transcripts')

  try {
    await fs.writeFile(path.join(workspace, 'notes.md'), '# notes\n', 'utf8')

    const stdout = createMemoryWriter()
    const stderr = createMemoryWriter()

    const exitCode = await runCli(['-p', 'plan a doc change', '--plan', '--json'], {
      cwd: workspace,
      env: {
        ZCODE_PROVIDER: 'openai-compatible',
        ZCODE_OPENAI_PROVIDER: 'fake',
        ZCODE_OPENAI_MODEL: 'fake-model',
        ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
        ZCODE_OPENAI_API_KEY: 'test',
        ZCODE_TRANSCRIPT_DIR: transcriptDir,
      },
      stdout,
      stderr,
      version: '0.1.0',
    })

    assert.equal(exitCode, 0)
    const payload = JSON.parse(stdout.read())

    assert.equal(payload.runMode, 'plan')
    assert.equal(payload.stopReason, 'end_turn')
    assert.equal(payload.toolCalls[0].name, 'Write')
    assert.equal(payload.toolCalls[0].isError, true)
    assert.match(payload.toolCalls[0].result, /Plan mode is read-only/)
    assert.equal(payload.toolCalls[1].name, 'Read')
    assert.equal(payload.toolCalls[1].isError, false)

    await assert.rejects(fs.access(path.join(workspace, 'no.txt')))
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('CLI rejects --plan combined with --write (plan mode never writes)', async () => {
  const stdout = createMemoryWriter()
  const stderr = createMemoryWriter()

  const exitCode = await runCli(['-p', 'make a file', '--plan', '--write'], {
    cwd: await createTempDir('zcode-cli-plan-write-'),
    env: {},
    stdout,
    stderr,
    version: '0.1.0',
  })

  assert.equal(exitCode, 2, 'usage errors exit with code 2')
  assert.match(stderr.read(), /--plan and --write cannot be combined/)
  // stdout stays clean (machine-readable consumers are not polluted).
  assert.equal(stdout.read(), '')
})

test('CLI exit codes: usage errors exit 2, unknown commands exit 2', async () => {
  const stderr = createMemoryWriter()

  const badOption = await runCli(['--nope'], {
    cwd: await createTempDir('zcode-cli-exit-a-'),
    env: {},
    stdout: createMemoryWriter(),
    stderr,
    version: '0.1.0',
  })
  assert.equal(badOption, 2)
  assert.match(stderr.read(), /Unknown option: --nope/)

  const unknownCommand = await runCli(['frobnicate'], {
    cwd: await createTempDir('zcode-cli-exit-b-'),
    env: {},
    stdout: createMemoryWriter(),
    stderr: createMemoryWriter(),
    version: '0.1.0',
  })
  assert.equal(unknownCommand, 2)
})
