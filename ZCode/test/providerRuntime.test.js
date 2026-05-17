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

test('resolveProviderMode defaults to first-party Anthropic', async () => {
  const { resolveProviderMode, createProviderFromEnv, createModelRegistryFromEnv } =
    await loadModule(modulePath)

  assert.equal(resolveProviderMode({}), 'firstParty')

  const provider = createProviderFromEnv({})
  const registry = createModelRegistryFromEnv({})

  assert.equal(provider.id, 'anthropic:firstParty')
  assert.equal(registry.has('claude-sonnet-4-6'), true)
})

test('resolveProviderMode preserves existing Anthropic provider env selection', async () => {
  const { resolveProviderMode, createProviderFromEnv } =
    await loadModule(modulePath)

  const env = {
    CLAUDE_CODE_USE_BEDROCK: '1',
  }

  assert.equal(resolveProviderMode(env), 'bedrock')
  assert.equal(createProviderFromEnv(env).id, 'anthropic:bedrock')
})

test('createProviderFromEnv can build an OpenAI-compatible provider from ZCode env', async () => {
  const { resolveProviderMode, createProviderFromEnv, createModelRegistryFromEnv } =
    await loadModule(modulePath)

  const env = {
    ZCODE_PROVIDER: 'openai-compatible',
    ZCODE_OPENAI_PROVIDER: 'deepseek',
    ZCODE_OPENAI_MODEL: 'deepseek-chat',
    ZCODE_OPENAI_BASE_URL: 'https://api.deepseek.com/v1///',
    ZCODE_OPENAI_API_KEY: 'test-key',
    ZCODE_OPENAI_HEADERS: '{"X-Test":"1"}',
  }

  assert.equal(resolveProviderMode(env), 'openai-compatible')

  const provider = createProviderFromEnv(env)
  const registry = createModelRegistryFromEnv(env)

  assert.equal(provider.id, 'openai-compatible:deepseek')
  assert.equal(provider.config.baseUrl, 'https://api.deepseek.com/v1')
  assert.deepEqual(provider.config.headers, { 'X-Test': '1' })
  assert.equal(registry.has('deepseek-chat'), true)
})

test('createProviderFromSettings prefers normalized settings over env', async () => {
  const {
    createProviderFromSettings,
    createModelRegistryFromSettings,
    resolveProviderModeFromSettings,
  } = await loadModule(modulePath)

  const settings = {
    provider: 'openai-compatible',
    openaiCompatible: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1///',
      apiKey: 'test-key',
      headers: {
        'X-Test': '1',
      },
    },
  }

  const env = {
    CLAUDE_CODE_USE_BEDROCK: '1',
  }

  assert.equal(resolveProviderModeFromSettings(settings, env), 'openai-compatible')

  const provider = createProviderFromSettings(settings, env)
  const registry = createModelRegistryFromSettings(settings, env)

  assert.equal(provider.id, 'openai-compatible:deepseek')
  assert.equal(provider.config.baseUrl, 'https://api.deepseek.com/v1')
  assert.deepEqual(provider.config.headers, { 'X-Test': '1' })
  assert.equal(registry.has('deepseek-chat'), true)
})
