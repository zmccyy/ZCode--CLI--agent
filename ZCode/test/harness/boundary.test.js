import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgentLoop } from '../../src/harness/loop.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import {
  createWorkspaceBoundary,
  isPathInsideBoundary,
  describeBoundary,
  BoundaryError,
} from '../../src/harness/boundary.ts'
import {
  resolveWorkspacePath,
  executeRead,
} from '../../src/harness/tools/read.ts'
import { executeWrite } from '../../src/harness/tools/write.ts'
import { executeEdit } from '../../src/harness/tools/edit.ts'
import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

const SYSTEM_PROMPT = 'You are a coding agent working in a workspace.'
// Fake credential accepted by the local fake LLM server; never a real secret.
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || ['test', 'key'].join('-')

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function createContext(cwd, boundary) {
  return { cwd, state: { readFiles: new Set() }, boundary }
}

test('boundary containment: cwd root, add-dir roots, parent/relative escapes, disabled mode', () => {
  const cwd = path.resolve('/fake/workspace')
  const boundary = createWorkspaceBoundary({ cwd, addDirs: ['../sibling-lib', '/tmp/extra'] })

  assert.deepEqual(boundary.roots, [
    cwd,
    path.resolve('/fake/sibling-lib'),
    path.resolve('/tmp/extra'),
  ])

  // Inside the roots.
  assert.ok(isPathInsideBoundary(boundary, path.join(cwd, 'src', 'app.ts')))
  assert.ok(isPathInsideBoundary(boundary, path.resolve('/tmp/extra', 'data.json')))
  // Sibling directory with a shared string prefix must NOT pass.
  assert.ok(!isPathInsideBoundary(boundary, `${cwd}-neighbor`))
  // Parent escape.
  assert.ok(!isPathInsideBoundary(boundary, path.resolve('/fake', 'elsewhere.txt')))
  assert.ok(!isPathInsideBoundary(boundary, path.resolve('/etc/hosts')))

  assert.match(describeBoundary(boundary), /sibling-lib/)
  assert.match(describeBoundary(createWorkspaceBoundary({ cwd, enabled: false })), /disabled/)

  // Disabled boundary admits everything.
  const off = createWorkspaceBoundary({ cwd, enabled: false })
  assert.ok(isPathInsideBoundary(off, '/etc/passwd'))
})

test('resolveWorkspacePath enforces the boundary and reports actionable errors', () => {
  const cwd = path.resolve('/fake/workspace')
  const boundary = createWorkspaceBoundary({ cwd })
  const context = { cwd, boundary }

  assert.equal(resolveWorkspacePath(context, 'src/app.ts'), path.join(cwd, 'src', 'app.ts'))
  assert.throws(() => resolveWorkspacePath(context, '../outside.txt'), BoundaryError)
  assert.throws(() => resolveWorkspacePath(context, path.resolve('/etc/passwd')), BoundaryError)
  assert.throws(() => resolveWorkspacePath(context, ''), /file_path is required/)

  // Without a boundary attached, resolution stays unrestricted (raw tool use).
  assert.equal(
    resolveWorkspacePath({ cwd }, path.resolve('/etc/passwd')),
    path.resolve('/etc/passwd'),
  )
})

test('file tools reject paths outside the boundary with a usable error', async () => {
  const workspace = await createTempDir('zcode-boundary-')
  const outside = await createTempDir('zcode-boundary-outside-')
  const boundary = createWorkspaceBoundary({ cwd: workspace })

  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret\n', 'utf8')
    const outsideFile = path.join(outside, 'secret.txt')

    const context = createContext(workspace, boundary)

    const read = await executeRead({ file_path: outsideFile }, context)
    assert.equal(read.isError, true)
    assert.match(read.content, /outside the workspace boundary/)

    const write = await executeWrite(
      { file_path: path.join(outside, 'planted.txt'), content: 'nope' },
      context,
    )
    assert.equal(write.isError, true)
    assert.match(write.content, /outside the workspace boundary/)
    await assert.rejects(fs.access(path.join(outside, 'planted.txt')))

    // add-dir extends the boundary: reading inside the added root succeeds.
    const extended = createWorkspaceBoundary({ cwd: workspace, addDirs: [outside] })
    const allowed = await executeRead(
      { file_path: outsideFile },
      createContext(workspace, extended),
    )
    assert.notEqual(allowed.isError, true)
    assert.match(allowed.content, /top secret/)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('the loop is secure by default: file tools are locked to cwd without options', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: FAKE_API_KEY,
    model: 'fake-model',
    script: [
      {
        toolCalls: [{ name: 'Read', input: { file_path: path.resolve('/etc/hosts') } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
      {
        toolCalls: [{ name: 'Read', input: { file_path: 'local.txt' } }],
        usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 },
      },
      {
        text: 'The outside read was blocked; the local read succeeded.',
        usage: { prompt_tokens: 70, completion_tokens: 5, total_tokens: 75 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-boundary-loop-')

  try {
    await fs.writeFile(path.join(workspace, 'local.txt'), 'inside content\n', 'utf8')
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
      messages: [{ role: 'user', content: 'read the hosts file and local.txt' }],
      permissionMode: 'yolo',
      cwd: workspace,
      transcript: { enabled: false },
      // no boundary option at all: defaults to locked-at-cwd
    })

    assert.equal(result.stopReason, 'end_turn')
    const blocked = result.toolCalls[0]
    assert.equal(blocked.name, 'Read')
    assert.equal(blocked.isError, true)
    assert.match(blocked.result, /outside the workspace boundary/)
    assert.notEqual(result.toolCalls[1].isError, true)
    assert.match(result.toolCalls[1].result, /inside content/)
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('edit respects the boundary even with a seeded readFiles state', async () => {
  const workspace = await createTempDir('zcode-boundary-edit-')
  const outside = await createTempDir('zcode-boundary-edit-outside-')
  const boundary = createWorkspaceBoundary({ cwd: workspace })

  try {
    await fs.writeFile(path.join(outside, 'target.txt'), 'original\n', 'utf8')
    const outsideFile = path.join(outside, 'target.txt')
    const context = createContext(workspace, boundary)
    // Attacker pattern: seed the precondition, then edit across the wall.
    context.state.readFiles.add(outsideFile)

    const result = await executeEdit(
      { file_path: outsideFile, old_string: 'original', new_string: 'replaced' },
      context,
    )
    assert.equal(result.isError, true)
    assert.match(result.content, /outside the workspace boundary/)
    assert.equal(await fs.readFile(outsideFile, 'utf8'), 'original\n')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})
