import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'

import { createCompleter, listWorkspaceFiles, SLASH_COMMANDS } from '../../src/cli/completer.js'

async function createTempWorkspace() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-complete-'))
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true })
  await fs.mkdir(path.join(workspace, 'node_modules', 'pkg'), { recursive: true })
  await fs.writeFile(path.join(workspace, 'README.md'), 'x', 'utf8')
  await fs.writeFile(path.join(workspace, 'app.js'), 'x', 'utf8')
  await fs.writeFile(path.join(workspace, 'src', 'util.ts'), 'x', 'utf8')
  await fs.writeFile(path.join(workspace, 'node_modules', 'pkg', 'junk.js'), 'x', 'utf8')
  return workspace
}

test('completer: slash commands complete by prefix', async () => {
  const completer = createCompleter({ cwd: os.tmpdir() })

  const [all] = await completer('/')
  assert.ok(all.includes('/help'))
  assert.ok(all.includes('/exit'))
  assert.equal(all.length, SLASH_COMMANDS.length)

  const [mo] = await completer('/mo')
  assert.deepEqual(mo, ['/model', '/mode'])

  const [none] = await completer('/zzz')
  assert.deepEqual(none, [])
})

test('completer: @ completes relative paths, skipping heavy directories', async () => {
  const workspace = await createTempWorkspace()
  const completer = createCompleter({ cwd: workspace })

  const [all] = await completer('@')
  assert.ok(all.includes('@README.md '))
  assert.ok(all.includes('@app.js '))
  assert.ok(all.includes('@src/util.ts '), 'relative path includes the subdirectory')
  assert.ok(!all.some(file => file.includes('junk')), 'node_modules contents skipped')

  const [app] = await completer('@app')
  assert.deepEqual(app, ['@app.js '])

  const [util] = await completer('@util')
  assert.deepEqual(util, ['@src/util.ts '], 'subdir file completes to its full relative path')

  // Mid-line: the completion region is the last word, not the whole line.
  const [midRest, midUsed] = await completer('check @util')
  assert.deepEqual(midRest, ['@src/util.ts '])
  assert.equal(midUsed, '@util')
})

test('completer: plain input yields no completions', async () => {
  const completer = createCompleter({ cwd: os.tmpdir() })

  const [matches, rest] = await completer('fix the bug in src')
  assert.deepEqual(matches, [])
  assert.equal(rest, 'fix the bug in src')
})

test('completer: file cache avoids re-walking within the TTL', async () => {
  const workspace = await createTempWorkspace()
  let walks = 0
  const completer = createCompleter({
    cwd: workspace,
    listFiles: async dir => {
      walks += 1
      return listWorkspaceFiles(dir)
    },
  })

  await completer('@a')
  await completer('@re')
  assert.equal(walks, 1, 'second call hits the cache')
})

test('listWorkspaceFiles: unreadable directory degrades to empty list', async () => {
  const missing = path.join(os.tmpdir(), `zcode-complete-missing-${Date.now()}`)
  const files = await listWorkspaceFiles(missing)
  assert.deepEqual(files, [])
})

test('listWorkspaceFiles: honors a real directory depth limit', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-complete-deep-'))
  try {
    // 8 levels deep — beyond MAX_WALK_DEPTH (6).
    const deep = path.join(workspace, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8')
    await fs.mkdir(deep, { recursive: true })
    await fs.writeFile(path.join(deep, 'deep.txt'), 'x', 'utf8')
    await fs.writeFile(path.join(workspace, 'l1', 'shallow.txt'), 'x', 'utf8')

    const files = await listWorkspaceFiles(workspace)
    assert.ok(files.includes('l1/shallow.txt'))
    assert.ok(!files.includes('l1/l2/l3/l4/l5/l6/l7/l8/deep.txt'), 'beyond depth 6 not walked')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('completer: prefix matches rank above substring matches', async () => {
  const completer = createCompleter({
    cwd: os.tmpdir(),
    listFiles: async () => ['src/readme-helper.js', 'src/notes/readme.md', 'readme.md'],
  })

  const [matches] = await completer('@readme')
  assert.deepEqual(
    matches.map(value => value.trim()),
    ['@readme.md', '@src/readme-helper.js', '@src/notes/readme.md'],
    'startsWith first; substring hits ranked by earlier match position',
  )
})

// End-to-end against the real readline: the completer contract (second
// element = region to replace, completions must extend it) was verified
// against Node's _tabComplete — these tests pin it so a regression in the
// return shape fails loudly instead of silently eating text.
function tabComplete(label, completer, typed) {
  return new Promise(resolve => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    stdout.on('data', () => {})
    const rl = createInterface({ input: stdin, output: stdout, terminal: true, completer })
    stdin.write(typed)
    setTimeout(() => {
      stdin.write('\t')
      setTimeout(() => {
        const line = rl.line
        rl.close()
        resolve(line)
      }, 50)
    }, 50)
  })
}

test('completer through real readline: @ keeps its prefix and the typed line', async () => {
  const workspace = await createTempWorkspace()
  const completer = createCompleter({ cwd: workspace })
  try {
    assert.equal(await tabComplete('single', completer, '@app'), '@app.js ')
    assert.equal(await tabComplete('subdir', completer, '@util'), '@src/util.ts ')
    assert.equal(await tabComplete('midline', completer, 'check @util'), 'check @src/util.ts ')
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
