// Regression tests: the approval diff preview must never read (and echo) a
// file outside the workspace boundary. The model controls input.file_path, so
// a malicious Write could otherwise point the preview at e.g. ~/.ssh/id_rsa
// and have its contents rendered into the approval prompt.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PassThrough, Writable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'

import { readOldContentForPreview } from '../../src/cli/diffPreview.js'
import { createInteractiveConfirm } from '../../src/cli/harnessPrint.js'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('preview read: in-workspace Write target returns existing content', async () => {
  const workspace = await createTempDir('zcode-prev-in-')
  try {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'old content', 'utf8')
    const result = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: 'a.txt', content: 'new' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(result.blocked, false)
    assert.equal(result.oldContent, 'old content')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('preview read: traversal outside the workspace is blocked, content never read', async () => {
  const workspace = await createTempDir('zcode-prev-out-')
  const outside = await createTempDir('zcode-prev-secret-')
  try {
    const secretPath = path.join(outside, 'secret.txt')
    await fs.writeFile(secretPath, 'TOP SECRET', 'utf8')

    // Relative traversal…
    const relative = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: path.join('..', path.basename(outside), 'secret.txt'), content: 'x' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(relative.blocked, true)
    assert.equal(relative.oldContent, null)

    // …and absolute path straight to the secret.
    const absolute = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: secretPath, content: 'x' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(absolute.blocked, true)
    assert.equal(absolute.oldContent, null)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

// Symlink creation on Windows requires admin/Developer Mode; junctions do not
// (same probe pattern as boundaryRealpath.test.js).
async function symlinkPrivilegeAvailable(dir) {
  const probe = path.join(dir, 'symlink-probe')
  try {
    await fs.symlink('target-does-not-matter', probe, 'file')
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

test('preview read: file symlink inside the workspace pointing outside is blocked', { timeout: 20000 }, async t => {
  const workspace = await createTempDir('zcode-prev-link-')
  const outside = await createTempDir('zcode-prev-target-')
  try {
    if (!(await symlinkPrivilegeAvailable(workspace))) {
      t.skip('symlink privilege not available on this machine')
      return
    }
    await fs.writeFile(path.join(outside, 'leak.txt'), 'LEAKED', 'utf8')
    await fs.symlink(path.join(outside, 'leak.txt'), path.join(workspace, 'link.txt'), 'file')

    const result = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: 'link.txt', content: 'x' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(result.blocked, true)
    assert.equal(result.oldContent, null)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('preview read: junction inside the workspace pointing outside is blocked', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-prev-junc-')
  const outside = await createTempDir('zcode-prev-juncout-')
  try {
    await fs.writeFile(path.join(outside, 'leak.txt'), 'LEAKED', 'utf8')
    // junction on Windows, directory symlink elsewhere (same containment story).
    await fs.symlink(outside, path.join(workspace, 'gate'), 'junction')
    const result = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: path.join('gate', 'leak.txt'), content: 'x' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(result.blocked, true)
    assert.equal(result.oldContent, null)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('preview read: addDirs roots are trusted like the file tools trust them', async () => {
  const workspace = await createTempDir('zcode-prev-add-')
  const extra = await createTempDir('zcode-prev-dir-')
  try {
    await fs.writeFile(path.join(extra, 'extra.txt'), 'extra content', 'utf8')
    const result = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: path.join(extra, 'extra.txt'), content: 'x' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [extra] },
    })
    assert.equal(result.blocked, false)
    assert.equal(result.oldContent, 'extra content')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(extra, { recursive: true, force: true })
  }
})

test('preview read: --no-boundary (false) keeps the old unrestricted behavior', async () => {
  const workspace = await createTempDir('zcode-prev-nob-')
  const outside = await createTempDir('zcode-prev-nobout-')
  try {
    await fs.writeFile(path.join(outside, 'ok.txt'), 'reachable', 'utf8')
    const result = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: path.join(outside, 'ok.txt'), content: 'x' },
      cwd: workspace,
      boundary: false,
    })
    assert.equal(result.blocked, false)
    assert.equal(result.oldContent, 'reachable')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('preview read: non-Write tools and missing paths are not blocked', async () => {
  const workspace = await createTempDir('zcode-prev-misc-')
  try {
    const edit = await readOldContentForPreview({
      toolName: 'Edit',
      input: { file_path: '../outside.txt', old_string: 'a', new_string: 'b' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(edit.blocked, false)
    assert.equal(edit.oldContent, null)

    const missing = await readOldContentForPreview({
      toolName: 'Write',
      input: { file_path: 'new-file.txt', content: 'x' },
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })
    assert.equal(missing.blocked, false)
    assert.equal(missing.oldContent, null)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('interactive confirm: out-of-bounds Write preview shows a note, not the contents', async () => {
  const workspace = await createTempDir('zcode-prev-confirm-')
  const outside = await createTempDir('zcode-prev-confout-')
  try {
    const secretPath = path.join(outside, 'secret.txt')
    await fs.writeFile(secretPath, 'TOP SECRET', 'utf8')

    const stdin = new PassThrough()
    stdin.isTTY = true
    const chunks = []
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    })

    const confirm = createInteractiveConfirm({
      stdin,
      stdout,
      cwd: workspace,
      boundary: { enabled: true, addDirs: [] },
    })

    stdin.write('y\n')
    const answer = await confirm({
      toolName: 'Write',
      input: { file_path: secretPath, content: 'replacement' },
    })

    assert.equal(answer, true)
    const output = chunks.join('')
    assert.match(output, /outside the workspace boundary/)
    assert.doesNotMatch(output, /TOP SECRET/)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})
