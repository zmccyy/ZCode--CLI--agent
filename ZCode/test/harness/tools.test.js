import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { executeRead } from '../../src/harness/tools/read.ts'
import { executeGlob } from '../../src/harness/tools/glob.ts'
import { executeGrep } from '../../src/harness/tools/grep.ts'
import { executeWrite } from '../../src/harness/tools/write.ts'
import { executeEdit } from '../../src/harness/tools/edit.ts'
import { executeBash } from '../../src/harness/tools/bash.ts'
import { createToolRegistry } from '../../src/harness/tools/registry.ts'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function makeContext(cwd) {
  return { cwd, state: { readFiles: new Set() } }
}

// ─── Read ───

test('Read formats cat -n style output and honors offset/limit', async () => {
  const dir = await createTempDir('zcode-read-')
  try {
    const file = path.join(dir, 'sample.txt')
    await fs.writeFile(file, ['alpha', 'beta', 'gamma', 'delta'].join('\n'), 'utf8')
    const context = makeContext(dir)

    const full = await executeRead({ file_path: 'sample.txt' }, context)
    assert.equal(full.isError, undefined)
    assert.match(full.content, /^ {5}1\talpha$/m)
    assert.match(full.content, /^ {5}4\tdelta$/m)
    assert.ok(context.state.readFiles.has(file))

    const paged = await executeRead({ file_path: file, offset: 2, limit: 2 }, context)
    assert.match(paged.content, /^ {5}2\tbeta$/m)
    assert.match(paged.content, /^ {5}3\tgamma$/m)
    assert.doesNotMatch(paged.content, /alpha/)
    assert.match(paged.content, /showing lines 2-3 of 4/)

    const missing = await executeRead({ file_path: 'nope.txt' }, context)
    assert.equal(missing.isError, true)
    assert.match(missing.content, /does not exist/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('Read rejects binary content and directories', async () => {
  const dir = await createTempDir('zcode-read-bin-')
  try {
    await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]))
    await fs.mkdir(path.join(dir, 'subdir'))

    const context = makeContext(dir)
    const binary = await executeRead({ file_path: 'blob.bin' }, context)
    assert.equal(binary.isError, true)
    assert.match(binary.content, /binary/)

    const directory = await executeRead({ file_path: 'subdir' }, context)
    assert.equal(directory.isError, true)
    assert.match(directory.content, /directory/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ─── Glob ───

test('Glob matches patterns, skips noise dirs, sorts by mtime', async () => {
  const dir = await createTempDir('zcode-glob-')
  try {
    await fs.mkdir(path.join(dir, 'src', 'deep'), { recursive: true })
    await fs.mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src', 'a.ts'), 'a')
    await fs.writeFile(path.join(dir, 'src', 'deep', 'b.ts'), 'b')
    await fs.writeFile(path.join(dir, 'node_modules', 'pkg', 'c.ts'), 'c')
    await fs.writeFile(path.join(dir, 'README.md'), 'readme')

    const context = makeContext(dir)
    const tsFiles = await executeGlob({ pattern: '**/*.ts' }, context)
    assert.equal(tsFiles.isError, undefined)
    const lines = tsFiles.content.split('\n')
    assert.equal(lines.length, 2)
    assert.ok(lines.every(line => line.endsWith('.ts')))
    assert.ok(lines.some(line => line.includes('deep')))

    const readme = await executeGlob({ pattern: 'README.md' }, context)
    assert.match(readme.content, /README\.md$/)

    const none = await executeGlob({ pattern: '*.xyz' }, context)
    assert.equal(none.content, 'No files found')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ─── Grep ───

test('Grep supports files_with_matches, content, count, glob and context', async () => {
  const dir = await createTempDir('zcode-grep-')
  try {
    await fs.mkdir(path.join(dir, 'src'), { recursive: true })
    await fs.writeFile(path.join(dir, 'src', 'a.ts'), 'const one = 1\nconst two = 2\nconst three = 3\n', 'utf8')
    await fs.writeFile(path.join(dir, 'src', 'b.js'), 'const skip = 0\n', 'utf8')
    await fs.writeFile(path.join(dir, 'notes.md'), 'const inNotes = true\n', 'utf8')
    const context = makeContext(dir)

    const files = await executeGrep({ pattern: 'const' }, context)
    assert.match(files.content, /a\.ts/)
    assert.match(files.content, /notes\.md/)
    assert.match(files.content, /b\.js/)
    assert.match(files.content, /3 file\(s\) with 5 match/)

    const content = await executeGrep({ pattern: 'const', path: 'src', glob: '*.ts', output_mode: 'content' }, context)
    assert.match(content.content, /a\.ts:1:const one = 1/)
    assert.match(content.content, /a\.ts:3:const three = 3/)
    assert.doesNotMatch(content.content, /b\.js/)

    const counted = await executeGrep({ pattern: 'const', path: 'src', glob: '*.ts', output_mode: 'count' }, context)
    assert.match(counted.content, /a\.ts:3/)

    const withContext = await executeGrep(
      { pattern: 'two', path: 'src', glob: '*.ts', output_mode: 'content', '-B': 1, '-A': 1 },
      context,
    )
    assert.match(withContext.content, /one = 1/)
    assert.match(withContext.content, /three = 3/)

    const insensitive = await executeGrep({ pattern: 'CONST', '-i': true, path: 'src', glob: '*.ts' }, context)
    assert.match(insensitive.content, /a\.ts/)

    const invalid = await executeGrep({ pattern: '([unclosed' }, context)
    assert.equal(invalid.isError, true)
    assert.match(invalid.content, /invalid regular expression/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ─── Write ───

test('Write creates files with parent dirs and updates existing ones', async () => {
  const dir = await createTempDir('zcode-write-')
  try {
    const context = makeContext(dir)
    const created = await executeWrite(
      { file_path: 'nested/dir/file.txt', content: 'hello' },
      context,
    )
    assert.equal(created.isError, undefined)
    assert.match(created.content, /File created successfully/)
    assert.equal(await fs.readFile(path.join(dir, 'nested', 'dir', 'file.txt'), 'utf8'), 'hello')

    const updated = await executeWrite(
      { file_path: 'nested/dir/file.txt', content: 'world' },
      context,
    )
    assert.match(updated.content, /File updated successfully/)
    assert.equal(await fs.readFile(path.join(dir, 'nested', 'dir', 'file.txt'), 'utf8'), 'world')

    const bad = await executeWrite({ file_path: 'x.txt' }, context)
    assert.equal(bad.isError, true)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ─── Edit ───

test('Edit enforces read-before-edit, uniqueness, and exact replacement', async () => {
  const dir = await createTempDir('zcode-edit-')
  try {
    const file = path.join(dir, 'code.js')
    await fs.writeFile(file, 'function a() {}\nfunction a() {}\nconst marker = 1;\n', 'utf8')
    const context = makeContext(dir)

    const notRead = await executeEdit({ file_path: 'code.js', old_string: 'marker', new_string: 'flag' }, context)
    assert.equal(notRead.isError, true)
    assert.match(notRead.content, /has not been read yet/)

    await executeRead({ file_path: 'code.js' }, context)

    const notFound = await executeEdit({ file_path: 'code.js', old_string: 'missing-text', new_string: 'x' }, context)
    assert.equal(notFound.isError, true)
    assert.match(notFound.content, /not found/)

    const notUnique = await executeEdit({ file_path: 'code.js', old_string: 'function a() {}', new_string: 'function b() {}' }, context)
    assert.equal(notUnique.isError, true)
    assert.match(notUnique.content, /appears 2 times/)

    const replaced = await executeEdit(
      { file_path: 'code.js', old_string: 'const marker = 1;', new_string: 'const marker = 2;' },
      context,
    )
    assert.equal(replaced.isError, undefined)
    assert.match(replaced.content, /1 replacement/)
    const afterReplace = await fs.readFile(file, 'utf8')
    assert.match(afterReplace, /const marker = 2;/)

    const replacedAll = await executeEdit(
      { file_path: 'code.js', old_string: 'function a() {}', new_string: 'function b() {}', replace_all: true },
      context,
    )
    assert.match(replacedAll.content, /2 replacements/)
    const afterAll = await fs.readFile(file, 'utf8')
    assert.equal(afterAll.match(/function b\(\) \{\}/g).length, 2)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ─── Bash ───

test('Bash runs commands via bash -c and reports failures and timeouts', async () => {
  const dir = await createTempDir('zcode-bash-')
  try {
    const context = makeContext(dir)

    const ok = await executeBash({ command: 'echo hello && pwd' }, context)
    assert.equal(ok.isError, undefined)
    assert.match(ok.content, /hello/)

    const failing = await executeBash({ command: 'echo boom >&2; exit 3' }, context)
    assert.equal(failing.isError, true)
    assert.match(failing.content, /exited with code 3/)
    assert.match(failing.content, /boom/)

    const timedOut = await executeBash({ command: 'sleep 2', timeout: 300 }, context)
    assert.equal(timedOut.isError, true)
    assert.match(timedOut.content, /timed out/)

    await fs.writeFile(path.join(dir, 'marker.txt'), 'x', 'utf8')
    const cwdCheck = await executeBash({ command: 'ls marker.txt' }, context)
    assert.equal(cwdCheck.isError, undefined)
    assert.match(cwdCheck.content, /marker\.txt/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

// ─── Registry ───

test('tool registry rejects duplicates and unknown lookups', () => {
  const registry = createToolRegistry([
    { name: 'A', description: '', inputSchema: { type: 'object' }, readOnly: true, execute: () => ({ content: '' }) },
    { name: 'B', description: '', inputSchema: { type: 'object' }, readOnly: false, execute: () => ({ content: '' }) },
  ])

  assert.equal(registry.has('A'), true)
  assert.equal(registry.has('C'), false)
  assert.deepEqual(registry.list().map(tool => tool.name), ['A', 'B'])

  assert.throws(() => createToolRegistry([
    { name: 'A', description: '', inputSchema: { type: 'object' }, readOnly: true, execute: () => ({ content: '' }) },
    { name: 'A', description: '', inputSchema: { type: 'object' }, readOnly: true, execute: () => ({ content: '' }) },
  ]), /duplicate tool name/)
})
