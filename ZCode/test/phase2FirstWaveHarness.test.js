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

test('S01 doctor report uses ZCode branding, not Claude Code', async () => {
  const report = await readNewSessionSurface()

  assert.equal(report.productName, 'ZCode')
  assert.doesNotMatch(report.productName, /Claude Code/)
  assert.doesNotMatch(report.productName, /Claude/)
})

test('S01 doctor report includes version and runtime diagnostics', async () => {
  const report = await readNewSessionSurface()

  assert.ok(typeof report.version === 'string')
  assert.ok(typeof report.runtime === 'object')
  assert.ok(report.runtime.engine === 'bun' || report.runtime.engine === 'node')
  assert.ok(Array.isArray(report.models))
  assert.ok(typeof report.provider === 'object')
  assert.ok(typeof report.provider.mode === 'string')
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

test('S06 plan mode enable with no description does not request a follow-up query', async () => {
  const result = await runPlanSurface({
    args: '',
    appState: createAppState({
      toolPermissionContext: {
        mode: 'default',
      },
    }),
  })

  assert.equal(result.action.type, 'enable')
  assert.equal(result.onDoneCalls[0]?.result, 'Enabled plan mode')
  assert.equal(result.onDoneCalls[0]?.options, undefined)
  assert.equal(result.appState.toolPermissionContext.mode, 'plan')
})

test('S06 plan mode already enabled with no plan written shows informative message', async () => {
  const result = await runPlanSurface({
    args: '',
    appState: createAppState({
      toolPermissionContext: {
        mode: 'plan',
      },
    }),
    planContent: '',
    planPath: 'D:\\workspace\\zcode\\.zcode\\plan.md',
  })

  assert.equal(result.action.type, 'done')
  assert.match(result.onDoneCalls[0]?.result ?? '', /No plan written/)
})

test('S06 plan mode open subcommand invokes editor and reports path', async () => {
  const result = await runPlanSurface({
    args: 'open',
    appState: createAppState({
      toolPermissionContext: {
        mode: 'plan',
      },
    }),
    planContent: '- item',
    planPath: 'D:\\workspace\\zcode\\.zcode\\plan.md',
  })

  assert.equal(result.action.type, 'done')
  assert.match(result.onDoneCalls[0]?.result ?? '', /Opened plan in editor/)
  assert.match(result.onDoneCalls[0]?.result ?? '', /plan\.md/)
})

test('S06 plan mode open subcommand reports error when editor fails', async () => {
  const result = await runPlanSurface({
    args: 'open',
    appState: createAppState({
      toolPermissionContext: {
        mode: 'plan',
      },
    }),
    planContent: '- item',
    planPath: 'D:\\workspace\\zcode\\.zcode\\plan.md',
    openPlanResult: { error: 'No editor available' },
  })

  assert.equal(result.action.type, 'done')
  assert.match(result.onDoneCalls[0]?.result ?? '', /No editor available/)
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

test('S02 resume finds session via direct log fallback when session ID not in logs', async () => {
  const directLog = {
    sessionId: '4bc4d857-8d4f-4f4f-86f3-0d11f11d4d44',
    modified: new Date('2026-05-20T12:00:00.000Z'),
    isLite: false,
  }

  const result = await runResumeSurface({
    arg: directLog.sessionId,
    logs: [{ sessionId: 'unrelated', modified: new Date(), isLite: false }],
    directLog,
  })

  assert.equal(result.action.type, 'resume')
  assert.equal(result.resumeCalls[0]?.sessionId, directLog.sessionId)
  assert.equal(result.resumeCalls[0]?.entrypoint, 'slash_command_session_id')
})

test('S02 --continue with empty arg returns picker type', async () => {
  const result = await runResumeSurface({
    arg: '',
    logs: [{ sessionId: 'abc', modified: new Date(), isLite: false }],
  })

  assert.equal(result.action.type, 'picker')
})

test('S02 resume returns session-not-found error when session ID has no match', async () => {
  const result = await runResumeSurface({
    arg: '4bc4d857-8d4f-4f4f-86f3-0d11f11d4d44',
    logs: [
      { sessionId: 'unrelated-0000-0000-0000-000000000000', modified: new Date(), isLite: false },
    ],
    directLog: null,
  })

  assert.equal(result.action.type, 'error')
  assert.match(result.action.message, /not found/)
})

test('S02 resume matches by custom title when logs are non-empty', async () => {
  const matchedLog = {
    sessionId: 'ef12abcd-3456-7890-abcd-ef1234567890',
    modified: new Date('2026-05-21T10:00:00.000Z'),
    isLite: false,
  }

  const result = await runResumeSurface({
    arg: 'my-project-fix',
    customTitleEnabled: true,
    titleMatches: [matchedLog],
    logs: [{ sessionId: 'unrelated', modified: new Date(), isLite: false }],
  })

  assert.equal(result.action.type, 'resume')
  assert.equal(result.resumeCalls[0]?.sessionId, matchedLog.sessionId)
  assert.equal(result.resumeCalls[0]?.entrypoint, 'slash_command_title')
})

test('S02 resume returns error when custom title yields multiple matches', async () => {
  const result = await runResumeSurface({
    arg: 'common-title',
    customTitleEnabled: true,
    titleMatches: [
      { sessionId: 'aaa', modified: new Date(), isLite: false },
      { sessionId: 'bbb', modified: new Date(), isLite: false },
    ],
    logs: [{ sessionId: 'unrelated', modified: new Date(), isLite: false }],
  })

  assert.equal(result.action.type, 'error')
  assert.match(result.action.message, /Found \d+ sessions matching/)
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
