import { createRequire } from 'node:module'
import {
  createProviderAdapter,
  normalizeToolCall,
} from '../contracts/providerAdapter.js'

const _require = createRequire(import.meta.url)

function loadModelConfigs() {
  return _require('../utils/model/configs.ts')
}

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

function readString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function buildChatCompletionsUrl(baseUrl) {
  return `${baseUrl}/chat/completions`
}

function buildRequestBody(config, input = {}) {
  const body = {
    model: readString(input.model) || config.model,
    stream: true,
    stream_options: {
      include_usage: true,
    },
    messages: Array.isArray(input.messages) ? input.messages : [],
  }

  if (Array.isArray(input.tools) && input.tools.length > 0) {
    body.tools = input.tools
  }

  if (input.toolChoice !== undefined) {
    body.tool_choice = input.toolChoice
  }

  if (Number.isFinite(input.temperature)) {
    body.temperature = input.temperature
  }

  if (Number.isFinite(input.maxTokens)) {
    body.max_tokens = input.maxTokens
  }

  if (input.responseFormat && typeof input.responseFormat === 'object') {
    body.response_format = input.responseFormat
  }

  if (input.stop !== undefined) {
    body.stop = input.stop
  }

  return body
}

function resolveFetch(fetchOverride) {
  if (typeof fetchOverride === 'function') {
    return fetchOverride
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis)
  }

  throw new Error('fetch is required for openai-compatible providers')
}

function mergeAbortSignals(signals = []) {
  const activeSignals = signals.filter(Boolean)
  if (activeSignals.length === 0) {
    return undefined
  }

  if (activeSignals.length === 1) {
    return activeSignals[0]
  }

  const controller = new AbortController()

  const abort = signal => {
    if (!controller.signal.aborted) {
      controller.abort(signal?.reason)
    }
  }

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal)
      break
    }

    signal.addEventListener('abort', () => abort(signal), { once: true })
  }

  return controller.signal
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

async function* parseSSE(response) {
  const reader = response.body?.getReader?.()

  if (!reader) {
    throw new Error('OpenAI-compatible response body is not readable')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    let separatorMatch = buffer.match(/\r?\n\r?\n/)
    while (separatorMatch) {
      const separatorIndex = separatorMatch.index || 0
      const separator = separatorMatch[0]
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + separator.length)
      separatorMatch = buffer.match(/\r?\n\r?\n/)

      const data = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')

      if (!data) {
        continue
      }

      yield data
    }

    if (done) {
      break
    }
  }

  const trailing = buffer.trim()
  if (trailing.startsWith('data:')) {
    yield trailing
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
  }
}

function mergeToolCallDelta(accumulator, deltaToolCalls = []) {
  for (const toolCall of deltaToolCalls) {
    const index = Number.isInteger(toolCall?.index) ? toolCall.index : 0
    const current = accumulator.get(index) || {
      id: null,
      type: 'function',
      function: {
        name: null,
        arguments: '',
      },
    }

    if (readString(toolCall?.id)) {
      current.id = toolCall.id.trim()
    }

    if (readString(toolCall?.type)) {
      current.type = toolCall.type.trim()
    }

    if (toolCall?.function && typeof toolCall.function === 'object') {
      if (readString(toolCall.function.name)) {
        current.function.name = toolCall.function.name.trim()
      }

      if (typeof toolCall.function.arguments === 'string') {
        current.function.arguments += toolCall.function.arguments
      }
    }

    accumulator.set(index, current)
  }
}

function flushToolCalls(accumulator) {
  const toolCalls = [...accumulator.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => normalizeToolCall(toolCall))
    .filter(Boolean)

  accumulator.clear()
  return toolCalls
}

function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  return {
    inputTokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0,
    outputTokens: Number.isFinite(usage.completion_tokens)
      ? usage.completion_tokens
      : 0,
    totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : 0,
  }
}

function normalizeFinishReason(reason) {
  return readString(reason) || 'stop'
}

function loadCatalog(useCatalog) {
  if (!useCatalog) return null
  try {
    return loadModelConfigs().ALL_MODEL_CONFIGS
  } catch {
    return null
  }
}

