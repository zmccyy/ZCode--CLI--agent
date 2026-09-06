import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildAgentSystemPrompt } from '../../src/cli/harnessPrint.js'
import { collectEnvironmentInfo, formatEnvironmentBlock } from '../../src/cli/envInfo.js'
import { createCoreTools } from '../../src/harness/tools/index.ts'

const TEST_CWD = path.dirname(fileURLToPath(import.meta.url))

function buildPrompt(options = {}) {
  return buildAgentSystemPrompt(TEST_CWD, undefined, options)
}

test('system prompt states identity, cwd, and boundary roots', () => {
  const prompt = buildAgentSystemPrompt(TEST_CWD, { addDirs: ['..\\sibling'] })
  assert.ok(prompt.includes('You are ZCode'), 'identity line')
  assert.ok(prompt.includes('cwd:'), 'cwd fact')
  assert.ok(prompt.includes(TEST_CWD), 'absolute cwd')
  assert.ok(prompt.includes('Workspace boundary:'), 'boundary section present')
  assert.ok(prompt.includes(path.resolve(TEST_CWD, '..\\sibling')), 'add-dir root listed')
})

test('agent-mode prompt carries workflow discipline, tool guidance, and communication rules', () => {
  const prompt = buildPrompt()
  for (const marker of [
    '# How to work',
    'Understand before acting',
    'Verify before claiming success',
    'Recover from failures',
    '# Tool guidance',
    '# Communication',
  ]) {
    assert.ok(prompt.includes(marker), `missing section: ${marker}`)
  }
})

test('plan-mode prompt switches to read-only plan discipline', () => {
  const prompt = buildPrompt({ permissionMode: 'plan' })
  assert.ok(prompt.includes('# Plan mode (read-only)'))
  assert.ok(prompt.includes('implementation plan'))
  assert.ok(!prompt.includes('# How to work'), 'agent workflow replaced in plan mode')
  assert.ok(prompt.includes('read-only: produce a plan'), 'permission line explains plan mode')
})

test('permission mode is reported for agent and yolo', () => {
  const agent = buildPrompt({ permissionMode: 'agent' })
  assert.ok(agent.includes('permission mode: agent'))
  const yolo = buildPrompt({ permissionMode: 'yolo' })
  assert.ok(yolo.includes('permission mode: yolo'))
})

test('environment facts render into the prompt when provided', () => {
  const info = {
    cwd: TEST_CWD,
    platform: 'win32',
    osType: 'Windows_NT',
    osRelease: '10.0.26100',
    dateLabel: '2026-09-05 (Saturday)',
    shell: 'Git Bash (bash)',
    git: { branch: 'main', dirtyCount: 3 },
  }
  const prompt = buildPrompt({ envInfo: info, model: 'test-model' })
  assert.ok(prompt.includes('platform: win32 (Windows_NT 10.0.26100)'))
  assert.ok(prompt.includes('date: 2026-09-05 (Saturday)'))
  assert.ok(prompt.includes('shell: Git Bash (bash)'))
  assert.ok(prompt.includes('git: on branch main · 3 uncommitted file(s)'))
  assert.ok(prompt.includes('model: test-model'))
})

test('environment-less prompt stays minimal and valid', () => {
  const prompt = buildPrompt()
  assert.ok(prompt.includes('cwd:'))
  assert.ok(!prompt.includes('undefined'), 'no undefined leakage')
  assert.ok(!prompt.includes('git: on branch'), 'no git facts invented')
})

test('collectEnvironmentInfo reports git state inside a git repo (real probes)', async () => {
  const repoRoot = path.resolve(TEST_CWD, '..', '..')
  const info = await collectEnvironmentInfo(repoRoot)
  assert.equal(info.platform, process.platform)
  assert.ok(info.dateLabel.match(/^\d{4}-\d{2}-\d{2} \(\w+\)$/), `date label: ${info.dateLabel}`)
  assert.ok(typeof info.osType === 'string' && info.osType.length > 0)
  // The project itself is a git repo with a working tree.
  assert.ok(info.git, 'git detected inside the repo')
  assert.equal(typeof info.git.dirtyCount, 'number')
  assert.ok(info.git.branch.length > 0)
})

test('collectEnvironmentInfo degrades outside a git repo', async () => {
  const calls = []
  const fakeRun = async (command, args) => {
    calls.push([command, ...args])
    return { ok: false, stdout: '' }
  }
  const info = await collectEnvironmentInfo('C:\\tmp\\nowhere', {
    run: fakeRun,
    platform: 'win32',
    os: { type: () => 'Windows_NT', release: () => '10' },
    now: () => new Date('2026-09-05T12:00:00'),
  })
  assert.equal(info.git, null, 'git null when probe fails')
  assert.ok(calls.some(([command]) => command === 'git'), 'git probe attempted')
})

