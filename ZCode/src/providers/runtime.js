import { createAnthropicProvider } from './anthropic.js'
import { createModelRegistry, createProviderModelRegistry } from './modelRegistry.js'
import { createOpenAICompatibleProvider } from './openaiCompatible.js'
import { normalizeSettings } from '../config/settingsContract.js'

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

function createOpenAICompatibleProviderFromEnv(env) {
  return createOpenAICompatibleProvider({
    provider: readString(env.ZCODE_OPENAI_PROVIDER) || 'openai-compatible',
    model: readString(env.ZCODE_OPENAI_MODEL),
    baseUrl: readString(env.ZCODE_OPENAI_BASE_URL),
    apiKey: readString(env.ZCODE_OPENAI_API_KEY),
    headers: readJsonObject(env.ZCODE_OPENAI_HEADERS),
  })
}

function createOpenAICompatibleProviderFromSettings(settings) {
  const normalizedSettings = normalizeSettings(settings)
  const config = normalizedSettings.openaiCompatible || {}

  return createOpenAICompatibleProvider({
    provider: readString(config.provider) || 'openai-compatible',
    model: readString(config.model),
    baseUrl: readString(config.baseUrl),
    apiKey: readString(config.apiKey),
    headers: config.headers,
    timeout: config.timeout,
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
    return createOpenAICompatibleProviderFromSettings(settings)
  }

  return createAnthropicProvider({ provider: mode })
}

export function createModelRegistryFromEnv(env = process.env) {
  return createProviderModelRegistry([createProviderFromEnv(env)])
}

export function createModelRegistryFromSettings(settings = {}, env = process.env) {
  return createProviderModelRegistry([createProviderFromSettings(settings, env)])
}

export function createFlatModelRegistry(descriptors = []) {
  return createModelRegistry(descriptors)
}
