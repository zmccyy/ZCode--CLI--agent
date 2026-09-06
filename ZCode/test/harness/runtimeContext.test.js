// Tests for the CLI runtime context: one frozen object that derives every
// terminal-capability decision from the EFFECTIVE env (settings/.env merged
// by runCli) instead of each module independently reading process.env.

import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'

import { createCliRuntime } from '../../src/cli/runtimeContext.js'

function ttyStream() {
  const stream = new PassThrough()
  stream.isTTY = true
  return stream
}

function plainStream() {
  return new Writable({ write(_chunk, _enc, cb) { cb() } })
}

test('runtime: color honors the effective env on a TTY', () => {
  const tty = ttyStream()
  assert.equal(createCliRuntime({ env: {}, stdout: tty }).colorEnabled, true)
  assert.equal(createCliRuntime({ env: { NO_COLOR: '1' }, stdout: tty }).colorEnabled, false)
  assert.equal(createCliRuntime({ env: { NO_COLOR: '' }, stdout: tty }).colorEnabled, true)
  // Not a TTY → no color regardless of env.
  assert.equal(createCliRuntime({ env: {}, stdout: plainStream() }).colorEnabled, false)
})

test('runtime: unicode flag follows terminal capability markers', () => {
  assert.equal(createCliRuntime({ env: { WT_SESSION: 'x' } }).unicode, true)
  assert.equal(createCliRuntime({ env: { ConEmuANSI: 'ON' } }).unicode, true)
  assert.equal(createCliRuntime({ env: { TERM: 'xterm' } }).unicode, true)
  assert.equal(
    createCliRuntime({ env: {} }).unicode,
    process.platform !== 'win32',
    'bare win32 env = legacy conhost → ASCII',
  )
})

test('runtime: spinner frame choice is driven by WT_SESSION in the effective env', () => {
  assert.equal(createCliRuntime({ env: { WT_SESSION: 'x' } }).spinnerFramesUnicode, true)
  assert.equal(createCliRuntime({ env: {} }).spinnerFramesUnicode, false)
})

test('runtime: object is frozen and defaults are stable', () => {
  const runtime = createCliRuntime({})
  assert.ok(Object.isFrozen(runtime))
  assert.equal(typeof runtime.cwd, 'string')
  assert.equal(typeof runtime.styler.dim, 'function')
  // Styler degradation passthrough.
  assert.equal(runtime.styler.red('x'), 'x')
})
