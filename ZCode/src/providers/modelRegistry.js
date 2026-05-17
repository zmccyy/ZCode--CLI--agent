import { normalizeModelDescriptor } from '../contracts/providerAdapter.js'

export function createModelRegistry(descriptors = []) {
  const normalized = descriptors.map(descriptor =>
    normalizeModelDescriptor(descriptor),
  )
  const byId = new Map(normalized.map(descriptor => [descriptor.id, descriptor]))

  return {
    has(modelId) {
      return byId.has(modelId)
    },
    get(modelId) {
      return byId.get(modelId)
    },
    list() {
      return [...normalized]
    },
    listByProvider(provider) {
      return normalized.filter(descriptor => descriptor.provider === provider)
    },
  }
}

export function createProviderModelRegistry(providers = []) {
  return createModelRegistry(
    providers.flatMap(provider =>
      typeof provider?.listModels === 'function' ? provider.listModels() : [],
    ),
  )
}
