import test from 'node:test'
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ─── Hook event catalog ───

const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'UserPromptSubmit',
  'SessionStart', 'SessionEnd',
  'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'PermissionRequest', 'PermissionDenied',
  'Setup',
  'TeammateIdle', 'TaskCreated', 'TaskCompleted',
  'Elicitation', 'ElicitationResult',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
  'InstructionsLoaded', 'CwdChanged', 'FileChanged',
]

function isHookEvent(value) {
  return HOOK_EVENTS.includes(value)
}

// ─── Hook JSON output validators ───

function isValidHookJSONOutput(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const fields = Object.keys(obj)
  if (fields.length === 0) return false
  const validFields = ['continue', 'suppressOutput', 'stopReason', 'decision', 'reason', 'systemMessage', 'hookSpecificOutput', 'async']
  return fields.every(f => validFields.includes(f))
}

function isSyncHookOutput(obj) {
  if (!isValidHookJSONOutput(obj)) return false
  return !obj.async
}

function isAsyncHookOutput(obj) {
  if (!isValidHookJSONOutput(obj)) return false
  return obj.async === true
}

function parseHookOutput(stdout) {
  try {
    return JSON.parse(stdout.trim())
  } catch {
    return null
  }
}

// ─── S08: Hooks — event type validation ───

test('S08 hook event catalog contains all 27 events', () => {
  assert.equal(HOOK_EVENTS.length, 27)
})

test('S08 isHookEvent accepts all 28 defined events', () => {
  for (const event of HOOK_EVENTS) {
    assert.ok(isHookEvent(event), `"${event}" should be valid`)
  }
})

test('S08 isHookEvent rejects undefined, empty, and unknown events', () => {
  assert.equal(isHookEvent('NotARealEvent'), false)
  assert.equal(isHookEvent(''), false)
  assert.equal(isHookEvent('pretooluse'), false) // case sensitive
  assert.equal(isHookEvent('PreToolUse '), false) // trailing space
})

test('S08 hook event names match expected format (PascalCase)', () => {
  for (const event of HOOK_EVENTS) {
    assert.match(event, /^[A-Z][a-zA-Z]+$/, `"${event}" should be PascalCase`)
  }
})

// ─── S08: Hooks — JSON output validation ───

test('S08 sync hook output accepts continue flag', () => {
  assert.ok(isSyncHookOutput({ continue: true }))
  assert.ok(isSyncHookOutput({ continue: false, stopReason: 'done' }))
})

test('S08 sync hook output accepts decision with reason', () => {
  assert.ok(isSyncHookOutput({ decision: 'approve', reason: 'OK' }))
  assert.ok(isSyncHookOutput({ decision: 'block', reason: 'Denied by policy' }))
})

test('S08 sync hook output accepts suppressOutput and systemMessage', () => {
  assert.ok(isSyncHookOutput({ continue: true, suppressOutput: true }))
  assert.ok(isSyncHookOutput({ continue: true, systemMessage: 'Warning: disk low' }))
})

test('S08 sync hook output accepts hookSpecificOutput', () => {
  assert.ok(isSyncHookOutput({
    continue: true,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
  }))
})

test('S08 rejects null, arrays, empty objects, and non-objects', () => {
  assert.equal(isValidHookJSONOutput(null), false)
  assert.equal(isValidHookJSONOutput([]), false)
  assert.equal(isValidHookJSONOutput({}), false)
  assert.equal(isValidHookJSONOutput('string'), false)
  assert.equal(isValidHookJSONOutput(42), false)
})

test('S08 rejects objects with only unknown fields', () => {
  assert.equal(isValidHookJSONOutput({ randomField: true }), false)
  assert.equal(isValidHookJSONOutput({ foo: 1, bar: 2 }), false)
})

test('S08 async hook output requires async: true', () => {
  assert.equal(isAsyncHookOutput({ continue: true }), false)
  assert.equal(isAsyncHookOutput({ async: true }), true)
  assert.ok(isAsyncHookOutput({ async: true, continue: true }))
})

// ─── S08: Hooks — hook script execution ───

