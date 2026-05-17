import {
  createProviderAdapter,
  normalizeToolCall,
} from '../contracts/providerAdapter.js'

function requireString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required`)
  }

  return value.trim()
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key, value]) => key && typeof value === 'string' && value.trim() !== '',
    ),
  )
}

export function createOpenAICompatibleProvider(config) {
  const provider = requireString(config?.provider, 'provider')
  const model = requireString(config?.model, 'model')
  const baseUrl = requireString(config?.baseUrl, 'baseUrl')
  const apiKey = requireString(config?.apiKey, 'apiKey')

  const normalizedConfig = {
    provider,
    model,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    headers: normalizeHeaders(config?.headers),
    timeout: Number.isFinite(config?.timeout) ? config.timeout : 600000,
  }

  return createProviderAdapter({
    id: `openai-compatible:${provider}`,
    kind: 'openai-compatible',
    provider,
    config: normalizedConfig,
    listModels() {
      return [
        {
          id: model,
          displayName: model,
          provider,
        },
      ]
    },
    getCapabilities() {
      return {
        streaming: true,
        toolCalling: true,
        supportsJsonSchema: true,
      }
    },
    capabilities: {
      streaming: true,
      toolCalling: true,
      supportsJsonSchema: true,
    },
    validateConfig() {
      return normalizedConfig
    },
    normalizeToolCalls(toolCalls = []) {
      return toolCalls.map(normalizeToolCall).filter(Boolean)
    },
  })
}
