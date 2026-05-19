import { createAnthropicProvider } from './anthropic.js'
import { createModelRegistry, createProviderModelRegistry } from './modelRegistry.js'
import { createOpenAICompatibleProvider } from './openaiCompatible.js'
import { normalizeSettings } from '../config/settingsContract.js'

const MODEL_FAMILY_ALIASES = new Set(['sonnet', 'opus', 'haiku'])
const ANTHROPIC_PROVIDER_MODES = new Set([
  'firstParty',
  'bedrock',
  'vertex',
  'foundry',
])

function isTruthy(value) {
  if (!value || typeof value !== 'string') {
    return false
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function readString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function readJsonObject(value) {
  const raw = readString(value)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}

function readOpenAICompatibleConfigFromEnv(env = process.env) {
  return {
    provider: readString(env.ZCODE_OPENAI_PROVIDER) || 'openai-compatible',
    model: readString(env.ZCODE_OPENAI_MODEL) || undefined,
    baseUrl: readString(env.ZCODE_OPENAI_BASE_URL) || undefined,
    apiKey: readString(env.ZCODE_OPENAI_API_KEY) || undefined,
    headers: readJsonObject(env.ZCODE_OPENAI_HEADERS),
  }
}

export function isAnthropicProviderMode(mode) {
  return typeof mode === 'string' && ANTHROPIC_PROVIDER_MODES.has(mode)
}

function prefixMatchesModel(modelName, prefix) {
  if (!modelName.startsWith(prefix)) {
    return false
  }

  return modelName.length === prefix.length || modelName[prefix.length] === '-'
}

function matchesAvailableModelEntry(values, entry) {
  if (values.includes(entry)) {
    return true
  }

  if (MODEL_FAMILY_ALIASES.has(entry)) {
    return values.some(
      value => value.includes(`claude-${entry}`) || value.includes(entry),
    )
  }

  return values.some(value => {
    if (prefixMatchesModel(value, entry)) {
      return true
    }

    if (!entry.startsWith('claude-')) {
      return prefixMatchesModel(value, `claude-${entry}`)
    }

    return false
  })
}

function applySettingsToProviderModels(provider, normalizedSettings) {
  const descriptors =
    typeof provider?.listModels === 'function' ? provider.listModels() : []
  const modelOverrides = normalizedSettings.modelOverrides || {}
  const availableModels = normalizedSettings.availableModels?.map(model =>
    model.toLowerCase(),
  )

  const remapped = descriptors.map(descriptor => {
    const canonicalId =
      typeof descriptor.displayName === 'string' &&
      descriptor.displayName.trim() !== ''
        ? descriptor.displayName.trim()
        : descriptor.id

    const overriddenId = modelOverrides[canonicalId]

    return overriddenId
      ? {
          ...descriptor,
          id: overriddenId,
        }
      : descriptor
  })

  if (!availableModels?.length) {
    return remapped
  }

  return remapped.filter(descriptor => {
    const values = [
      descriptor.id,
      descriptor.displayName,
      descriptor.provider,
    ]
      .filter(value => typeof value === 'string' && value.trim() !== '')
      .map(value => value.trim().toLowerCase())

    return availableModels.some(entry => matchesAvailableModelEntry(values, entry))
  })
}

export function resolveProviderMode(env = process.env) {
  const explicit = readString(env.ZCODE_PROVIDER)
  if (explicit) {
    return explicit
  }

  if (isTruthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    return 'bedrock'
  }

  if (isTruthy(env.CLAUDE_CODE_USE_VERTEX)) {
    return 'vertex'
  }

  if (isTruthy(env.CLAUDE_CODE_USE_FOUNDRY)) {
    return 'foundry'
  }

  return 'firstParty'
}

export function resolveProviderModeFromSettings(settings = {}, env = process.env) {
  const normalizedSettings = normalizeSettings(settings)
  const explicit = readString(normalizedSettings.provider)

  if (explicit) {
    return explicit
  }

  return resolveProviderMode(env)
}

export function getLegacyAnthropicProviderModeFromEnv(env = process.env) {
  const mode = resolveProviderMode(env)
  return isAnthropicProviderMode(mode) ? mode : 'firstParty'
}

export function getLegacyAnthropicProviderModeFromSettings(
  settings = {},
  env = process.env,
) {
  const mode = resolveProviderModeFromSettings(settings, env)
  return isAnthropicProviderMode(mode) ? mode : 'firstParty'
}

function createOpenAICompatibleProviderFromEnv(env) {
  return createOpenAICompatibleProvider(readOpenAICompatibleConfigFromEnv(env))
}

function createOpenAICompatibleProviderFromSettings(settings, env = process.env) {
  const normalizedSettings = normalizeSettings(settings)
  const envConfig =
    resolveProviderMode(env) === 'openai-compatible'
      ? readOpenAICompatibleConfigFromEnv(env)
      : {}
  const config = normalizedSettings.openaiCompatible || {}

  return createOpenAICompatibleProvider({
    provider: readString(config.provider) || envConfig.provider || 'openai-compatible',
    model: readString(config.model) || envConfig.model,
    baseUrl: readString(config.baseUrl) || envConfig.baseUrl,
    apiKey: readString(config.apiKey) || envConfig.apiKey,
    headers: config.headers || envConfig.headers,
    timeout: config.timeout ?? envConfig.timeout,
  })
}

export function createProviderFromEnv(env = process.env) {
  const mode = resolveProviderMode(env)

  if (mode === 'openai-compatible') {
    return createOpenAICompatibleProviderFromEnv(env)
  }

  return createAnthropicProvider({ provider: mode })
}

export function createProviderFromSettings(settings = {}, env = process.env) {
  const mode = resolveProviderModeFromSettings(settings, env)

  if (mode === 'openai-compatible') {
    return createOpenAICompatibleProviderFromSettings(settings, env)
  }

  return createAnthropicProvider({ provider: mode })
}

export function createModelRegistryFromEnv(env = process.env) {
  return createProviderModelRegistry([createProviderFromEnv(env)])
}

export function createModelRegistryFromSettings(settings = {}, env = process.env) {
  const normalizedSettings = normalizeSettings(settings)
  const provider = createProviderFromSettings(normalizedSettings, env)

  return createModelRegistry(
    applySettingsToProviderModels(provider, normalizedSettings),
  )
}

export function createFlatModelRegistry(descriptors = []) {
  return createModelRegistry(descriptors)
}