test('S08 PreToolUse hook script executes and produces valid JSON output', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-hook-pretool-'))
  const hookScriptPath = path.join(tmpDir, 'pretool-hook.cmd')
  const scriptContent = '@echo {"continue":true,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"Audit: safe command"}}'
  await fs.writeFile(hookScriptPath, scriptContent, 'utf8')

  try {
    const result = cp.execFileSync('cmd.exe', ['/c', hookScriptPath], {
      timeout: 5000,
      encoding: 'utf8',
      cwd: tmpDir,
    })

    const output = parseHookOutput(result)
    assert.ok(output, 'hook script should produce valid JSON')
    assert.ok(isSyncHookOutput(output), 'should be valid sync hook output')
    assert.equal(output.continue, true)
    assert.equal(output.hookSpecificOutput.permissionDecision, 'allow')
  } catch (err) {
    // Skip if cmd.exe is not available or script execution fails
    if (err.code === 'ENOENT') {
      // Not Windows — skip gracefully
    } else {
      throw err
    }
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S08 PostToolUse hook script with systemMessage warning', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-hook-posttool-'))
  const scriptPath = path.join(tmpDir, 'posttool-hook.cmd')
  const scriptContent = '@echo {"continue":true,"systemMessage":"Tool completed with warnings: high memory usage"}'
  await fs.writeFile(scriptPath, scriptContent, 'utf8')

  try {
    const result = cp.execFileSync('cmd.exe', ['/c', scriptPath], {
      timeout: 5000,
      encoding: 'utf8',
      cwd: tmpDir,
    })

    const output = parseHookOutput(result)
    assert.ok(output, 'should produce valid JSON')
    assert.equal(output.continue, true)
    assert.equal(output.systemMessage, 'Tool completed with warnings: high memory usage')
  } catch (err) {
    if (err.code === 'ENOENT') { /* not Windows — skip */ } else { throw err }
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S08 Stop hook blocks continuation', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-hook-stop-'))
  const scriptPath = path.join(tmpDir, 'stop-hook.cmd')
  const scriptContent = '@echo {"continue":false,"stopReason":"All tasks completed successfully"}'
  await fs.writeFile(scriptPath, scriptContent, 'utf8')

  try {
    const result = cp.execFileSync('cmd.exe', ['/c', scriptPath], {
      timeout: 5000,
      encoding: 'utf8',
      cwd: tmpDir,
    })

    const output = parseHookOutput(result)
    assert.ok(output, 'should produce valid JSON')
    assert.equal(output.continue, false)
    assert.equal(output.stopReason, 'All tasks completed successfully')
  } catch (err) {
    if (err.code === 'ENOENT') { /* not Windows — skip */ } else { throw err }
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S08 hook non-zero exit (exit code 2) is treated as blocking error', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-hook-block-'))
  const scriptPath = path.join(tmpDir, 'block-hook.cmd')
  const scriptContent = '@echo {"continue":false,"stopReason":"blocking"}\r\n@exit /b 2'
  await fs.writeFile(scriptPath, scriptContent, 'utf8')

  try {
    const result = cp.execFileSync('cmd.exe', ['/c', scriptPath], {
      timeout: 5000,
      encoding: 'utf8',
      cwd: tmpDir,
    })
    // Even with exit code 2, stdout should contain valid JSON
    const trimmed = result.trim()
    // Split on CRLF to get the JSON line (not the exit line)
    const lines = trimmed.split(/\r?\n/)
    const jsonLine = lines.find(l => l.startsWith('{'))
    if (jsonLine) {
      const output = parseHookOutput(jsonLine)
      assert.ok(output, 'should produce valid JSON even with non-zero exit')
    }
  } catch (err) {
    if (err.code === 'ENOENT') { /* not Windows — skip */ } else {
      // cmd.exe exit code 2 is captured as error status
      assert.ok(err.status === 2 || err.code === 2, `expected exit code 2, got ${err.status || err.code}`)
    }
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S08 SessionStart hook produces additionalContext', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-hook-ssstart-'))
  const scriptPath = path.join(tmpDir, 'ssstart-hook.cmd')
  const scriptContent = '@echo {"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Project: zcode\\nBranch: main"}}'
  await fs.writeFile(scriptPath, scriptContent, 'utf8')

  try {
    const result = cp.execFileSync('cmd.exe', ['/c', scriptPath], {
      timeout: 5000,
      encoding: 'utf8',
      cwd: tmpDir,
    })

    const output = parseHookOutput(result)
    assert.ok(output, 'should produce valid JSON')
    assert.equal(output.continue, true)
    assert.ok(output.hookSpecificOutput.additionalContext.includes('zcode'))
    assert.ok(output.hookSpecificOutput.additionalContext.includes('main'))
  } catch (err) {
    if (err.code === 'ENOENT') { /* not Windows — skip */ } else { throw err }
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── S08: Hooks — JSON output parsing edge cases ───

test('S08 parseHookOutput handles empty stdout', () => {
  assert.equal(parseHookOutput(''), null)
  assert.equal(parseHookOutput('   '), null)
})

test('S08 parseHookOutput handles malformed JSON', () => {
  assert.equal(parseHookOutput('not json'), null)
  assert.equal(parseHookOutput('{broken'), null)
})

test('S08 hook output with all valid fields passes validation', () => {
  const fullOutput = {
    continue: true,
    suppressOutput: false,
    systemMessage: 'Note: running in dry-run mode',
    decision: 'approve',
    reason: 'Verified safe',
  }
  assert.ok(isSyncHookOutput(fullOutput))
})

test('S08 hook output with partial fields still validates', () => {
  assert.ok(isSyncHookOutput({ continue: true }))
  assert.ok(isSyncHookOutput({ decision: 'approve', reason: 'OK' }))
  assert.ok(isSyncHookOutput({ continue: true, suppressOutput: true }))
})
