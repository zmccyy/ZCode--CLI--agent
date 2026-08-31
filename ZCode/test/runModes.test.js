/**
 * runMode — 三级运行模式测试
 *
 * 覆盖:
 * - resolveRunMode() flag 解析与互斥
 * - runModeToPermissionMode() 映射
 * - isValidRunMode() 校验
 * - CLI argv 解析中 --plan / --yolo 行为
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'

// Load under the same ESM resolution the public CLI entrypoint uses.
// NOTE: this file exercises the public (Node.js) surface of runMode.js
// and of the publicCliCore argv parser via --plan / --yolo flags.
import { runCli } from '../src/cli/publicCliCore.js'
import {
  resolveRunMode,
  runModeToPermissionMode,
  isValidRunMode,
  RUN_MODES,
  RUN_MODE_LABELS,
  RUN_MODE_DESCRIPTIONS,
} from '../src/utils/permissions/runMode.js'

// ---------------------------------------------------------------------------
// resolveRunMode
// ---------------------------------------------------------------------------
describe('resolveRunMode', () => {
  it('默认是 Agent 模式', () => {
    assert.deepStrictEqual(resolveRunMode({}), {
      runMode: 'agent',
    })
    assert.deepStrictEqual(resolveRunMode(), {
      runMode: 'agent',
    })
  })

  it('--plan 返回 plan 模式', () => {
    assert.deepStrictEqual(resolveRunMode({ plan: true }), {
      runMode: 'plan',
    })
  })

  it('--yolo 返回 yolo 模式', () => {
    assert.deepStrictEqual(resolveRunMode({ yolo: true }), {
      runMode: 'yolo',
    })
  })

  it('互斥: --plan + --yolo 同时传入返回 agent 并给出 error', () => {
    const result = resolveRunMode({ plan: true, yolo: true })
    assert.strictEqual(result.runMode, 'agent')
    assert.ok(result.error)
    assert.ok(result.error.includes('mutually exclusive'))
  })

  it('明确传入 false 不影响默认', () => {
    assert.deepStrictEqual(resolveRunMode({ plan: false, yolo: false }), {
      runMode: 'agent',
    })
  })
})

// ---------------------------------------------------------------------------
// runModeToPermissionMode
// ---------------------------------------------------------------------------
describe('runModeToPermissionMode', () => {
  it('plan → plan', () => {
    assert.strictEqual(runModeToPermissionMode('plan'), 'plan')
  })

  it('agent → default', () => {
    assert.strictEqual(runModeToPermissionMode('agent'), 'default')
  })

  it('yolo → acceptEdits (外部用户)', () => {
    const saved = process.env.USER_TYPE
    delete process.env.USER_TYPE
    try {
      assert.strictEqual(runModeToPermissionMode('yolo'), 'acceptEdits')
    } finally {
      if (saved !== undefined) process.env.USER_TYPE = saved
    }
  })

  it('yolo → auto (ant 用户)', () => {
    const saved = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    try {
      assert.strictEqual(runModeToPermissionMode('yolo'), 'auto')
    } finally {
      if (saved !== undefined) {
        process.env.USER_TYPE = saved
      } else {
        delete process.env.USER_TYPE
      }
    }
  })

  it('未知模式回退到 default', () => {
    assert.strictEqual(runModeToPermissionMode('unknown'), 'default')
  })
})

// ---------------------------------------------------------------------------
// isValidRunMode
// ---------------------------------------------------------------------------
describe('isValidRunMode', () => {
  for (const mode of RUN_MODES) {
    it(`${mode} 为合法值`, () => {
      assert.ok(isValidRunMode(mode))
    })
  }

  it('非法值返回 false', () => {
    assert.strictEqual(isValidRunMode('invalid'), false)
    assert.strictEqual(isValidRunMode(''), false)
    assert.strictEqual(isValidRunMode('PLAN'), false)
  })
})

// ---------------------------------------------------------------------------
// 常量完整性
// ---------------------------------------------------------------------------
describe('常量', () => {
  it('RUN_MODES 包含三个模式', () => {
    assert.deepStrictEqual([...RUN_MODES], ['plan', 'agent', 'yolo'])
  })

  it('每个模式都有 LABEL 和 DESCRIPTION', () => {
    for (const mode of RUN_MODES) {
      assert.ok(typeof RUN_MODE_LABELS[mode] === 'string', `${mode} 缺少 label`)
      assert.ok(
        typeof RUN_MODE_DESCRIPTIONS[mode] === 'string',
        `${mode} 缺少 description`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// CLI integration — argv 解析
// ---------------------------------------------------------------------------
describe('publicCliCore --plan / --yolo', () => {
  function captureOutput(...args) {
    const chunks = []
    const errChunks = []
    const fakeOut = { write: c => void chunks.push(c) }
    const fakeErr = { write: c => void errChunks.push(c) }
    return { stdout: fakeOut, stderr: fakeErr, get: () => chunks.join(''), getErr: () => errChunks.join('') }
  }

  it('--plan 在 help 中列出', async () => {
    const { stdout: out, get } = captureOutput()
    await runCli(['--help'], {
      stdout: out,
      stderr: out,
      version: '0.0.0',
    })
    const text = get()
    assert.ok(text.includes('--plan'))
    assert.ok(text.includes('Plan mode'))
    assert.ok(text.includes('--yolo'))
    assert.ok(text.includes('YOLO mode'))
  })

  it('--plan + -p 输出 Plan MODE 头部（真实只读循环，无 provider 时如实报错退出）', async () => {
    const { stdout: out, get } = captureOutput()
    const transcriptDir = mkdtempSync(path.join(os.tmpdir(), 'zcode-runmodes-'))
    const exitCode = await runCli(['-p', 'hello', '--plan'], {
      stdout: out,
      stderr: out,
      env: { ZCODE_TRANSCRIPT_DIR: transcriptDir },
      version: '0.0.0',
    })
    rmSync(transcriptDir, { recursive: true, force: true })
    const text = get()
    assert.ok(text.includes('Plan MODE'))
    // The old plan-mode stub is gone: the loop actually runs, and without a
    // configured provider it reports an error stop — honest non-zero exit.
    assert.equal(exitCode, 1)
  })

  it('--plan + --yolo 同时传入输出 WARNING', async () => {
    const { stdout: out, stderr: err, get, getErr } = captureOutput()
    const transcriptDir = mkdtempSync(path.join(os.tmpdir(), 'zcode-runmodes-'))
    await runCli(['-p', 'hello', '--plan', '--yolo'], {
      stdout: out,
      stderr: err,
      env: { ZCODE_TRANSCRIPT_DIR: transcriptDir },
      version: '0.0.0',
    })
    rmSync(transcriptDir, { recursive: true, force: true })
    const errText = getErr()
    assert.ok(errText.includes('WARNING'))
    assert.ok(errText.includes('mutually exclusive'))
  })
})
