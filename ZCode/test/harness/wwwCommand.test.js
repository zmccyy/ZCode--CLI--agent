/* eslint-disable no-console -- wwwMain writes via console; the tests stub it to capture output */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runCli } from '../../src/cli/publicCliCore.js'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function createCollector() {
  const chunks = []
  return {
    stream: {
      write(chunk) {
        chunks.push(String(chunk))
      },
    },
    text: () => chunks.join(''),
  }
}

function baseOptions(cwd, out, err) {
  return {
    cwd,
    env: {},
    stdout: out.stream,
    stderr: err.stream,
    stdin: null,
    version: 'test',
  }
}

test('www: parses its own flags as pass-through args', async () => {
  // parseArgv is not exported; verify via runCli's --help path behavior.
  // Direct behavior check: `zcode www --help` must print the www usage and
  // exit 0 without starting a server.
  const workspace = await createTempDir('zcode-www-help-')
  const out = createCollector()
  const err = createCollector()

  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args.join(' '))
  try {
    const exitCode = await runCli(['www', '--help'], baseOptions(workspace, out, err))
    assert.equal(exitCode, 0)
  } finally {
    console.log = originalLog
  }
  assert.match(logs.join('\n'), /Promotional Website Server/)
  assert.match(logs.join('\n'), /--port/)
})

test('www: unknown flags after www are not rejected by the global parser', async () => {
  // `--port` is not a global flag; if the pass-through regressed, parseArgv
  // would throw UsageError (exit code 2) before reaching wwwMain.
  const workspace = await createTempDir('zcode-www-flags-')
  const out = createCollector()
  const err = createCollector()

  const logs = []
  const originalLog = console.log
  console.log = (...args) => logs.push(args.join(' '))
  try {
    // --help short-circuits wwwMain into its usage branch (no server start).
    const exitCode = await runCli(['www', '--port', '4173', '--help'], baseOptions(workspace, out, err))
    assert.equal(exitCode, 0)
  } finally {
    console.log = originalLog
  }
  assert.match(logs.join('\n'), /Promotional Website Server/)
})

test('www: help output lists the www command', async () => {
  const workspace = await createTempDir('zcode-www-doc-')
  const out = createCollector()
  const err = createCollector()

  const exitCode = await runCli(['--help'], baseOptions(workspace, out, err))
  assert.equal(exitCode, 0)
  assert.match(out.text(), /www \[options\]/)
  assert.match(out.text(), /promo site/)
})
