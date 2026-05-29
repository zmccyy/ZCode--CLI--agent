import { createRequire } from 'node:module'
import {
  createProviderAdapter,
  normalizeToolCall,
} from '../contracts/providerAdapter.js'

const requireFromHere = createRequire(import.meta.url)

function loadModelConfigs() {
  return requireFromHere('../utils/model/configs.ts')
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required`)
  }

  return value.trim()
}

function readString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
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

async function readErrorDetails(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json()
      const message =
        payload?.error?.message ||
        payload?.message ||
        payload?.error ||
        JSON.stringify(payload)
      return readString(message)
    } catch {
      return null
    }
  }

  try {
    return readString(await response.text())
  } catch {
    return null
  }
}

function resolveFetch(fetchOverride) {
  if (typeof fetchOverride === 'function') {
    return fetchOverride
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis)
  }

  throw new Error('fetch is required for anthropic providers')
}

async function* parseAnthropicSSE(response) {
  const reader = response.body?.getReader?.()

  if (!reader) {
    throw new Error('Anthropic response body is not readable')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    let blankLineMatch = buffer.match(/\r?\n\r?\n/)
    while (blankLineMatch) {
      const separatorIndex = blankLineMatch.index || 0
      const separator = blankLineMatch[0]
      const rawBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + separator.length)
      blankLineMatch = buffer.match(/\r?\n\r?\n/)

      if (!rawBlock.trim()) {
        continue
      }

      const lines = rawBlock.split(/\r?\n/)
      let eventType = null
      let data = null

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data = line.slice(5).trimStart()
        }
      }

      if (data) {
        yield { eventType, data }
      }
    }

    if (done) {
      break
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    const lines = trailing.split(/\r?\n/)
    let eventType = null
    let data = null

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trimStart()
      }
    }

    if (data) {
      yield { eventType, data }
    }
  }
}

function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  return {
    inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
    outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
    totalTokens:
      Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)
        ? usage.input_tokens + usage.output_tokens
        : 0,
  }
}

export function createAnthropicProvider(options = {}) {
  const provider = requireProvider(options.provider)
  const apiKey = readString(options.apiKey) || readString(process.env.ANTHROPIC_API_KEY) || ''
  const baseUrl = readString(options.baseUrl) || 'https://api.anthropic.com'
  const { ALL_MODEL_CONFIGS } = loadModelConfigs()

  return createProviderAdapter({
    id: `anthropic:${provider}`,
    kind: 'anthropic',
    provider,
    config: {
      provider,
      apiKey,
      baseUrl,
    },
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
    streamChat(input = {}) {
      const resolvedApiKey = readString(input.apiKey) || apiKey
      if (!resolvedApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for streaming')
      }

      const model =
        readString(input.model) ||
        (Object.values(ALL_MODEL_CONFIGS)[0]?.[provider]) ||
        'claude-sonnet-4-6'

      const fetchImpl = resolveFetch(input.fetch)

      const body = {
        model,
        stream: true,
        max_tokens: Number.isFinite(input.maxTokens) ? input.maxTokens : 4096,
        messages: Array.isArray(input.messages) ? input.messages : [],
      }

      if (typeof input.system === 'string' && input.system.trim() !== '') {
        body.system = input.system
      } else if (Array.isArray(input.system) && input.system.length > 0) {
        body.system = input.system
      }

      if (Array.isArray(input.tools) && input.tools.length > 0) {
        body.tools = input.tools
      }

      if (Number.isFinite(input.temperature)) {
        body.temperature = input.temperature
      }

      if (input.thinking !== undefined) {
        body.thinking = input.thinking
      }

      if (input.stopSequences !== undefined) {
        body.stop_sequences = input.stopSequences
      }

      return (async function* () {
        const response = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'x-api-key': resolvedApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: input.signal,
        })

        if (!response.ok) {
          const details = await readErrorDetails(response)
          const summary = [response.status, response.statusText]
            .filter(Boolean)
            .join(' ')
          throw new Error(details ? `${summary}: ${details}` : summary)
        }

        let didStart = false
        let resolvedModel = model
        let responseId = null
        const toolInputAccumulator = new Map()
        const toolUseNames = new Map()
        const toolUseIds = new Map()

        for await (const { eventType, data } of parseAnthropicSSE(response)) {
          let payload
          try {
            payload = JSON.parse(data)
          } catch {
            continue
          }

          switch (payload.type) {
            case 'message_start': {
              responseId =
                readString(payload.message?.id) || responseId
              resolvedModel =
                readString(payload.message?.model) || resolvedModel

              if (!didStart) {
                didStart = true
                yield {
                  type: 'response_start',
                  messageId: responseId,
                  model: resolvedModel,
                  provider,
                }
              }
              break
            }

            case 'content_block_start': {
              const block = payload.content_block
              const index = payload.index

              if (block?.type === 'tool_use') {
                toolUseNames.set(index, readString(block.name) || '')
                toolUseIds.set(index, readString(block.id) || '')
                toolInputAccumulator.set(index, '')
              }
              break
            }

            case 'content_block_delta': {
              const delta = payload.delta
              const index = payload.index

              if (delta?.type === 'text_delta' && readString(delta.text)) {
                yield {
                  type: 'text_delta',
                  text: delta.text,
                }
              }

              if (
                delta?.type === 'input_json_delta' &&
                typeof delta.partial_json === 'string'
              ) {
                const current = toolInputAccumulator.get(index) || ''
                toolInputAccumulator.set(index, current + delta.partial_json)
              }
              break
            }

            case 'content_block_stop': {
              const index = payload.index
              const accumulated = toolInputAccumulator.get(index)

              if (accumulated !== undefined && accumulated.trim() !== '') {
                toolInputAccumulator.delete(index)

                let parsedInput
                try {
                  parsedInput = JSON.parse(accumulated)
                } catch {
                  parsedInput = accumulated
                }

                yield {
                  type: 'tool_call',
                  toolCall: normalizeToolCall({
                    id: toolUseIds.get(index) || null,
                    type: 'function',
                    name: toolUseNames.get(index) || '',
                    input: parsedInput,
                  }),
                }

                toolUseIds.delete(index)
                toolUseNames.delete(index)
              }
              break
            }

            case 'message_delta': {
              yield {
                type: 'response_end',
                finishReason: readString(payload.delta?.stop_reason) || 'end_turn',
                ...(mapUsage(payload.usage) ? { usage: mapUsage(payload.usage) } : {}),
              }
              break
            }

            case 'message_stop': {
              break
            }

            default: {
              break
            }
          }
        }
      })()
    },
    validateConfig() {
      return {
        provider,
        apiKey,
        baseUrl,
      }
    },
    normalizeToolCalls(toolCalls = []) {
      return toolCalls.map(normalizeToolCall).filter(Boolean)
    },
  })
}
