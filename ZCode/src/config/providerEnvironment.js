import { normalizeSettings } from './settingsContract.js'

const ANTHROPIC_PROVIDER_ENV_FLAGS = Object.freeze({
  bedrock: 'CLAUDE_CODE_USE_BEDROCK',
  vertex: 'CLAUDE_CODE_USE_VERTEX',
  foundry: 'CLAUDE_CODE_USE_FOUNDRY',
})

const OPENAI_COMPATIBLE_ENV_KEYS = Object.freeze([
  'ZCODE_OPENAI_PROVIDER',
  'ZCODE_OPENAI_MODEL',
  'ZCODE_OPENAI_BASE_URL',
  'ZCODE_OPENAI_API_KEY',
  'ZCODE_OPENAI_HEADERS',
  'ZCODE_OPENAI_TIMEOUT',
])

const BRIDGED_PROVIDER_ENV_KEYS = Object.freeze([
  'ZCODE_PROVIDER',
  ...OPENAI_COMPATIBLE_ENV_KEYS,
])

function isTruthy(value) {
  if (!value || typeof value !== 'string') {
    return false
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function clearKeys(env, keys) {
  for (const key of keys) {
    delete env[key]
  }
}

function setOptionalString(env, key, value) {
  if (typeof value === 'string' && value.trim() !== '') {
    env[key] = value.trim()
    return
  }

  delete env[key]
}

function setOptionalJson(env, key, value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  ) {
    env[key] = JSON.stringify(value)
    return
  }

  delete env[key]
}

function setOptionalNumber(env, key, value) {
  if (Number.isFinite(value)) {
    env[key] = String(value)
    return
  }

  delete env[key]
}

export function applyProviderSettingsToEnv(settings = {}, env = process.env) {
  if (isTruthy(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    return env
  }

  const normalizedSettings = normalizeSettings(settings)
  const provider = normalizedSettings.provider

  if (!provider) {
    clearKeys(env, BRIDGED_PROVIDER_ENV_KEYS)
    clearKeys(env, Object.values(ANTHROPIC_PROVIDER_ENV_FLAGS))
    return env
  }

  env.ZCODE_PROVIDER = provider
  clearKeys(env, Object.values(ANTHROPIC_PROVIDER_ENV_FLAGS))

  const legacyFlag = ANTHROPIC_PROVIDER_ENV_FLAGS[provider]
  if (legacyFlag) {
    env[legacyFlag] = '1'
  }

  if (provider !== 'openai-compatible') {
    clearKeys(env, OPENAI_COMPATIBLE_ENV_KEYS)
    return env
  }

  const config = normalizedSettings.openaiCompatible || {}

  setOptionalString(env, 'ZCODE_OPENAI_PROVIDER', config.provider)
  setOptionalString(env, 'ZCODE_OPENAI_MODEL', config.model)
  setOptionalString(env, 'ZCODE_OPENAI_BASE_URL', config.baseUrl)
  setOptionalString(env, 'ZCODE_OPENAI_API_KEY', config.apiKey)
  setOptionalJson(env, 'ZCODE_OPENAI_HEADERS', config.headers)
  setOptionalNumber(env, 'ZCODE_OPENAI_TIMEOUT', config.timeout)

  return env
}
