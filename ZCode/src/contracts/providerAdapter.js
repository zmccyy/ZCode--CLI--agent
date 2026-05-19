const DEFAULT_CAPABILITIES = Object.freeze({
  streaming: false,
  toolCalling: false,
  supportsJsonSchema: false,
})

function normalizeCapabilities(capabilities = {}) {
  return {
    streaming: capabilities.streaming === true,
    toolCalling: capabilities.toolCalling === true,
    supportsJsonSchema: capabilities.supportsJsonSchema === true,
  }
}

export function normalizeModelDescriptor(descriptor, defaults = {}) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('model descriptor is required')
  }

  if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
    throw new Error('model descriptor id is required')
  }

  const provider =
    typeof descriptor.provider === 'string' && descriptor.provider.trim() !== ''
      ? descriptor.provider.trim()
      : defaults.provider

  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new Error('model descriptor provider is required')
  }

  return {
    id: descriptor.id.trim(),
    displayName:
      typeof descriptor.displayName === 'string' &&
      descriptor.displayName.trim() !== ''
        ? descriptor.displayName.trim()
        : descriptor.id.trim(),
    provider,
    contextWindow:
      Number.isFinite(descriptor.contextWindow) && descriptor.contextWindow > 0
        ? descriptor.contextWindow
        : null,
    maxOutputTokens:
      Number.isFinite(descriptor.maxOutputTokens) &&
      descriptor.maxOutputTokens > 0
        ? descriptor.maxOutputTokens
        : null,
    capabilities: normalizeCapabilities({
      ...defaults.capabilities,
      ...descriptor.capabilities,
    }),
  }
}

export function normalizeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') {
    return null
  }

  const name =
    typeof toolCall.name === 'string' && toolCall.name.trim() !== ''
      ? toolCall.name.trim()
      : typeof toolCall.function?.name === 'string' &&
          toolCall.function.name.trim() !== ''
        ? toolCall.function.name.trim()
        : null

  if (!name) {
    return null
  }

  let input = toolCall.input

  if (
    input === undefined &&
    typeof toolCall.function?.arguments === 'string' &&
    toolCall.function.arguments.trim() !== ''
  ) {
    try {
      input = JSON.parse(toolCall.function.arguments)
    } catch {
      input = toolCall.function.arguments
    }
  }

  return {
    id:
      typeof toolCall.id === 'string' && toolCall.id.trim() !== ''
        ? toolCall.id.trim()
        : null,
    type:
      typeof toolCall.type === 'string' && toolCall.type.trim() !== ''
        ? toolCall.type.trim()
        : 'function',
    name,
    input: input ?? {},
  }
}

export function createProviderAdapter(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('provider definition is required')
  }

  if (typeof definition.id !== 'string' || definition.id.trim() === '') {
    throw new Error('provider id is required')
  }

  if (typeof definition.kind !== 'string' || definition.kind.trim() === '') {
    throw new Error('provider kind is required')
  }

  const providerName =
    typeof definition.provider === 'string' && definition.provider.trim() !== ''
      ? definition.provider.trim()
      : definition.id.trim()

  const capabilities = normalizeCapabilities(definition.capabilities)
  const rawListModels =
    typeof definition.listModels === 'function' ? definition.listModels : () => []

  return {
    id: definition.id.trim(),
    kind: definition.kind.trim(),
    provider: providerName,
    config: definition.config,
    streamChat(input) {
      if (typeof definition.streamChat === 'function') {
        return definition.streamChat(input)
      }

      return (async function* () {
        throw new Error(`streamChat is not implemented for ${definition.id}`)
      })()
    },
    listModels() {
      return rawListModels().map(descriptor =>
        normalizeModelDescriptor(descriptor, {
          provider: providerName,
          capabilities,
        }),
      )
    },
    getCapabilities() {
      return capabilities
    },
    validateConfig(config = definition.config) {
      if (typeof definition.validateConfig === 'function') {
        return definition.validateConfig(config)
      }

      return config
    },
    normalizeToolCalls(toolCalls = []) {
      if (!Array.isArray(toolCalls)) {
        return []
      }

      if (typeof definition.normalizeToolCalls === 'function') {
        return definition.normalizeToolCalls(toolCalls)
      }

      return toolCalls.map(normalizeToolCall).filter(Boolean)
    },
  }
}

export { DEFAULT_CAPABILITIES }
