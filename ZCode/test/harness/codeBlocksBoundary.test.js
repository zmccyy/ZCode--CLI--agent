// Regression tests: /save and --write must not escape the workspace through
// a symlink/junction placed INSIDE it (lexical containment alone is fooled;
// the harness file tools have the same realpath containment).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveWithinWorkspace, writeCodeBlocks } from '../../src/cli/codeBlocks.js'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('resolveWithinWorkspace: plain in-workspace targets still resolve', () => {
  const root = path.resolve(os.tmpdir(), 'zcode-cb-ok')
  assert.equal(resolveWithinWorkspace(root, 'a/b.txt'), path.join(root, 'a', 'b.txt'))
  assert.equal(resolveWithinWorkspace(root, './x.js'), path.join(root, 'x.js'))
})

test('resolveWithinWorkspace: lexical traversal is still refused', () => {
  const root = path.resolve(os.tmpdir(), 'zcode-cb-trav')
  assert.throws(() => resolveWithinWorkspace(root, '../evil.txt'), /Refusing to write outside the workspace/)
})

test('codeBlocks write: junction inside the workspace cannot redirect the write outside', { timeout: 20000 }, async () => {
  const workspace = await createTempDir('zcode-cb-junc-')
  const outside = await createTempDir('zcode-cb-juncout-')
  try {
    // junction on Windows, directory symlink elsewhere (same containment story).
    await fs.symlink(outside, path.join(workspace, 'gate'), 'junction')
    const victim = path.join(outside, 'captured.txt')

    assert.throws(
      () => writeCodeBlocks([{ language: 'js', code: 'pwned' }], path.join('gate', 'captured.txt'), workspace),
      /Refusing to write outside the workspace/,
    )
    assert.equal(existsSync(victim), false, 'outside file must not be created')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('codeBlocks write: normal in-workspace writes keep working', async () => {
  const workspace = await createTempDir('zcode-cb-ok-')
  try {
    const written = writeCodeBlocks([{ language: 'js', code: 'console.log(1)' }], path.join('sub', 'out.js'), workspace)
    assert.deepEqual(written, [path.join(workspace, 'sub', 'out.js')])
    assert.match(await fs.readFile(written[0], 'utf8'), /console\.log\(1\)/)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
