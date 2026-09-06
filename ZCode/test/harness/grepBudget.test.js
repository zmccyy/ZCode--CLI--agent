// Regression tests: model-supplied regex must never hang the turn.
// Pathological patterns (catastrophic backtracking) are stopped by the match
// budget — matching runs in a worker thread that gets terminated when the
// budget expires — and normal searches keep working through the same path.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { executeGrep, resolveGrepBudgetMs, GREP_BUDGET_ENV } from '../../src/harness/tools/grep.ts'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function makeContext(cwd) {
  return { cwd, state: { readFiles: new Set() } }
}

test('grep budget: default and env override', () => {
  const original = process.env[GREP_BUDGET_ENV]
  try {
    delete process.env[GREP_BUDGET_ENV]
    assert.equal(resolveGrepBudgetMs({}), 10_000)
    process.env[GREP_BUDGET_ENV] = '250'
    assert.equal(resolveGrepBudgetMs(), 250)
    process.env[GREP_BUDGET_ENV] = 'nonsense'
    assert.equal(resolveGrepBudgetMs(), 10_000)
    process.env[GREP_BUDGET_ENV] = '0'
    assert.equal(resolveGrepBudgetMs(), 10_000)
  } finally {
    if (original === undefined) delete process.env[GREP_BUDGET_ENV]
    else process.env[GREP_BUDGET_ENV] = original
  }
})

test('grep: catastrophic backtracking pattern is stopped by the budget, not hanging', { timeout: 30_000 }, async () => {
  const dir = await createTempDir('zcode-grep-redos-')
  const original = process.env[GREP_BUDGET_ENV]
  try {
    // (a+)+$ over a long 'a' run backtracks catastrophically — a synchronous
    // match would run effectively forever.
    await fs.writeFile(path.join(dir, 'bomb.txt'), `a`.repeat(500_000) + 'b', 'utf8')
    process.env[GREP_BUDGET_ENV] = '300'

    const startedAt = Date.now()
    const result = await executeGrep({ pattern: '(a+)+$', multiline: true }, makeContext(dir))
    const elapsed = Date.now() - startedAt

    assert.equal(result.isError, true)
    assert.match(result.content, /match budget/)
    assert.ok(elapsed < 10_000, `returned within budget window, took ${elapsed}ms`)
  } finally {
    if (original === undefined) delete process.env[GREP_BUDGET_ENV]
    else process.env[GREP_BUDGET_ENV] = original
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('grep: normal single-line search works through the matcher worker', async () => {
  const dir = await createTempDir('zcode-grep-line-')
  try {
    await fs.writeFile(
      path.join(dir, 'code.txt'),
      ['const a = 1', 'let b = 2', 'const c = 3'].join('\n'),
      'utf8',
    )
    const result = await executeGrep(
      { pattern: 'const', output_mode: 'content' },
      makeContext(dir),
    )
    assert.equal(result.isError, undefined)
    assert.match(result.content, /code\.txt:1:const a = 1/)
    assert.match(result.content, /code\.txt:3:const c = 3/)
    assert.match(result.content, /2 file|1 file/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('grep: multiline matches report their start line and span lines', async () => {
  const dir = await createTempDir('zcode-grep-ml-')
  try {
    await fs.writeFile(
      path.join(dir, 'multi.txt'),
      ['one', 'two START', 'middle', 'END four', 'five'].join('\n'),
      'utf8',
    )
    const result = await executeGrep(
      { pattern: 'START[\\s\\S]*END', multiline: true, output_mode: 'content', '-A': 2 },
      makeContext(dir),
    )
    assert.equal(result.isError, undefined)
    assert.match(result.content, /multi\.txt:2:/, 'match reported at its start line')
    assert.match(result.content, /middle/, 'spanned lines reachable via context lines')
    assert.match(result.content, /1 file\(s\) with 1 match/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
