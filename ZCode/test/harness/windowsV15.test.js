import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { resolveShellPreference, decodeOutput, executeBash } from '../../src/harness/tools/bash.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'
import { collectEnvironmentInfo } from '../../src/cli/envInfo.js'
import { createDoctorReport } from '../../src/cli/publicCliCore.js'
import { createAnthropicProvider } from '../../src/providers/anthropic.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

// ── Shell preference ──

test('shell: defaults to Git Bash, ZCODE_SHELL switches to PowerShell dialects', () => {
  const bash = resolveShellPreference({})
  assert.equal(bash.file, 'bash')
  assert.deepEqual(bash.argsPrefix, ['-c'])

  const ps = resolveShellPreference({ ZCODE_SHELL: 'powershell' })
  assert.equal(ps.file, 'powershell')
  assert.deepEqual(ps.argsPrefix, ['-NoProfile', '-NonInteractive', '-Command'])

  const pwsh = resolveShellPreference({ ZCODE_SHELL: 'pwsh' })
  assert.equal(pwsh.file, 'pwsh')

  // Unknown values fall back to bash.
  const fallback = resolveShellPreference({ ZCODE_SHELL: 'fish' })
  assert.equal(fallback.file, 'bash')
})

test('shell: bash tool description reflects the selected dialect', () => {
  const tools = createCoreTools()
  const bash = tools.find(tool => tool.name === 'Bash')
  assert.match(bash.description, /Git Bash|PowerShell/)
})

test('shell: executeBash runs through the resolved shell end-to-end', async () => {
  const context = { cwd: os.tmpdir(), state: { readFiles: new Set() } }
  // POSIX syntax works on the default (Git Bash / bash) shell everywhere.
  const result = await executeBash({ command: 'echo shell-ok' }, context)
  assert.equal(result.isError, undefined)
  assert.match(result.content, /shell-ok/)
})

// ── Output decoding (GBK fallback) ──

test('decode: clean utf-8 passes through untouched', () => {
  const buffer = Buffer.from('plain ascii 中文', 'utf8')
  assert.equal(decodeOutput(buffer, 'win32'), 'plain ascii 中文')
})

test('decode: replacement-char heuristic prefers the lower-loss decode', () => {
  // Invalid UTF-8 bytes (0x80 alone) become U+FFFD in utf-8.
  const invalid = Buffer.from([0x80, 0x81])
  const utf8 = decodeOutput(invalid, 'linux')
  assert.ok(utf8.includes('\uFFFD'), 'posix keeps utf-8 losses')
  const win = decodeOutput(invalid, 'win32')
  assert.ok(typeof win === 'string')
})

// ── envInfo shell reporting ──

test('envinfo: ZCODE_SHELL is reported as the effective shell on win32', async () => {
  const info = await collectEnvironmentInfo(os.tmpdir(), {
    run: async (command, args) => {
      void args
      if (command === 'git') return { ok: false, stdout: '' }
      if (command === 'pwsh') return { ok: true, stdout: '7.4.1\n' }
      return { ok: false, stdout: '' }
    },
    platform: 'win32',
    os: { type: () => 'Windows_NT', release: () => '10' },
    now: () => new Date(),
    env: { ZCODE_SHELL: 'pwsh' },
  })
  assert.match(info.shell, /PowerShell \(pwsh\) 7\.4\.1 \(ZCODE_SHELL\)/)
})

// ── Doctor report (async) ──

test('doctor: report includes the environment section without leaking secrets', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-doctor-'))
  // Sentinel value that is clearly not a credential; the assertion checks it
  // never leaks into the serialized report.
  const sentinel = 'doctor-sentinel-not-a-real-key'
  const report = await createDoctorReport({
    cwd: workspace,
    env: { ANTHROPIC_API_KEY: sentinel, ZCODE_OPENAI_API_KEY: '' },
    version: 'test',
  })

  assert.equal(report.startable, true)
  const environment = report.environment
  assert.equal(environment.platform, process.platform)
  assert.equal(environment.nodeVersion, process.version)
  assert.equal(['tty', 'pipe'].includes(environment.terminal), true)
  assert.equal(typeof environment.shell, 'string')
  assert.equal(typeof environment.transcriptDirWritable, 'boolean')
  assert.equal(environment.apiKeyConfigured.anthropic, true)
  assert.equal(environment.apiKeyConfigured.openaiCompatible, false)
  assert.ok(!JSON.stringify(report).includes(sentinel), 'secret values never leak')
  assert.ok(typeof environment.projectMemoryFiles === 'number')
})

test('doctor: stale "legacy interactive startup" note is gone', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-doctor-'))
  const report = await createDoctorReport({ cwd: workspace, env: {}, version: 'test' })
  const joined = report.notes.join('\n')
  assert.ok(!joined.includes('Legacy interactive startup is not wired'))
  assert.match(joined, /interactive TUI/)
})

// ── thinking_delta → reasoning_delta (roadmap E3) ──

test('anthropic: thinking_delta events surface as reasoning_delta', async () => {
  // Raw SSE fixture: a content_block_delta with thinking_delta.
  const server = createFakeLlmServer({
    dialect: 'anthropic',
    apiKey: 'test',
    script: [
      {
        rawChunks: [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"fake-model"}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step one"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"final answer"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ],
      },
    ],
  })
  await server.listen()

  try {
    const provider = createAnthropicProvider({
      provider: 'firstParty',
      baseUrl: server.anthropicBaseUrl,
      apiKey: 'test',
    })

    const events = []
    for await (const event of provider.streamChat({ messages: [{ role: 'user', content: 'hi' }] })) {
      events.push(event)
    }
    const reasoning = events.filter(event => event.type === 'reasoning_delta')
    assert.equal(reasoning.length, 1)
    assert.equal(reasoning[0].text, 'step one')
    assert.ok(events.some(event => event.type === 'text_delta' && event.text === 'final answer'))
  } finally {
    await server.close()
  }
})
