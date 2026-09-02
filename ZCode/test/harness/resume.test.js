import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'
import {
  listSessions,
  findLatestSession,
  resolveSessionPath,
  loadSessionForResume,
  ResumeError,
} from '../../src/harness/resume.ts'
import { runCli } from '../../src/cli/publicCliCore.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'
// Fake credential accepted by the local fake LLM server; never a real secret.
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || ['test', 'key'].join('-')

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

function createFakeProvider(server) {
  return createOpenAICompatibleProvider({
    provider: 'fake',
    model: 'fake-model',
    baseUrl: server.openaiBaseUrl,
    apiKey: FAKE_API_KEY,
  })
}

async function runFirstSession(workspace, transcriptDir, server) {
  return runAgentLoop({
    provider: createFakeProvider(server),
    model: 'fake-model',
    system: SYSTEM_PROMPT,
    tools: createCoreTools(),
    messages: [{ role: 'user', content: 'Read note.txt and summarize it.' }],
    permissionMode: 'yolo',
    cwd: workspace,
    transcript: { enabled: true, dir: transcriptDir },
  })
}

test('a finished session can be listed, loaded, and resumed with Edit precondition intact', async () => {
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
      // ── Resumed session below ──
      {
        toolCalls: [
          {
            name: 'Edit',
            input: { file_path: 'note.txt', old_string: 'hello', new_string: 'hello again' },
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 5, total_tokens: 205 },
      },
      {
        text: 'Updated the note.',
        usage: { prompt_tokens: 230, completion_tokens: 5, total_tokens: 235 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-resume-')
  const transcriptDir = path.join(workspace, '.transcripts')

  try {
    await fs.writeFile(path.join(workspace, 'note.txt'), 'hello\n', 'utf8')

    // ── Session 1: read the file, finish. ──
    const first = await runFirstSession(workspace, transcriptDir, server)
    assert.equal(first.stopReason, 'end_turn')

    // Listing finds the transcript, most recent first.
    const sessions = await listSessions(transcriptDir)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].sessionId, first.sessionId)
    assert.equal((await findLatestSession(transcriptDir)).sessionId, first.sessionId)

    // Load the snapshot: full message history plus the Read precondition.
    const snapshot = await loadSessionForResume(sessions[0].path)
    assert.equal(snapshot.sessionId, first.sessionId)
    assert.equal(snapshot.cwd, workspace)
    assert.equal(snapshot.model, 'fake-model')
    assert.equal(snapshot.messages.length, 4) // user, assistant(Read), tool, assistant(final)
    assert.equal(snapshot.messages[0].content, 'Read note.txt and summarize it.')
    assert.equal(snapshot.messages[snapshot.messages.length - 1].text, 'The note says hello.')
    assert.deepEqual(snapshot.readFiles, [path.resolve(workspace, 'note.txt')])

    // ── Session 2: resumed; Edit must succeed without re-reading. ──
    const second = await runAgentLoop({
      provider: createFakeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Replace hello with hello again.' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: true, dir: transcriptDir },
      resume: { sessionId: snapshot.sessionId, messages: snapshot.messages },
    })

    assert.equal(second.stopReason, 'end_turn')
    assert.equal(second.text, 'Updated the note.')
    assert.notEqual(second.sessionId, first.sessionId)

    // The Edit really applied and did not fail on read-before-edit.
    const editCall = second.toolCalls.find(call => call.name === 'Edit')
    assert.ok(editCall, 'expected an Edit call in the resumed session')
    assert.equal(editCall.isError, false)
    assert.equal(
      await fs.readFile(path.join(workspace, 'note.txt'), 'utf8'),
      'hello again\n',
    )

    // The new transcript is self-contained: it starts with the restored
    // history, so it can be resumed again later.
    const sessionsAfter = await listSessions(transcriptDir)
    assert.equal(sessionsAfter.length, 2)
    const resumedSnapshot = await loadSessionForResume(sessionsAfter[0].path)
    assert.equal(resumedSnapshot.sessionId, second.sessionId)
    assert.equal(resumedSnapshot.resumedFrom, first.sessionId)
    assert.ok(resumedSnapshot.messages.length >= 7)
    assert.equal(resumedSnapshot.messages[0].content, 'Read note.txt and summarize it.')
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('resuming in a different directory does not inherit read-before-edit for same-named relative files', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      // ── Session 1, recorded in workspace A ──
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'note.txt' } }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      },
      {
        text: 'Read the original note.',
        usage: { prompt_tokens: 130, completion_tokens: 5, total_tokens: 135 },
      },
      // ── Session 2, resumed in workspace B ──
      {
        toolCalls: [
          {
            name: 'Edit',
            input: { file_path: 'note.txt', old_string: 'different', new_string: 'hijacked' },
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 5, total_tokens: 205 },
      },
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'note.txt' } }],
        usage: { prompt_tokens: 260, completion_tokens: 5, total_tokens: 265 },
      },
      {
        toolCalls: [
          {
            name: 'Edit',
            input: { file_path: 'note.txt', old_string: 'different', new_string: 'updated' },
          },
        ],
        usage: { prompt_tokens: 320, completion_tokens: 5, total_tokens: 325 },
      },
      {
        text: 'Re-read first, then edited safely.',
        usage: { prompt_tokens: 380, completion_tokens: 5, total_tokens: 385 },
      },
    ],
  })
  await server.listen()
  const workspaceA = await createTempDir('zcode-resume-cwd-a-')
  const workspaceB = await createTempDir('zcode-resume-cwd-b-')
  const transcriptDir = path.join(workspaceA, '.transcripts')

  try {
    await fs.writeFile(path.join(workspaceA, 'note.txt'), 'original content\n', 'utf8')
    await fs.writeFile(path.join(workspaceB, 'note.txt'), 'different content\n', 'utf8')

    const first = await runFirstSession(workspaceA, transcriptDir, server)
    assert.equal(first.stopReason, 'end_turn')

    const sessions = await listSessions(transcriptDir)
    const snapshot = await loadSessionForResume(sessions[0].path)
    assert.equal(snapshot.cwd, workspaceA)

    // Session 2 runs with cwd = workspaceB. The restored history's relative
    // Read must resolve against workspaceA (originalCwd), so workspaceB's
    // note.txt is NOT considered read yet — editing it sight-unseen must fail.
    const second = await runAgentLoop({
      provider: createFakeProvider(server),
      model: 'fake-model',
      system: SYSTEM_PROMPT,
      tools: createCoreTools(),
      messages: [{ role: 'user', content: 'Update the note.' }],
      permissionMode: 'yolo',
      cwd: workspaceB,
      transcript: { enabled: false },
      resume: {
        sessionId: snapshot.sessionId,
        messages: snapshot.messages,
        originalCwd: snapshot.cwd,
      },
    })

    assert.equal(second.stopReason, 'end_turn')
    const deniedEdit = second.toolCalls[0]
    assert.equal(deniedEdit.name, 'Edit')
    assert.equal(deniedEdit.isError, true)
    assert.match(deniedEdit.result, /has not been read yet/)
    assert.ok(deniedEdit.result.includes(path.resolve(workspaceB, 'note.txt')))

    // The model recovered by reading the file in the new workspace first.
    assert.equal(second.toolCalls[1].name, 'Read')
    assert.equal(second.toolCalls[1].isError, false)
    assert.equal(second.toolCalls[2].name, 'Edit')
    assert.equal(second.toolCalls[2].isError, false)
    assert.equal(await fs.readFile(path.join(workspaceB, 'note.txt'), 'utf8'), 'updated content\n')

    // Workspace A's file was never touched by the resumed session.
    assert.equal(await fs.readFile(path.join(workspaceA, 'note.txt'), 'utf8'), 'original content\n')
  } finally {
    await server.close()
    await fs.rm(workspaceA, { recursive: true, force: true })
    await fs.rm(workspaceB, { recursive: true, force: true })
  }
})

