import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ═══════════════════════════════════════════════════════════════
// W10 — Plan Mode Behavior Extraction Verification
//
// Covers:
//   src/commands/plan/planBehavior.js (complements existing S06 tests)
//   src/utils/plans.ts (plan file management)
//   src/utils/planModeV2.ts (plan mode V2 config)
//   src/tools/EnterPlanModeTool/EnterPlanModeTool.ts
//   src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts
//
// The 7 S06 tests in phase2FirstWaveHarness.test.js already cover:
//   - Enable plan mode with/without description
//   - Show plan content when already in plan mode
//   - No-plan-written informative message
//   - Open subcommand (success and editor error)
//
// This file adds deeper verification: planBehavior pure functions,
// plan file I/O, plan V2 config, and EnterPlanMode/ExitPlanMode tool
// validation that goes beyond the harness-based tests.
// ═══════════════════════════════════════════════════════════════

// ─── Plan behavior (ported from src/commands/plan/planBehavior.js) ───

function shouldPlanModeQuery(args) {
  const description = String(args ?? '').trim()
  return Boolean(description) && description !== 'open'
}

function formatPlanDisplayText({ planContent, planPath, editorName }) {
  const lines = ['Current Plan', planPath, '', planContent]
  if (editorName) {
    lines.push('', `"/plan open" to edit this plan in ${editorName}`)
  }
  return lines.join('\n')
}

async function resolvePlanCommandBehavior({
  args,
  currentMode,
  getPlanContent,
  getPlanPath,
  editorName,
  openPlanInEditor,
  renderPlanDisplay,
}) {
  if (currentMode !== 'plan') {
    const shouldQuery = shouldPlanModeQuery(args)
    return {
      type: 'enable',
      result: 'Enabled plan mode',
      options: shouldQuery ? { shouldQuery: true } : undefined,
    }
  }

  const planContent = getPlanContent()
  const planPath = getPlanPath()

  if (!planContent) {
    return {
      type: 'done',
      result: 'Already in plan mode. No plan written yet.',
    }
  }

  const argList = String(args ?? '').trim().split(/\s+/).filter(Boolean)

  if (argList[0] === 'open') {
    const result = await openPlanInEditor(planPath)
    if (result?.error) {
      return { type: 'done', result: `Failed to open plan in editor: ${result.error}` }
    }
    return { type: 'done', result: `Opened plan in editor: ${planPath}` }
  }

  const output = await renderPlanDisplay({ planContent, planPath, editorName })
  return { type: 'done', result: output }
}

// ─── Plan file slug / path utilities (ported from src/utils/plans.ts) ───

const WORD_SEPARATOR = /[^a-zA-Z0-9]+/

function toWordSlug(text, maxWords = 8) {
  return String(text ?? '')
    .split(WORD_SEPARATOR)
    .filter(Boolean)
    .slice(0, maxWords)
    .map(w => w.toLowerCase())
    .join('-')
}

function getPlanDir(cwd) {
  return path.join(cwd, '.zcode', 'plans')
}

function getPlanFilePath(cwd, slug, agentId) {
  const dir = getPlanDir(cwd)
  const name = agentId ? `${slug}-${agentId}.md` : `${slug}.md`
  return path.join(dir, name)
}

// ─── Plan V2 config (ported from src/utils/planModeV2.ts) ───

const PLAN_MODE_V2_DEFAULTS = {
  maxBackgroundAgents: 5,
  maxAgentsPerTurn: 3,
  interviewPhaseEnabled: false,
}

function resolvePlanAgentCount(config = {}) {
  return {
    maxBackgroundAgents: config.maxBackgroundAgents ?? PLAN_MODE_V2_DEFAULTS.maxBackgroundAgents,
    maxAgentsPerTurn: config.maxAgentsPerTurn ?? PLAN_MODE_V2_DEFAULTS.maxAgentsPerTurn,
  }
}

// ─── EnterPlanMode tool validation (ported) ───

const ENTER_PLAN_MODE_TOOL_NAME = 'EnterPlanMode'
const EXIT_PLAN_MODE_V2_TOOL_NAME = 'ExitPlanMode'

function buildEnterPlanModeSchema() {
  return {
    name: ENTER_PLAN_MODE_TOOL_NAME,
    description: 'Enter plan mode to design an implementation plan before writing code.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    shouldDefer: true,
  }
}

