import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { resolveFromHere } from './helpers/loadModule.js'

async function readZCodeSource(...segments) {
  return fs.readFile(resolveFromHere(import.meta.url, '..', ...segments), 'utf8')
}

async function readWorkspaceFile(...segments) {
  return fs.readFile(
    resolveFromHere(import.meta.url, '..', '..', ...segments),
    'utf8',
  )
}

test('phase 2 regression matrix defines 12 labeled core scenarios', async () => {
  const source = await readWorkspaceFile(
    'docs',
    'plans',
    'zcode-phase2-regression-matrix.md',
  )

  const scenarioMatches = source.match(/\|\s*S\d{2}\s*\|/g) ?? []
  assert.equal(scenarioMatches.length, 12)
  assert.match(source, /\|\s*Track\s*\|/)
  assert.match(source, /\bcommon\b/)
  assert.match(source, /\banthropic\b/)
  assert.match(source, /\bopenai-compatible\b/)
  assert.match(source, /S01/)
  assert.match(source, /S12/)
})

test('public startup notes use product language instead of internal trimmed-repo wording', async () => {
  const source = await readZCodeSource('src', 'cli', 'publicCliCore.js')

  assert.match(source, /public build/i)
  assert.doesNotMatch(source, /trimmed repo/i)
})

test('resume surfaces use ZCode session wording', async () => {
  const source = await readZCodeSource('src', 'components', 'ResumeTask.tsx')

  assert.match(source, /Loading ZCode sessions/)
  assert.match(source, /Fetching your ZCode sessions/)
  assert.match(source, /Error loading ZCode sessions/)
  assert.match(source, /No ZCode sessions found/)
  assert.doesNotMatch(source, /Claude Code sessions/)
})

test('memory command description uses ZCode wording', async () => {
  const source = await readZCodeSource('src', 'commands', 'memory', 'index.ts')

  assert.match(source, /Edit ZCode memory files/)
  assert.doesNotMatch(source, /Edit Claude memory files/)
})

test('permission prompts use ZCode wording across core scenario surfaces', async () => {
  const permissionsSource = await readZCodeSource(
    'src',
    'utils',
    'permissions',
    'permissions.ts',
  )
  const filesystemSource = await readZCodeSource(
    'src',
    'utils',
    'permissions',
    'filesystem.ts',
  )
  const webFetchSource = await readZCodeSource(
    'src',
    'tools',
    'WebFetchTool',
    'WebFetchTool.ts',
  )

  assert.match(permissionsSource, /ZCode requested permission to use/)
  assert.doesNotMatch(permissionsSource, /Claude requested permissions to use/)

  assert.match(filesystemSource, /ZCode requested permission to write to/)
  assert.match(filesystemSource, /ZCode requested permission to read from/)
  assert.doesNotMatch(filesystemSource, /Claude requested permissions to/)

  assert.match(webFetchSource, /ZCode requested permission to use/)
  assert.doesNotMatch(webFetchSource, /Claude requested permissions to use/)
})

test('shell startup guidance uses ZCode wording', async () => {
  const source = await readZCodeSource('src', 'utils', 'Shell.ts')

  assert.match(source, /ZCode requires a Posix shell environment/)
  assert.doesNotMatch(source, /Claude CLI requires a Posix shell environment/)
})
