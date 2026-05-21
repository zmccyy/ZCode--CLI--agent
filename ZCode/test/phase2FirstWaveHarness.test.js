import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAppState,
  createPermissionRule,
  evaluatePermissionSurface,
  readNewSessionSurface,
  runPlanSurface,
  runResumeSurface,
} from './helpers/phase2Harness.js'

test('S01 public entry surface exposes a startable new-session command set', async () => {
  const report = await readNewSessionSurface()

  assert.equal(report.startable, true)
  assert.deepEqual(report.commands, ['help', 'doctor', 'models', 'print'])
})

test('S06 plan mode enables plan mode and requests a follow-up query when given a description', async () => {
  const result = await runPlanSurface({
    args: 'draft the migration plan',
    appState: createAppState({
      toolPermissionContext: {
        mode: 'default',
      },
    }),
  })

  assert.equal(result.action.type, 'enable')
  assert.equal(result.onDoneCalls[0]?.result, 'Enabled plan mode')
  assert.deepEqual(result.onDoneCalls[0]?.options, {
    shouldQuery: true,
  })
  assert.equal(result.appState.toolPermissionContext.mode, 'plan')
})

test('S06 plan mode shows current plan content when already in plan mode', async () => {
  const result = await runPlanSurface({
    args: '',
    appState: createAppState({
      toolPermissionContext: {
        mode: 'plan',
      },
    }),
    planContent: '- verify the regression harness\n- wire the first-wave tests',
    planPath: 'D:\\workspace\\zcode\\.zcode\\plan.md',
    editorName: 'VS Code',
  })

  assert.equal(result.action.type, 'done')
  assert.match(result.onDoneCalls[0]?.result ?? '', /Current Plan/)
  assert.match(result.onDoneCalls[0]?.result ?? '', /verify the regression harness/)
  assert.match(result.onDoneCalls[0]?.result ?? '', /VS Code/)
})

test('S02 resume returns no conversations found when repo logs are empty', async () => {
  const result = await runResumeSurface({
    arg: '4bc4d857-8d4f-4f4f-86f3-0d11f11d4d44',
    logs: [],
  })

  assert.equal(result.action.type, 'noConversations')
  assert.equal(result.action.message, result.messages.noConversations)
})

test('S02 resume invokes the session-id resume path for a direct match', async () => {
  const log = {
    sessionId: '4bc4d857-8d4f-4f4f-86f3-0d11f11d4d44',
    modified: new Date('2026-05-20T12:00:00.000Z'),
    isLite: false,
  }

  const result = await runResumeSurface({
    arg: log.sessionId,
    logs: [log],
  })

  assert.equal(result.action.type, 'resume')
  assert.equal(result.resumeCalls.length, 1)
  assert.equal(result.resumeCalls[0]?.sessionId, log.sessionId)
  assert.equal(result.resumeCalls[0]?.entrypoint, 'slash_command_session_id')
})

test('S05 shell permission surface asks for Bash when no grant exists', async () => {
  const decision = await evaluatePermissionSurface({
    toolName: 'Bash',
  })

  assert.equal(decision.behavior, 'ask')
  assert.equal(
    decision.message,
    "ZCode requested permission to use Bash, but you haven't granted it yet.",
  )
})

test('S05 shell permission surface asks for PowerShell when no grant exists', async () => {
  const decision = await evaluatePermissionSurface({
    toolName: 'PowerShell',
  })

  assert.equal(decision.behavior, 'ask')
  assert.equal(
    decision.message,
    "ZCode requested permission to use PowerShell, but you haven't granted it yet.",
  )
})

test('S11 permission prompt surface allows via rule', async () => {
  const decision = await evaluatePermissionSurface({
    toolName: 'Bash',
    allowRule: createPermissionRule('Bash', 'allow'),
  })

  assert.equal(decision.behavior, 'allow')
})

test('S11 permission prompt surface denies via rule', async () => {
  const decision = await evaluatePermissionSurface({
    toolName: 'Bash',
    denyRule: createPermissionRule('Bash', 'deny'),
  })

  assert.equal(decision.behavior, 'deny')
  assert.equal(decision.message, 'Permission to use Bash has been denied.')
})
