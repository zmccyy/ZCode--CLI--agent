import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'config',
  'providerEnvironment.js',
)

test('applyProviderSettingsToEnv maps unified openai-compatible settings into env', async () => {
  const { applyProviderSettingsToEnv } = await loadModule(modulePath)

  const env = {
    CLAUDE_CODE_USE_BEDROCK: '1',
  }

  applyProviderSettingsToEnv(
    {
      provider: 'openai-compatible',
      openaiCompatible: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1///',
        apiKey: 'test-key',
        headers: {
          'X-Test': '1',
        },
        timeout: 120000,
      },
    },
    env,
  )

  assert.deepEqual(env, {
    ZCODE_PROVIDER: 'openai-compatible',
    ZCODE_OPENAI_PROVIDER: 'deepseek',
    ZCODE_OPENAI_MODEL: 'deepseek-chat',
    ZCODE_OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
    ZCODE_OPENAI_API_KEY: 'test-key',
    ZCODE_OPENAI_HEADERS: '{"X-Test":"1"}',
    ZCODE_OPENAI_TIMEOUT: '120000',
  })
})

test('applyProviderSettingsToEnv maps anthropic provider selections into legacy env flags', async () => {
  const { applyProviderSettingsToEnv } = await loadModule(modulePath)

  const env = {
    ZCODE_PROVIDER: 'openai-compatible',
    ZCODE_OPENAI_PROVIDER: 'deepseek',
    ZCODE_OPENAI_MODEL: 'deepseek-chat',
    ZCODE_OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
    ZCODE_OPENAI_API_KEY: 'test-key',
    ZCODE_OPENAI_HEADERS: '{"X-Test":"1"}',
    ZCODE_OPENAI_TIMEOUT: '120000',
  }

  applyProviderSettingsToEnv(
    {
      provider: 'vertex',
    },
    env,
  )

  assert.deepEqual(env, {
    ZCODE_PROVIDER: 'vertex',
    CLAUDE_CODE_USE_VERTEX: '1',
  })
})

test('applyProviderSettingsToEnv respects host-managed provider routing', async () => {
  const { applyProviderSettingsToEnv } = await loadModule(modulePath)

  const env = {
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_USE_BEDROCK: '1',
  }

  applyProviderSettingsToEnv(
    {
      provider: 'openai-compatible',
      openaiCompatible: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
      },
    },
    env,
  )

  assert.deepEqual(env, {
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_USE_BEDROCK: '1',
  })
})