test('collectEnvironmentInfo detects Git Bash before PowerShell on win32', async () => {
  const probes = []
  const fakeRun = async (command, args) => {
    probes.push(command)
    if (command === 'git') {
      if (args[0] === 'rev-parse') return { ok: true, stdout: 'true\n' }
      if (args[0] === 'branch') return { ok: true, stdout: 'main\n' }
      return { ok: true, stdout: '' }
    }
    if (command === 'bash') return { ok: true, stdout: 'GNU bash, version 5.2\n' }
    return { ok: false, stdout: '' }
  }
  const info = await collectEnvironmentInfo('C:\\repo', {
    run: fakeRun,
    platform: 'win32',
    os: { type: () => 'Windows_NT', release: () => '10' },
    now: () => new Date('2026-09-05T12:00:00'),
  })
  assert.equal(info.git.branch, 'main')
  assert.equal(info.shell, 'Git Bash (bash)')
  assert.ok(!probes.includes('powershell'), 'bash hit short-circuits powershell probe')
})

test('collectEnvironmentInfo falls back to PowerShell when bash is missing', async () => {
  const fakeRun = async (command, args) => {
    if (command === 'git' && args[0] === 'rev-parse') return { ok: true, stdout: 'true\n' }
    if (command === 'git' && args[0] === 'branch') return { ok: true, stdout: 'dev\n' }
    if (command === 'git' && args[0] === 'status') return { ok: true, stdout: ' M a.txt\n' }
    if (command === 'bash') return { ok: false, stdout: '' }
    if (command === 'powershell') return { ok: true, stdout: '5.1.26100.2161\n' }
    return { ok: false, stdout: '' }
  }
  const info = await collectEnvironmentInfo('C:\\repo', {
    run: fakeRun,
    platform: 'win32',
    os: { type: () => 'Windows_NT', release: () => '10' },
    now: () => new Date('2026-09-05T12:00:00'),
  })
  assert.equal(info.shell, 'Windows PowerShell 5.1.26100.2161')
  assert.equal(info.git.dirtyCount, 1)
})

test('a failed git status probe reports "unknown", never a clean tree', async () => {  const fakeRun = async (command, args) => {
    if (command === 'git' && args[0] === 'rev-parse') return { ok: true, stdout: 'true\n' }
    if (command === 'git' && args[0] === 'branch') return { ok: true, stdout: 'main\n' }
    // status probe fails (slow repo / maxBuffer): dirtyCount must be null
    return { ok: false, stdout: '' }
  }
  const info = await collectEnvironmentInfo('C:\\repo', {
    run: fakeRun,
    platform: 'win32',
    os: { type: () => 'Windows_NT', release: () => '10' },
    now: () => new Date('2026-09-05T12:00:00'),
  })
  assert.equal(info.git.dirtyCount, null)
  const block = formatEnvironmentBlock(info)
  assert.match(block, /state unknown/)
  assert.doesNotMatch(block, /· clean/)
})

test('git status probe uses NUL-separated porcelain output for an accurate count', async () => {
  const calls = []
  const fakeRun = async (command, args) => {
    calls.push([command, ...args])
    if (command === 'git' && args[0] === 'rev-parse') return { ok: true, stdout: 'true\n' }
    if (command === 'git' && args[0] === 'branch') return { ok: true, stdout: 'main\n' }
    if (command === 'git' && args[0] === 'status') {
      // Three NUL-separated entries (porcelain -z).
      return { ok: true, stdout: ' M a.txt\0?? b.txt\0M  c.txt\0' }
    }
    return { ok: false, stdout: '' }
  }
  const info = await collectEnvironmentInfo('C:\\repo', {
    run: fakeRun,
    platform: 'win32',
    os: { type: () => 'Windows_NT', release: () => '10' },
    now: () => new Date('2026-09-05T12:00:00'),
  })
  assert.equal(info.git.dirtyCount, 3)
  assert.ok(calls.some(([command, ...args]) => command === 'git' && args.includes('-z')), '-z requested')
})

test('every core tool description documents when-to-use and constraints', () => {
  const tools = createCoreTools()
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  for (const name of ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash']) {
    const tool = byName.get(name)
    assert.ok(tool, `tool present: ${name}`)
    assert.ok(tool.description.length >= 120, `${name} description is substantive`)
  }
  // Key behavioral contracts surfaced in descriptions.
  assert.ok(byName.get('Edit').description.includes('replace_all'))
  assert.ok(byName.get('Edit').description.includes('Read tool first'))
  assert.ok(byName.get('Read').description.includes('offset'))
  assert.ok(byName.get('Bash').description.includes('Non-interactive'))
  assert.ok(byName.get('Write').description.includes('Prefer Edit'))
  assert.ok(byName.get('Grep').description.includes('output_mode'))
})

test('tool descriptions stay consistent with read-before-write behavior', () => {
  const tools = createCoreTools()
  const write = tools.find(tool => tool.name === 'Write')
  assert.ok(write.description.includes('reading it with the Read tool'))
})
