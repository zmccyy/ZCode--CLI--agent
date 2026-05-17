import { createRequire } from 'node:module'
import { createProviderAdapter } from '../contracts/providerAdapter.js'

const requireFromHere = createRequire(import.meta.url)

function loadModelConfigs() {
  return requireFromHere('../utils/model/configs.ts')
}

function requireProvider(provider) {
  const normalized =
    typeof provider === 'string' && provider.trim() !== ''
      ? provider.trim()
      : 'firstParty'

  if (!['firstParty', 'bedrock', 'vertex', 'foundry'].includes(normalized)) {
    throw new Error(`unsupported anthropic provider: ${normalized}`)
  }

  return normalized
}

export function createAnthropicProvider(options = {}) {
  const provider = requireProvider(options.provider)
  const { ALL_MODEL_CONFIGS } = loadModelConfigs()

  return createProviderAdapter({
    id: `anthropic:${provider}`,
    kind: 'anthropic',
    provider,
    capabilities: {
      streaming: true,
      toolCalling: true,
      supportsJsonSchema: true,
    },
    listModels() {
      return Object.values(ALL_MODEL_CONFIGS).map(config => ({
        id: config[provider],
        displayName: config.firstParty,
        provider,
      }))
    },
    getCapabilities() {
      return {
        streaming: true,
        toolCalling: true,
        supportsJsonSchema: true,
      }
    },
  })
}
