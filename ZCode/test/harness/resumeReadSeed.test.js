import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { collectReadFilesFromMessages, loadSessionForResume } from '../../src/harness/resume.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || 'test'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function user(content) {
  return { role: 'user', content }
}

function assistantRead(callId, filePath) {
  return { role: 'assistant', text: null, toolCalls: [{ id: callId, name: 'Read', input: { file_path: filePath } }] }
}

function toolResult(callId, content, isError = undefined) {
  return { role: 'tool', toolCallId: callId, toolName: 'Read', content, ...(isError === undefined ? {} : { isError }) }
}

// ── Read seeding: only successful execution facts ──

test('seed: a failed Read does not mark the file as read', () => {
  const cwd = 'E:/fake/ws'.replace(/\//g, path.sep)
  const messages = [
    user('read then edit'),
    assistantRead('call-1', 'src/app.ts'),
    toolResult('call-1', 'Error: file does not exist: src/app.ts', true),
  ]

  const seeded = collectReadFilesFromMessages(messages, cwd)
  assert.equal(seeded.size, 0)
})

test('seed: a successful Read marks the file as read', () => {
  const cwd = 'E:/fake/ws'.replace(/\//g, path.sep)
  const messages = [
    user('read then edit'),
    assistantRead('call-1', 'src/app.ts'),
    toolResult('call-1', '     1\tconst x = 1'),
  ]

  const seeded = collectReadFilesFromMessages(messages, cwd)
  assert.deepEqual([...seeded], [path.resolve(cwd, 'src/app.ts')])
})

test('seed: a Read call with no tool result (interrupted turn) is not seeded', () => {
  const cwd = 'E:/fake/ws'.replace(/\//g, path.sep)
  const messages = [
    user('read'),
    assistantRead('call-1', 'src/app.ts'),
    // transcript ends before the tool result was appended
  ]

  const seeded = collectReadFilesFromMessages(messages, cwd)
  assert.equal(seeded.size, 0)
})

test('seed: relative paths resolve against the ORIGINAL session cwd', () => {
  const oldCwd = 'E:/fake/old-ws'.replace(/\//g, path.sep)
  const messages = [
    user('read'),
    assistantRead('call-1', 'notes.md'),
    toolResult('call-1', '     1\thello'),
  ]

  const seeded = collectReadFilesFromMessages(messages, oldCwd)
  assert.deepEqual([...seeded], [path.resolve(oldCwd, 'notes.md')])
})

// ── End to end: a resumed session cannot edit a file whose Read failed ──

test('resume: a transcript whose Read failed does not unlock Edit after resume', { timeout: 30000 }, async () => {
  const workspace = await createTempDir('zcode-d1-ws-')
  const transcriptDir = await createTempDir('zcode-d1-tx-')

  // Session 1: the model asks for Read on an existing file, but the Read
  // failed (simulated by a script where Read errors) — then the run stopped.
  const server1 = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      { toolCalls: [{ name: 'Read', input: { file_path: 'target.txt' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ],
  })
  await server1.listen()

  try {
    await fs.writeFile(path.join(workspace, 'target.txt'), 'secret content', 'utf8')
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server1.openaiBaseUrl,
      apiKey: FAKE_API_KEY,
    })

    // Force the Read to fail at the tool layer despite the existing file:
    // point the loop at a boundary that excludes the file via a different cwd.
    const emptyWorkspace = await createTempDir('zcode-d1-empty-')
    const result1 = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [user('read target.txt and remember it')],
      permissionMode: 'yolo',
      cwd: emptyWorkspace, // target.txt lives in `workspace`, not here → Read fails
      transcript: { dir: transcriptDir },
    })
    await server1.close()

    assert.equal(result1.toolCalls[0].isError, true)

    // Session 2: resume from the failed session and try to Edit the file.
    const sessions = await fs.readdir(transcriptDir)
    const transcriptPath = path.join(transcriptDir, sessions[0])
    const snapshot = await loadSessionForResume(transcriptPath)
    assert.equal(snapshot.readFiles.length, 0, 'failed Read must not seed read state')

    // Drive Edit directly against the resumed loop state via a second run
    // whose script requests the Edit.
    const server2 = createFakeLlmServer({
      dialect: 'openai',
      apiKey: FAKE_API_KEY,
      model: 'fake-model',
      script: [
        { toolCalls: [{ name: 'Edit', input: { file_path: 'target.txt', old_string: 'secret', new_string: 'public' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        { text: 'done' },
      ],
    })
    await server2.listen()
    try {
      const provider2 = createOpenAICompatibleProvider({
        provider: 'fake',
        model: 'fake-model',
        baseUrl: server2.openaiBaseUrl,
        apiKey: FAKE_API_KEY,
      })
      const result2 = await runAgentLoop({
        provider: provider2,
        model: 'fake-model',
        system: SYSTEM_PROMPT,
        tools: createCoreTools(),
        messages: [user('edit target.txt')],
        permissionMode: 'yolo',
        cwd: workspace,
        transcript: { enabled: false },
        resume: {
          sessionId: snapshot.sessionId,
          messages: snapshot.messages,
          originalCwd: snapshot.cwd,
        },
      })

      const editCall = result2.toolCalls.find(call => call.name === 'Edit')
      assert.ok(editCall)
      assert.equal(editCall.isError, true, 'Edit must be refused without a successful Read')
      assert.match(editCall.result, /has not been read yet/)
      // The file was NOT modified.
      assert.equal(await fs.readFile(path.join(workspace, 'target.txt'), 'utf8'), 'secret content')
    } finally {
      await server2.close()
      await fs.rm(emptyWorkspace, { recursive: true, force: true })
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(transcriptDir, { recursive: true, force: true })
  }
})

// ── Transcript redaction ──

test('transcript: secrets in prompts and tool results are redacted on disk', { timeout: 30000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      { text: 'Your key sk-abcdef1234567890abcdef and Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9x leaked into my output on purpose.' },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-d3-ws-')
  const transcriptDir = await createTempDir('zcode-d3-tx-')

  try {
    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: FAKE_API_KEY,
    })
    const result = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [user('tell me a secret: x-api-key: supersecretvalue12345')],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { dir: transcriptDir },
    })

    const files = await fs.readdir(transcriptDir)
    const raw = await fs.readFile(path.join(transcriptDir, files[0]), 'utf8')
    // Every line stays parseable JSON after redaction.
    const lines = raw.trim().split('\n').map(line => JSON.parse(line))

    const serialized = raw.toLowerCase()
    assert.ok(!serialized.includes('sk-abcdef1234567890abcdef'), 'raw sk- key must not reach the disk')
    assert.ok(!serialized.includes('supersecretvalue12345'), 'raw api key must not reach the disk')
    assert.ok(raw.includes('[REDACTED]'), 'redaction placeholder must be present')
    assert.ok(lines.some(line => line.type === 'result' && line.stopReason === result.stopReason))
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(transcriptDir, { recursive: true, force: true })
  }
})

// ── Transcript write failures are visible (D2) ──

test('transcript: an unwritable transcript dir surfaces a warning in the result', { timeout: 30000 }, async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [{ text: 'done' }],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-d2-ws-')

  try {
    // A FILE where a directory is expected → mkdir fails deterministically.
    const blocker = path.join(workspace, 'blocker')
    await fs.writeFile(blocker, 'not a directory', 'utf8')

    const provider = createOpenAICompatibleProvider({
      provider: 'fake',
      model: 'fake-model',
      baseUrl: server.openaiBaseUrl,
      apiKey: FAKE_API_KEY,
    })
    const result = await runAgentLoop({
      provider,
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [user('hello')],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { dir: path.join(blocker, 'sub') },
    })

    assert.equal(result.stopReason, 'end_turn', 'the loop itself must not fail')
    assert.ok(result.warnings.length > 0, 'persistence failure must be visible')
    assert.match(result.warnings[0], /transcript write failed/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
