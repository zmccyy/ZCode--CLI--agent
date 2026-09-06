import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runCli, summarizeSettingsForDoctor } from '../../src/cli/publicCliCore.js'
import { loadSettingsFromDisk } from '../../src/config/settingsContract.js'

// Fake credential value for settings files; never a real secret (same
// convention as tui.test.js).
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || 'test'

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeSettings(dir, fileName, settings) {
  const settingsDir = path.join(dir, '.zcode')
  await fs.mkdir(settingsDir, { recursive: true })
  await fs.writeFile(path.join(settingsDir, fileName), JSON.stringify(settings), 'utf8')
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

function createFakePrintProvider() {
  const seen = { env: null, models: [] }
  return {
    seen,
    provider: {
      id: 'fake:openai-compatible',
      kind: 'openai-compatible',
      isPrintCapable: true,
      listModels: () => [{ id: 'fake-model' }],
      streamChat: async function* (input) {
        seen.models.push(input.model)
        yield { type: 'response_start', messageId: 'm1', model: input.model ?? 'fake-model', provider: 'fake' }
        yield { type: 'text_delta', text: 'done' }
        yield {
          type: 'response_end',
          finishReason: 'stop',
          usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
        }
      },
    },
  }
}

test('settings: runCli applies project settings.env as defaults without overriding env', async () => {
  const workspace = await createTempDir('zcode-settings-env-')
  await writeSettings(workspace, 'settings.json', {
    env: { ZCODE_TEST_FROM_SETTINGS: 'from-settings' },
  })
  const injected = createFakePrintProvider()

  const exitCode = await runCli(
    ['-p', 'hi', '--json', '--yolo'],
    {
      cwd: workspace,
      env: { ZCODE_TEST_FROM_SETTINGS: 'from-real-env' },
      stdout: createCollector().stream,
      stderr: createCollector().stream,
      stdin: null,
      version: 'test',
      createProviderFromEnv: env => {
        injected.seen.env = { ...env }
        return injected.provider
      },
      createModelRegistryFromEnv: () => ({ list: () => [] }),
    },
  )

  assert.equal(exitCode, 0)
  assert.equal(injected.seen.env.ZCODE_TEST_FROM_SETTINGS, 'from-real-env', 'real env wins')
})

test('settings: provider section reaches the provider factory env', async () => {
  const workspace = await createTempDir('zcode-settings-provider-')
  await writeSettings(workspace, 'settings.json', {
    provider: 'openai-compatible',
    openaiCompatible: {
      baseUrl: 'https://settings.example.com/v1',
      model: 'settings-model',
      apiKey: FAKE_API_KEY,
    },
  })
  const injected = createFakePrintProvider()

  await runCli(
    ['-p', 'hi', '--json', '--yolo'],
    {
      cwd: workspace,
      env: {},
      stdout: createCollector().stream,
      stderr: createCollector().stream,
      stdin: null,
      version: 'test',
      createProviderFromEnv: env => {
        injected.seen.env = { ...env }
        return injected.provider
      },
      createModelRegistryFromEnv: () => ({ list: () => [] }),
    },
  )

  assert.equal(injected.seen.env.ZCODE_PROVIDER, 'openai-compatible')
  assert.equal(injected.seen.env.ZCODE_OPENAI_BASE_URL, 'https://settings.example.com/v1')
  assert.equal(injected.seen.env.ZCODE_OPENAI_MODEL, 'settings-model')
})

test('settings: settings.model is the default, -m flag wins', async () => {
  const workspace = await createTempDir('zcode-settings-model-')
  await writeSettings(workspace, 'settings.json', { model: 'settings-model' })
  const injected = createFakePrintProvider()
  const run = argv =>
    runCli([...argv, '-p', 'hi', '--json', '--yolo'], {
      cwd: workspace,
      env: {},
      stdout: createCollector().stream,
      stderr: createCollector().stream,
      stdin: null,
      version: 'test',
      createProviderFromEnv: () => injected.provider,
      createModelRegistryFromEnv: () => ({ list: () => [] }),
    })

  await run([])
  assert.equal(injected.seen.models[0], 'settings-model', 'settings.model default applied')

  await run(['-m', 'flag-model'])
  assert.equal(injected.seen.models[1], 'flag-model', 'CLI flag overrides settings')
})

test('settings: local settings override project settings', async () => {
  const workspace = await createTempDir('zcode-settings-local-')
  await writeSettings(workspace, 'settings.json', { model: 'project-model' })
  await writeSettings(workspace, 'settings.local.json', { model: 'local-model' })
  const injected = createFakePrintProvider()

  await runCli(['-p', 'hi', '--json', '--yolo'], {
    cwd: workspace,
    env: {},
    stdout: createCollector().stream,
    stderr: createCollector().stream,
    stdin: null,
    version: 'test',
    createProviderFromEnv: () => injected.provider,
    createModelRegistryFromEnv: () => ({ list: () => [] }),
  })

  assert.equal(injected.seen.models[0], 'local-model')
})

test('settings: invalid settings file warns on stderr but never blocks', async () => {
  const workspace = await createTempDir('zcode-settings-bad-')
  const settingsDir = path.join(workspace, '.zcode')
  await fs.mkdir(settingsDir, { recursive: true })
  await fs.writeFile(path.join(settingsDir, 'settings.json'), '{not json', 'utf8')

  const out = createCollector()
  const err = createCollector()
  const injected = createFakePrintProvider()

  const exitCode = await runCli(['-p', 'hi', '--json', '--yolo'], {
    cwd: workspace,
    env: {},
    stdout: out.stream,
    stderr: err.stream,
    stdin: null,
    version: 'test',
    createProviderFromEnv: () => injected.provider,
    createModelRegistryFromEnv: () => ({ list: () => [] }),
  })

  assert.equal(exitCode, 0, 'run continues')
  assert.match(err.text(), /WARNING: settings:/)
})

test('settings: doctor summary masks api keys', () => {
  const summary = summarizeSettingsForDoctor({
    provider: 'openai-compatible',
    model: 'm1',
    openaiCompatible: { baseUrl: 'https://x.example.com', apiKey: FAKE_API_KEY },
  })
  assert.deepEqual(summary.keys.sort(), ['model', 'openaiCompatible', 'provider'])
  assert.equal(summary.openaiCompatibleBaseUrl, 'https://x.example.com')
  assert.equal(summary.openaiCompatibleApiKeyConfigured, true)
  assert.ok(!JSON.stringify(summary).includes(FAKE_API_KEY), 'apiKey value never appears')
  assert.equal(summarizeSettingsForDoctor(null), null)
})

test('settings: loadSettingsFromDisk returns empty settings for a bare workspace', async () => {
  const workspace = await createTempDir('zcode-settings-none-')
  const { settings, errors } = loadSettingsFromDisk({ cwd: workspace })
  assert.deepEqual(settings, {})
  assert.deepEqual(errors, [])
})
