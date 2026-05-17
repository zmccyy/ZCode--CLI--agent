import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'config',
  'settingsContract.js',
)

test('SETTINGS_SOURCE_PRIORITY reflects documented override order', async () => {
  const { SETTINGS_SOURCE_PRIORITY, getSettingsSourcePriority } =
    await loadModule(modulePath)

  assert.deepEqual(SETTINGS_SOURCE_PRIORITY, [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ])
  assert.equal(getSettingsSourcePriority('userSettings'), 0)
  assert.equal(getSettingsSourcePriority('policySettings'), 4)
})

test('mergeSettingsLayers applies later sources on top of earlier sources', async () => {
  const { mergeSettingsLayers } = await loadModule(modulePath)

  const merged = mergeSettingsLayers([
    {
      source: 'projectSettings',
      settings: {
        model: 'claude-sonnet-4',
        env: { FOO: 'project' },
        hooks: ['project'],
      },
    },
    {
      source: 'userSettings',
      settings: {
        env: { BAR: 'user' },
        hooks: ['user'],
      },
    },
    {
      source: 'policySettings',
      settings: {
        model: 'claude-opus-4-1',
        env: { FOO: 'policy' },
        hooks: ['policy'],
      },
    },
  ])

  assert.deepEqual(merged, {
    model: 'claude-opus-4-1',
    env: {
      BAR: 'user',
      FOO: 'policy',
    },
    hooks: ['user', 'project', 'policy'],
  })
})

test('normalizeSettings sanitizes provider-facing settings', async () => {
  const { normalizeSettings } = await loadModule(modulePath)

  const normalized = normalizeSettings({
    provider: ' openai-compatible ',
    openaiCompatible: {
      provider: ' deepseek ',
      model: ' deepseek-chat ',
      baseUrl: 'https://api.deepseek.com/v1///',
      apiKey: ' test-key ',
      headers: {
        'X-Test': '1',
        Empty: '   ',
      },
      timeout: 120000,
    },
    modelOverrides: {
      'claude-sonnet-4-6': ' custom-sonnet ',
      'claude-opus-4-6': '',
    },
    availableModels: [' sonnet ', '', 'opus', 'sonnet'],
  })

  assert.deepEqual(normalized, {
    provider: 'openai-compatible',
    openaiCompatible: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key',
      headers: {
        'X-Test': '1',
      },
      timeout: 120000,
    },
    modelOverrides: {
      'claude-sonnet-4-6': 'custom-sonnet',
    },
    availableModels: ['sonnet', 'opus'],
  })
})