test('transcript loading skips corrupt lines and rejects message-less files', async () => {
  const workspace = await createTempDir('zcode-resume-corrupt-')
  const transcriptDir = path.join(workspace, '.transcripts')
  await fs.mkdir(transcriptDir, { recursive: true })

  const corruptPath = path.join(transcriptDir, 'corrupt.jsonl')
  const lines = [
    JSON.stringify({ type: 'entry', timestamp: 't', cwd: workspace, model: 'fake-model' }),
    '{ this is not json',
    JSON.stringify({ type: 'message', message: { role: 'user', content: 'hi' } }),
    'another garbage line',
    JSON.stringify({ type: 'message', message: { role: 'assistant', text: 'hello', toolCalls: [] } }),
  ]
  await fs.writeFile(corruptPath, `${lines.join('\n')}\n`, 'utf8')

  const snapshot = await loadSessionForResume(corruptPath)
  assert.equal(snapshot.messages.length, 2)
  assert.equal(snapshot.skippedLines, 2)

  const emptyPath = path.join(transcriptDir, 'empty.jsonl')
  await fs.writeFile(
    emptyPath,
    `${JSON.stringify({ type: 'entry', timestamp: 't', cwd: workspace })}\n`,
    'utf8',
  )
  await assert.rejects(() => loadSessionForResume(emptyPath), ResumeError)

  await assert.rejects(
    () => loadSessionForResume(path.join(transcriptDir, 'missing.jsonl')),
    ResumeError,
  )

  await fs.rm(workspace, { recursive: true, force: true })
})