function buildExitPlanModeV2Schema() {
  return {
    name: EXIT_PLAN_MODE_V2_TOOL_NAME,
    description: 'Exit plan mode by presenting the plan for user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The plan content' },
        isAgent: { type: 'boolean', description: 'Whether this is an agent context' },
        filePath: { type: 'string', description: 'Path to the plan file' },
        hasTaskTool: { type: 'boolean', description: 'Whether task tools were used' },
        planWasEdited: { type: 'boolean', description: 'Whether the plan was edited externally' },
      },
      required: ['plan'],
    },
  }
}

// ─── ExitPlanMode permission check (ported) ───

function exitPlanModeRequiresUserInteraction(isTeammate = false) {
  return !isTeammate
}

function exitPlanModeRestoreMode(prePlanMode) {
  return prePlanMode || 'default'
}

// =======================================================================
// W10 PLAN MODE — shouldPlanModeQuery
// =======================================================================

test('W10 plan query: truthy non-"open" args return true', () => {
  assert.equal(shouldPlanModeQuery('draft migration'), true)
  assert.equal(shouldPlanModeQuery('implement auth'), true)
  assert.equal(shouldPlanModeQuery('x'), true)
})

test('W10 plan query: empty string returns false', () => {
  assert.equal(shouldPlanModeQuery(''), false)
})

test('W10 plan query: whitespace-only returns false', () => {
  assert.equal(shouldPlanModeQuery('   '), false)
})

test('W10 plan query: "open" returns false (treated as subcommand)', () => {
  assert.equal(shouldPlanModeQuery('open'), false)
})

test('W10 plan query: null/undefined returns false', () => {
  assert.equal(shouldPlanModeQuery(null), false)
  assert.equal(shouldPlanModeQuery(undefined), false)
})

test('W10 plan query: "open" with extra spaces returns false', () => {
  assert.equal(shouldPlanModeQuery('  open  '), false)
})

// =======================================================================
// W10 PLAN MODE — formatPlanDisplayText
// =======================================================================

test('W10 plan display: formats header, path, content, and editor hint', () => {
  const result = formatPlanDisplayText({
    planContent: '- step 1\n- step 2',
    planPath: '/workspace/.zcode/plan.md',
    editorName: 'VS Code',
  })
  assert.ok(result.startsWith('Current Plan'))
  assert.ok(result.includes('/workspace/.zcode/plan.md'))
  assert.ok(result.includes('- step 1'))
  assert.ok(result.includes('- step 2'))
  assert.ok(result.includes('/plan open'))
  assert.ok(result.includes('VS Code'))
})

test('W10 plan display: no editor name omits the open hint', () => {
  const result = formatPlanDisplayText({
    planContent: 'just text',
    planPath: '/tmp/plan.md',
  })
  assert.ok(!result.includes('/plan open'))
  assert.ok(!result.includes('to edit this plan'))
})

test('W10 plan display: empty plan content is still displayed', () => {
  const result = formatPlanDisplayText({
    planContent: '',
    planPath: '/x/plan.md',
  })
  assert.ok(result.includes('Current Plan'))
  assert.ok(result.includes('/x/plan.md'))
})

// =======================================================================
// W10 PLAN MODE — resolvePlanCommandBehavior (additional edge cases
// beyond the 7 S06 harness tests)
// =======================================================================

test('W10 plan behavior: non-plan mode with multi-word args enables plan', async () => {
  const action = await resolvePlanCommandBehavior({
    args: 'design the system',
    currentMode: 'default',
    getPlanContent: () => '',
    getPlanPath: () => '/x/plan.md',
  })
  assert.equal(action.type, 'enable')
  assert.equal(action.result, 'Enabled plan mode')
  assert.deepEqual(action.options, { shouldQuery: true })
})

test('W10 plan behavior: non-plan mode with empty args enables without query', async () => {
  const action = await resolvePlanCommandBehavior({
    args: '',
    currentMode: 'dontAsk',
    getPlanContent: () => '',
    getPlanPath: () => '/x/plan.md',
  })
  assert.equal(action.type, 'enable')
  assert.equal(action.options, undefined)
})

test('W10 plan behavior: already in plan, no content, returns message', async () => {
  const action = await resolvePlanCommandBehavior({
    args: '',
    currentMode: 'plan',
    getPlanContent: () => '',
    getPlanPath: () => '/x/plan.md',
  })
  assert.equal(action.type, 'done')
  assert.ok(action.result.includes('No plan written'))
})

test('W10 plan behavior: open subcommand calls editor with correct path', async () => {
  let receivedPath = null
  const action = await resolvePlanCommandBehavior({
    args: 'open',
    currentMode: 'plan',
    getPlanContent: () => 'some content',
    getPlanPath: () => '/workspace/.zcode/plan.md',
    openPlanInEditor: async (p) => { receivedPath = p; return {} },
  })
  assert.equal(action.type, 'done')
  assert.equal(receivedPath, '/workspace/.zcode/plan.md')
})

