import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'runtime.js',
)

test('runtime bridge can derive legacy anthropic provider from env mode', async () => {
  const { getLegacyAnthropicProviderModeFromEnv } = await loadModule(modulePath)

  assert.equal(getLegacyAnthropicProviderModeFromEnv({}), 'firstParty')
  assert.equal(
    getLegacyAnthropicProviderModeFromEnv({
      CLAUDE_CODE_USE_BEDROCK: '1',
    }),
    'bedrock',
  )
  assert.equal(
    getLegacyAnthropicProviderModeFromEnv({
      ZCODE_PROVIDER: 'openai-compatible',
    }),
    'firstParty',
  )
})

test('runtime bridge can derive legacy anthropic provider from settings mode', async () => {
  const { getLegacyAnthropicProviderModeFromSettings } =
    await loadModule(modulePath)

  assert.equal(getLegacyAnthropicProviderModeFromSettings({}), 'firstParty')
  assert.equal(
    getLegacyAnthropicProviderModeFromSettings({
      provider: 'vertex',
    }),
    'vertex',
  )
  assert.equal(
    getLegacyAnthropicProviderModeFromSettings({
      provider: 'openai-compatible',
    }),
    'firstParty',
  )
})

test('runtime bridge distinguishes anthropic-compatible provider families', async () => {
  const { isAnthropicProviderMode } = await loadModule(modulePath)

  assert.equal(isAnthropicProviderMode('firstParty'), true)
  assert.equal(isAnthropicProviderMode('bedrock'), true)
  assert.equal(isAnthropicProviderMode('vertex'), true)
  assert.equal(isAnthropicProviderMode('foundry'), true)
  assert.equal(isAnthropicProviderMode('openai-compatible'), false)
  assert.equal(isAnthropicProviderMode('deepseek'), false)
  assert.equal(isAnthropicProviderMode(null), false)
})
