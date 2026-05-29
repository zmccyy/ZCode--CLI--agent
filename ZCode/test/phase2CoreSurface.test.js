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

const planPath = resolveFromHere(
  import.meta.url,
  '..',
  '..',
  'docs',
  'plans',
  'zcode-detailed-development-plan-v2.md',
)

test('phase 2 regression matrix defines 12 labeled core scenarios', async () => {
  const source = await fs.readFile(planPath, 'utf8')

  // The v2 plan section 5.2 embeds the 12-scenario regression matrix
  // Table format: | S01 | common | 新会话初始化表面 | common | ... |
  const scenarioMatches = source.match(/\|\s*S\d{2}\s*\|/g) ?? []
  assert.ok(
    scenarioMatches.length >= 12,
    `expected at least 12 scenario IDs, got ${scenarioMatches.length}`,
  )
  assert.match(source, /\|\s*场景\s*ID\s*\|/)
  assert.match(source, /\bcommon\b/)
  assert.match(source, /\banthropic\b/)
  assert.match(source, /\bopenai-compatible\b/)
  assert.match(source, /S01/)
  assert.match(source, /S12/)
})

test('phase 2 regression matrix aligns its 12 core scenarios with the main plan', async () => {
  const source = await fs.readFile(planPath, 'utf8')

  // Verify each scenario ID is paired with its description in the v2 plan
  assert.match(source, /S01.*新会话/, 'S01 should reference new session')
  assert.match(source, /S02.*会话恢复/, 'S02 should reference resume')
  assert.match(source, /S03.*单轮对话/, 'S03 should reference single-turn')
  assert.match(source, /S04.*多轮对话/, 'S04 should reference multi-turn')
  assert.match(source, /S05.*Shell/, 'S05 should reference shell')
  assert.match(source, /S06.*Plan/, 'S06 should reference plan mode')
  assert.match(source, /S07.*工具调用.*anthropic/, 'S07 should reference tool calls')
  assert.match(source, /S08.*工具调用.*openai/, 'S08 should reference openai-compatible tool calls')
  assert.match(source, /S09.*Auto-compact/, 'S09 should reference auto-compact')
  assert.match(source, /S10.*MCP/, 'S10 should reference MCP')
  assert.match(source, /S11.*权限/, 'S11 should reference permissions')
  assert.match(source, /S12.*错误恢复/, 'S12 should reference error recovery')

  // Verify the v2 plan documents provider-specific regression tracks
  assert.match(source, /双线路/i, 'plan must document dual-track provider strategy')
  assert.match(source, /Anthropic.*streamChat|Anthropic.*主线/i)
  assert.match(source, /openai-compatible.*独立|openai-compatible.*线路/i)
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