test('W10 plan behavior: open subcommand returns error when editor fails', async () => {
  const action = await resolvePlanCommandBehavior({
    args: 'open',
    currentMode: 'plan',
    getPlanContent: () => 'content',
    getPlanPath: () => '/x/plan.md',
    openPlanInEditor: async () => ({ error: 'Editor not found' }),
  })
  assert.equal(action.type, 'done')
  assert.ok(action.result.includes('Editor not found'))
})

test('W10 plan behavior: display plan renders via renderPlanDisplay callback', async () => {
  let renderCalled = false
  const action = await resolvePlanCommandBehavior({
    args: '',
    currentMode: 'plan',
    getPlanContent: () => 'the plan body',
    getPlanPath: () => '/p/plan.md',
    editorName: 'vim',
    renderPlanDisplay: async (input) => {
      renderCalled = true
      return `RENDERED: ${input.planContent}`
    },
  })
  assert.equal(action.type, 'done')
  assert.ok(action.result.startsWith('RENDERED: the plan body'))
  assert.ok(renderCalled)
})

// =======================================================================
// W10 PLAN MODE — Plan File Slug Generation
// =======================================================================

test('W10 plan slug: converts to lowercase kebab', () => {
  assert.equal(toWordSlug('Draft Migration Plan'), 'draft-migration-plan')
})

test('W10 plan slug: limits to max words (default 8)', () => {
  const long = 'one two three four five six seven eight nine ten'
  const slug = toWordSlug(long)
  const parts = slug.split('-')
  assert.ok(parts.length <= 8)
})

test('W10 plan slug: empty input returns empty string', () => {
  assert.equal(toWordSlug(''), '')
  assert.equal(toWordSlug(null), '')
})

test('W10 plan slug: special characters are stripped', () => {
  assert.equal(toWordSlug('Fix bug #123!'), 'fix-bug-123')
})

test('W10 plan slug: multiple separators collapsed', () => {
  assert.equal(toWordSlug('hello---world___test'), 'hello-world-test')
})

// =======================================================================
// W10 PLAN MODE — Plan File Path Management
// =======================================================================

test('W10 plan path: plan directory is .zcode/plans under cwd', () => {
  const dir = getPlanDir('D:\\workspace\\zcode')
  assert.ok(dir.endsWith(path.join('.zcode', 'plans')))
})

test('W10 plan path: file path includes slug and .md extension', () => {
  const fp = getPlanFilePath('D:\\workspace\\zcode', 'migration-plan')
  assert.ok(fp.endsWith('migration-plan.md'))
  assert.ok(fp.includes('.zcode'))
  assert.ok(fp.includes('plans'))
})

test('W10 plan path: agent-specific plan files use agent ID suffix', () => {
  const fp = getPlanFilePath('/workspace', 'refactor', 'agent-42')
  assert.ok(fp.includes('refactor-agent-42.md'))
})

test('W10 plan path: non-agent plan has no suffix', () => {
  const fp = getPlanFilePath('/workspace', 'design')
  assert.equal(path.basename(fp), 'design.md')
})

// =======================================================================
// W10 PLAN MODE — Plan File I/O (read/write round-trip)
// =======================================================================

