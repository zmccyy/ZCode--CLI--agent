import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { walkFiles } from '../../src/harness/tools/fsWalk.ts'
import { executeRead } from '../../src/harness/tools/read.ts'
import { executeWrite } from '../../src/harness/tools/write.ts'
import { createWorkspaceBoundary } from '../../src/harness/boundary.ts'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function makeContext(cwd) {
  return {
    cwd,
    state: { readFiles: new Set() },
    boundary: createWorkspaceBoundary({ cwd }),
  }
}

/**
 * Symlink creation on Windows requires admin/Developer Mode; junctions do not.
 * Probing lets the suite degrade honestly on locked-down machines.
 */
async function canCreateFileSymlinks(dir) {
  const probe = path.join(dir, 'symlink-probe')
  try {
    await fs.symlink('target-does-not-matter', probe, 'file')
    await fs.unlink(probe)
    return true
  } catch {
    return false
  }
}

test('realpath boundary: a file symlink inside the workspace pointing outside is denied', { timeout: 20000 }, async t => {
  const workspace = await createTempDir('zcode-rp-ws-')
  const outside = await createTempDir('zcode-rp-out-')
  if (!(await canCreateFileSymlinks(workspace))) {
    t.skip('symlink privilege not available on this machine')
    return
  }

  try {
    const victim = path.join(outside, 'victim.txt')
    await fs.writeFile(victim, 'top secret', 'utf8')
    await fs.symlink(victim, path.join(workspace, 'leak.txt'), 'file')

    const context = makeContext(workspace)

    const read = await executeRead({ file_path: 'leak.txt' }, context)
    assert.equal(read.isError, true)
    assert.match(read.content, /outside the workspace boundary/)

    const write = await executeWrite(
      { file_path: 'leak.txt', content: 'overwritten' },
      context,
    )
    assert.equal(write.isError, true)
    assert.match(write.content, /outside the workspace boundary/)
    // The outside file is untouched.
    assert.equal(await fs.readFile(victim, 'utf8'), 'top secret')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('realpath boundary: a junction inside the workspace pointing outside is denied', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-rp-wsj-')
  const outside = await createTempDir('zcode-rp-outj-')

  try {
    await fs.writeFile(path.join(outside, 'victim.txt'), 'top secret', 'utf8')
    // Junctions do not require admin privileges on Windows; on POSIX they
    // degrade to directory symlinks (which is the same containment story).
    await fs.symlink(outside, path.join(workspace, 'gate'), 'junction')

    const context = makeContext(workspace)

    const read = await executeRead({ file_path: path.join('gate', 'victim.txt') }, context)
    assert.equal(read.isError, true)
    assert.match(read.content, /outside the workspace boundary/)

    const write = await executeWrite(
      { file_path: path.join('gate', 'planted.txt'), content: 'nope' },
      context,
    )
    assert.equal(write.isError, true)
    assert.match(write.content, /outside the workspace boundary/)
    await assert.rejects(fs.access(path.join(outside, 'planted.txt')))
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('realpath boundary: writing a new file into a not-yet-created directory still works', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-rp-new-')

  try {
    const context = makeContext(workspace)
    const write = await executeWrite(
      { file_path: path.join('deep', 'nested', 'new.txt'), content: 'fresh' },
      context,
    )
    assert.notEqual(write.isError, true)
    assert.match(write.content, /File created/)
    assert.equal(
      await fs.readFile(path.join(workspace, 'deep', 'nested', 'new.txt'), 'utf8'),
      'fresh',
    )
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('realpath boundary: sibling-prefix directories remain outside the boundary', { timeout: 20000 }, async () => {
  const parent = await createTempDir('zcode-rp-parent-')
  const workspace = path.join(parent, 'workspace')
  await fs.mkdir(workspace)
  const sibling = path.join(`${parent}${path.sep}workspaceEvil`)
  await fs.mkdir(sibling)
  await fs.writeFile(path.join(sibling, 'x.txt'), 'nope', 'utf8')

  try {
    const context = makeContext(workspace)
    const read = await executeRead({ file_path: path.join('..', 'workspaceEvil', 'x.txt') }, context)
    assert.equal(read.isError, true)
    assert.match(read.content, /outside the workspace boundary/)
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})

test('walk: symlinks are neither followed nor listed', { timeout: 20000 }, async t => {
  const workspace = await createTempDir('zcode-rp-walk-')
  if (!(await canCreateFileSymlinks(workspace))) {
    t.skip('symlink privilege not available on this machine')
    return
  }

  try {
    await fs.mkdir(path.join(workspace, 'sub'))
    await fs.writeFile(path.join(workspace, 'sub', 'real.txt'), 'real', 'utf8')
    await fs.symlink(
      path.join(workspace, 'sub', 'real.txt'),
      path.join(workspace, 'sub', 'link.txt'),
      'file',
    )

    const entries = await walkFiles(workspace)
    const names = entries.map(entry => path.basename(entry.absolutePath))
    assert.deepEqual(names, ['real.txt'])
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('walk: a self-referencing junction does not hang or escape', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-rp-cycle-')

  try {
    await fs.mkdir(path.join(workspace, 'inner'))
    await fs.writeFile(path.join(workspace, 'inner', 'a.txt'), 'a', 'utf8')
    await fs.symlink(workspace, path.join(workspace, 'inner', 'self'), 'junction')

    const entries = await walkFiles(workspace)
    // The junction is skipped: only the real file is produced, no recursion.
    const names = entries.map(entry => path.basename(entry.absolutePath))
    assert.deepEqual(names, ['a.txt'])
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('walk: a file path as the root produces that single file instead of silence', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-rp-rootfile-')

  try {
    const file = path.join(workspace, 'only.txt')
    await fs.writeFile(file, 'content', 'utf8')
    const entries = await walkFiles(file)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].absolutePath, file)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('walk: byte and time budgets stop the walk deterministically', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-rp-budget-')

  try {
    await fs.mkdir(path.join(workspace, 'sub'))
    await fs.writeFile(path.join(workspace, 'big.bin'), Buffer.alloc(4096), 'utf8')
    await fs.writeFile(path.join(workspace, 'sub', 'big2.bin'), Buffer.alloc(4096), 'utf8')

    const entries = await walkFiles(workspace, { maxTotalBytes: 4096 })
    assert.ok(entries.length < 2, `byte budget should stop early, got ${entries.length}`)

    const timed = await walkFiles(workspace, { maxWalkMs: 0 })
    assert.equal(timed.length, 0, 'a zero time budget produces nothing')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