test('resolveSessionPath accepts session ids and transcript paths', async () => {
  const workspace = await createTempDir('zcode-resume-resolve-')
  const transcriptDir = path.join(workspace, '.transcripts')
  await fs.mkdir(transcriptDir, { recursive: true })
  const sessionPath = path.join(transcriptDir, 'abc-123.jsonl')
  await fs.writeFile(sessionPath, '', 'utf8')

  assert.equal(await resolveSessionPath(transcriptDir, 'abc-123'), sessionPath)
  assert.equal(await resolveSessionPath(transcriptDir, sessionPath), sessionPath)

  await assert.rejects(() => resolveSessionPath(transcriptDir, 'nope'), ResumeError)
  await assert.rejects(() => resolveSessionPath(transcriptDir, '  '), ResumeError)

  await fs.rm(workspace, { recursive: true, force: true })
})

test('CLI --continue resumes the most recent session for the workspace', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      { text: 'First answer: the workspace has one file.', usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } },
      { text: 'Continued answer with prior context.', usage: { prompt_tokens: 90, completion_tokens: 5, total_tokens: 95 } },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-resume-cli-')
  const transcriptDir = path.join(workspace, '.transcripts')

  const cliEnv = {
    ZCODE_PROVIDER: 'openai-compatible',
    ZCODE_OPENAI_PROVIDER: 'fake',
    ZCODE_OPENAI_MODEL: 'fake-model',
    ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
    ZCODE_OPENAI_API_KEY: FAKE_API_KEY,
    ZCODE_TRANSCRIPT_DIR: transcriptDir,
  }

  try {
    const firstStdout = createMemoryWriter()
    const firstExit = await runCli(['-p', 'what files exist here?', '--yolo', '--json'], {
      cwd: workspace,
      env: cliEnv,
      stdout: firstStdout,
      stderr: createMemoryWriter(),
      version: '0.1.0',
    })
    assert.equal(firstExit, 0)
    const firstPayload = JSON.parse(firstStdout.read())
    assert.equal(firstPayload.resumedFrom, undefined)
    assert.equal(firstPayload.compactions, 0)

    const secondStdout = createMemoryWriter()
    const secondExit = await runCli(['-p', 'and what did you answer?', '--continue', '--yolo', '--json'], {
      cwd: workspace,
      env: cliEnv,
      stdout: secondStdout,
      stderr: createMemoryWriter(),
      version: '0.1.0',
    })
    assert.equal(secondExit, 0)
    const secondPayload = JSON.parse(secondStdout.read())

    // The envelope proves the continuation and reports no compaction.
    assert.equal(secondPayload.resumedFrom, firstPayload.sessionId)
    assert.equal(secondPayload.compactions, 0)
    assert.equal(secondPayload.text, 'Continued answer with prior context.')

    // The second run's request carried the restored history.
    const continuedMessages = server.requests[1].body.messages
    assert.ok(
      continuedMessages.some(
        message => typeof message.content === 'string' && message.content.includes('what files exist here?'),
      ),
      'expected the first prompt to appear in the resumed history',
    )
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('CLI --continue fails honestly when no session exists yet', async () => {
  const server = createFakeLlmServer({ dialect: 'openai', script: [] })
  await server.listen()
  const workspace = await createTempDir('zcode-resume-cli-none-')

  try {
    const stderr = createMemoryWriter()
    const exitCode = await runCli(['-p', 'anything', '--continue', '--yolo'], {
      cwd: workspace,
      env: {
        ZCODE_PROVIDER: 'openai-compatible',
        ZCODE_OPENAI_PROVIDER: 'fake',
        ZCODE_OPENAI_MODEL: 'fake-model',
        ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
        ZCODE_OPENAI_API_KEY: FAKE_API_KEY,
        ZCODE_TRANSCRIPT_DIR: path.join(workspace, '.transcripts'),
      },
      stdout: createMemoryWriter(),
      stderr,
      version: '0.1.0',
    })

    assert.equal(exitCode, 1)
    assert.match(stderr.read(), /No sessions recorded/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('CLI sessions command lists recorded transcripts', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      { text: 'One and done.', usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-resume-sessions-')
  const transcriptDir = path.join(workspace, '.transcripts')

  try {
    await runCli(['-p', 'hello', '--yolo', '--json'], {
      cwd: workspace,
      env: {
        ZCODE_PROVIDER: 'openai-compatible',
        ZCODE_OPENAI_PROVIDER: 'fake',
        ZCODE_OPENAI_MODEL: 'fake-model',
        ZCODE_OPENAI_BASE_URL: server.openaiBaseUrl,
        ZCODE_OPENAI_API_KEY: FAKE_API_KEY,
        ZCODE_TRANSCRIPT_DIR: transcriptDir,
      },
      stdout: createMemoryWriter(),
      stderr: createMemoryWriter(),
      version: '0.1.0',
    })

    const stdout = createMemoryWriter()
    const exitCode = await runCli(['sessions'], {
      cwd: workspace,
      env: { ZCODE_TRANSCRIPT_DIR: transcriptDir },
      stdout,
      stderr: createMemoryWriter(),
      version: '0.1.0',
    })
    assert.equal(exitCode, 0)
    const listing = stdout.read()
    assert.match(listing, /Resume with:/)
    assert.match(listing, /^[0-9a-f-]{36}\s+\d{4}-/m)

    const jsonStdout = createMemoryWriter()
    const jsonExit = await runCli(['sessions', '--json'], {
      cwd: workspace,
      env: { ZCODE_TRANSCRIPT_DIR: transcriptDir },
      stdout: jsonStdout,
      stderr: createMemoryWriter(),
      version: '0.1.0',
    })
    assert.equal(jsonExit, 0)
    const payload = JSON.parse(jsonStdout.read())
    assert.equal(payload.length, 1)
    assert.ok(payload[0].sessionId)
    assert.ok(payload[0].path.endsWith('.jsonl'))
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