export function createOpenAICompatibleProvider(config, options = {}) {
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

  const useCatalog = options.useCatalog !== false
  const catalog = loadCatalog(useCatalog)

  return createProviderAdapter({
    id: `openai-compatible:${provider}`,
    kind: 'openai-compatible',
    provider,
    config: normalizedConfig,
    listModels() {
      if (catalog) {
        const catalogModels = Object.values(catalog)
          .filter(cfg => cfg.openaiCompatible !== model)
          .map(cfg => ({
            id: cfg.openaiCompatible,
            displayName: cfg.firstParty,
            provider,
          }))

        return [
          {
            id: model,
            displayName: model,
            provider,
          },
          ...catalogModels,
        ]
      }

      return [
        {
          id: model,
          displayName: model,
          provider,
        },
      ]
    },
    capabilities: {
      streaming: true,
      toolCalling: true,
      supportsJsonSchema: true,
    },
    streamChat(input = {}) {
      const requestBody = buildRequestBody(normalizedConfig, input)
      const fetchImpl = resolveFetch(input.fetch)
      const timeoutSignal =
        typeof AbortSignal !== 'undefined' &&
        typeof AbortSignal.timeout === 'function' &&
        Number.isFinite(normalizedConfig.timeout)
          ? AbortSignal.timeout(normalizedConfig.timeout)
          : undefined
      const signal = mergeAbortSignals([input.signal, timeoutSignal])

      return (async function* () {
        const response = await fetchImpl(
          buildChatCompletionsUrl(normalizedConfig.baseUrl),
          {
            method: 'POST',
            headers: {
              Accept: 'text/event-stream',
              Authorization: `Bearer ${normalizedConfig.apiKey}`,
              'Content-Type': 'application/json',
              ...normalizedConfig.headers,
            },
            body: JSON.stringify(requestBody),
            ...(signal ? { signal } : {}),
          },
        )

        if (!response.ok) {
          const details = await readErrorDetails(response)
          const summary = [response.status, response.statusText]
            .filter(Boolean)
            .join(' ')
          throw new Error(details ? `${summary}: ${details}` : summary)
        }

        let didStart = false
        let resolvedModel = requestBody.model
        let responseId = null
        const toolCallAccumulator = new Map()

        for await (const data of parseSSE(response)) {
          if (data === '[DONE]') {
            break
          }

          const payload = JSON.parse(data)
          const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null
          const delta = choice?.delta

          if (readString(payload?.id)) {
            responseId = payload.id.trim()
          }

          if (readString(payload?.model)) {
            resolvedModel = payload.model.trim()
          }

          if (!didStart && (responseId || resolvedModel)) {
            didStart = true
            yield {
              type: 'response_start',
              messageId: responseId,
              model: resolvedModel,
              provider,
            }
          }

          if (readString(delta?.content)) {
            yield {
              type: 'text_delta',
              text: delta.content,
            }
          }

          if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
            mergeToolCallDelta(toolCallAccumulator, delta.tool_calls)
          }

          if (choice?.finish_reason) {
            for (const toolCall of flushToolCalls(toolCallAccumulator)) {
              yield {
                type: 'tool_call',
                toolCall,
              }
            }

            yield {
              type: 'response_end',
              finishReason: normalizeFinishReason(choice.finish_reason),
              ...(mapUsage(payload?.usage) ? { usage: mapUsage(payload.usage) } : {}),
            }
          }
        }
      })()
    },
    validateConfig(config = {}) {
      const resolved = {
        provider: readString(config.provider) || normalizedConfig.provider,
        model: readString(config.model) || normalizedConfig.model,
        baseUrl: (readString(config.baseUrl) || normalizedConfig.baseUrl).replace(/\/+$/, ''),
        apiKey: readString(config.apiKey) || normalizedConfig.apiKey,
        headers: config?.headers && typeof config.headers === 'object' ? normalizeHeaders(config.headers) : normalizedConfig.headers,
        timeout: Number.isFinite(config?.timeout) ? config.timeout : normalizedConfig.timeout,
      }
      const errors = []
      if (!resolved.provider) errors.push('provider is required')
      if (!resolved.model) errors.push('model is required')
      if (!resolved.baseUrl) errors.push('baseUrl is required')
      if (!resolved.apiKey) errors.push('apiKey is required')
      if (errors.length > 0) {
        return { valid: false, errors }
      }
      return { valid: true, config: resolved }
    },
    normalizeToolCalls(toolCalls = []) {
      return toolCalls.map(normalizeToolCall).filter(Boolean)
    },
  })
}