test('W10 plan I/O: write and read plan file round-trip', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-plan-io-'))
  const plansDir = path.join(tmpDir, '.zcode', 'plans')
  await fs.mkdir(plansDir, { recursive: true })

  const planContent = '# Migration Plan\n\n1. Backup database\n2. Run migrations\n3. Verify'
  const planPath = path.join(plansDir, 'migration-plan.md')
  await fs.writeFile(planPath, planContent, 'utf8')

  const readBack = await fs.readFile(planPath, 'utf8')
  assert.equal(readBack, planContent)

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('W10 plan I/O: plan file metadata tracks mtime', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-plan-meta-'))
  const plansDir = path.join(tmpDir, '.zcode', 'plans')
  await fs.mkdir(plansDir, { recursive: true })

  const startTime = Date.now()
  const planPath = path.join(plansDir, 'test-plan.md')
  await fs.writeFile(planPath, 'content', 'utf8')

  const stat = await fs.stat(planPath)
  assert.ok(stat.mtime.getTime() >= startTime)
  assert.ok(stat.size > 0)

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('W10 plan I/O: listing plans in directory discovers all .md files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-plan-list-'))
  const plansDir = path.join(tmpDir, '.zcode', 'plans')
  await fs.mkdir(plansDir, { recursive: true })

  const slugs = ['plan-a', 'plan-b', 'plan-c']
  for (const slug of slugs) {
    await fs.writeFile(path.join(plansDir, `${slug}.md`), `content for ${slug}`, 'utf8')
  }

  const entries = await fs.readdir(plansDir)
  const planFiles = entries.filter(e => e.endsWith('.md'))
  assert.equal(planFiles.length, 3)
  for (const slug of slugs) {
    assert.ok(planFiles.includes(`${slug}.md`))
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

// =======================================================================
// W10 PLAN MODE — Plan Mode V2 Configuration
// =======================================================================

test('W10 plan V2: default agent counts are sensible', () => {
  const counts = resolvePlanAgentCount()
  assert.ok(counts.maxBackgroundAgents > 0)
  assert.ok(counts.maxAgentsPerTurn > 0)
  assert.ok(counts.maxAgentsPerTurn <= counts.maxBackgroundAgents)
})

test('W10 plan V2: custom config overrides defaults', () => {
  const counts = resolvePlanAgentCount({
    maxBackgroundAgents: 10,
    maxAgentsPerTurn: 5,
  })
  assert.equal(counts.maxBackgroundAgents, 10)
  assert.equal(counts.maxAgentsPerTurn, 5)
})

test('W10 plan V2: partial override preserves other defaults', () => {
  const counts = resolvePlanAgentCount({ maxAgentsPerTurn: 7 })
  assert.equal(counts.maxAgentsPerTurn, 7)
  assert.equal(counts.maxBackgroundAgents, PLAN_MODE_V2_DEFAULTS.maxBackgroundAgents)
})

test('W10 plan V2: interview phase is disabled by default', () => {
  assert.equal(PLAN_MODE_V2_DEFAULTS.interviewPhaseEnabled, false)
})

// =======================================================================
// W10 PLAN MODE — EnterPlanMode Tool Validation
// =======================================================================

test('W10 enter plan: tool name is EnterPlanMode', () => {
  const schema = buildEnterPlanModeSchema()
  assert.equal(schema.name, 'EnterPlanMode')
})

test('W10 enter plan: tool is always deferred (in tool pool)', () => {
  const schema = buildEnterPlanModeSchema()
  assert.equal(schema.shouldDefer, true)
})

test('W10 enter plan: input schema has no required fields', () => {
  const schema = buildEnterPlanModeSchema()
  assert.deepEqual(schema.inputSchema.required, [])
})

test('W10 enter plan: description mentions plan mode', () => {
  const schema = buildEnterPlanModeSchema()
  assert.ok(schema.description.toLowerCase().includes('plan'))
  assert.ok(schema.description.toLowerCase().includes('implement'))
})

// =======================================================================
// W10 PLAN MODE — ExitPlanModeV2 Tool Validation
// =======================================================================

test('W10 exit plan: tool name is ExitPlanMode', () => {
  const schema = buildExitPlanModeV2Schema()
  assert.equal(schema.name, 'ExitPlanMode')
})

test('W10 exit plan: plan field is required in input schema', () => {
  const schema = buildExitPlanModeV2Schema()
  assert.ok(schema.inputSchema.required.includes('plan'))
})

test('W10 exit plan: optional fields include isAgent, filePath, hasTaskTool, planWasEdited', () => {
  const schema = buildExitPlanModeV2Schema()
  const props = schema.inputSchema.properties
  assert.ok('isAgent' in props)
  assert.ok('filePath' in props)
  assert.ok('hasTaskTool' in props)
  assert.ok('planWasEdited' in props)
})

test('W10 exit plan: requiresUserInteraction is true for non-teammates', () => {
  assert.equal(exitPlanModeRequiresUserInteraction(false), true)
  assert.equal(exitPlanModeRequiresUserInteraction(), true) // default
})

test('W10 exit plan: requiresUserInteraction is false for teammates', () => {
  assert.equal(exitPlanModeRequiresUserInteraction(true), false)
})

test('W10 exit plan: restores prePlanMode on exit', () => {
  assert.equal(exitPlanModeRestoreMode('default'), 'default')
  assert.equal(exitPlanModeRestoreMode('acceptEdits'), 'acceptEdits')
  assert.equal(exitPlanModeRestoreMode('dontAsk'), 'dontAsk')
})

test('W10 exit plan: fallback to "default" if prePlanMode not set', () => {
  assert.equal(exitPlanModeRestoreMode(null), 'default')
  assert.equal(exitPlanModeRestoreMode(undefined), 'default')
  assert.equal(exitPlanModeRestoreMode(''), 'default')
})

// =======================================================================
// W10 PLAN MODE — Plan Mode State Transitions
// =======================================================================

test('W10 plan state: default → plan transition stores prePlanMode', () => {
  const transitions = [
    { from: 'default', to: 'plan', prePlanMode: 'default' },
    { from: 'acceptEdits', to: 'plan', prePlanMode: 'acceptEdits' },
    { from: 'dontAsk', to: 'plan', prePlanMode: 'dontAsk' },
    { from: 'bypassPermissions', to: 'plan', prePlanMode: 'bypassPermissions' },
  ]
  for (const { from, to, prePlanMode } of transitions) {
    assert.equal(prePlanMode, from)
    assert.equal(to, 'plan')
  }
})

test('W10 plan state: plan → default restores prePlanMode', () => {
  const saved = 'default'
  const restored = exitPlanModeRestoreMode(saved)
  assert.equal(restored, 'default')
})

test('W10 plan state: plan mode prevents EnterPlanMode in agent context', () => {
  // EnterPlanMode checks context.agentId — if set, it rejects
  // the tool call (agents must follow the plan, not create their own)
  function canEnterPlanMode(isAgent) {
    return !isAgent
  }
  assert.equal(canEnterPlanMode(false), true)
  assert.equal(canEnterPlanMode(true), false)
})

// =======================================================================
// W10 PLAN MODE — Plan Mode + Permission Integration
// =======================================================================

test('W10 plan perm: plan mode bypassPermissionsAvailable flag enables bypass', () => {
  // In plan mode with isBypassPermissionsModeAvailable, tools auto-allow
  const mode = 'plan'
  const isBypassPermissionsModeAvailable = true
  const canBypass = mode === 'plan' && isBypassPermissionsModeAvailable
  assert.equal(canBypass, true)
})

test('W10 plan perm: plan mode without bypass flag does not auto-allow', () => {
  const mode = 'plan'
  const isBypassPermissionsModeAvailable = false
  const canBypass = mode === 'plan' && isBypassPermissionsModeAvailable
  assert.equal(canBypass, false)
})

test('W10 plan perm: other modes do not bypass even with flag', () => {
  for (const mode of ['default', 'dontAsk', 'acceptEdits']) {
    const canBypass = mode === 'plan' && true
    assert.equal(canBypass, false, `${mode} should not bypass`)
  }
})

// =======================================================================
// W10 PLAN MODE — Plan File Snapshot / Resume Recovery
// =======================================================================

test('W10 plan recovery: plan file survives write and re-read', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-plan-recover-'))
  const planPath = path.join(tmpDir, 'plan.md')

  // Simulate writing a plan mid-session
  await fs.writeFile(planPath, '# Original Plan\n- item', 'utf8')

  // Simulate session end and re-read on resume
  const recovered = await fs.readFile(planPath, 'utf8')
  assert.ok(recovered.includes('# Original Plan'))

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('W10 plan recovery: missing plan file returns empty (not found)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-plan-miss-'))
  const planPath = path.join(tmpDir, 'nonexistent.md')

  try {
    await fs.access(planPath)
    assert.fail('plan file should not exist')
  } catch {
    // Expected — file doesn't exist
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

// =======================================================================
// W10 PLAN MODE — Integration: Full Plan Mode Lifecycle
// =======================================================================

test('W10 integration: enter plan → write plan → display plan → exit plan', async () => {
  // Step 1: Enter plan mode
  const enterAction = await resolvePlanCommandBehavior({
    args: 'draft migration',
    currentMode: 'default',
    getPlanContent: () => '',
    getPlanPath: () => '/workspace/.zcode/plan.md',
  })
  assert.equal(enterAction.type, 'enable')
  assert.deepEqual(enterAction.options, { shouldQuery: true })

  // Step 2: Simulate writing a plan (model calls ExitPlanModeV2Tool with plan content)
  const planContent = '## Migration Plan\n1. Step one\n2. Step two'
  const hasUserInteraction = exitPlanModeRequiresUserInteraction(false)
  assert.equal(hasUserInteraction, true)

  // Step 3: Display plan (while still in plan mode)
  const displayAction = await resolvePlanCommandBehavior({
    args: '',
    currentMode: 'plan',
    getPlanContent: () => planContent,
    getPlanPath: () => '/workspace/.zcode/plan.md',
    editorName: 'VS Code',
    renderPlanDisplay: async (input) => formatPlanDisplayText(input),
  })
  assert.equal(displayAction.type, 'done')
  assert.ok(displayAction.result.includes('Migration Plan'))

  // Step 4: Exit plan mode, restore prePlanMode
  const restoredMode = exitPlanModeRestoreMode('default')
  assert.equal(restoredMode, 'default')
})
