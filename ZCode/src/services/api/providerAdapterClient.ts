import { randomUUID } from 'crypto'

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSystemBlocks(system: unknown): string[] {
  if (typeof system === 'string') {
    return system.trim() === '' ? [] : [system]
  }

  if (!Array.isArray(system)) {
    return []
  }

  return system
    .map(block => {
      if (!isObject(block)) {
        return null
      }

      if (block.type !== 'text') {
        return null
      }

      return readString(block.text)
    })
    .filter((text): text is string => Boolean(text))
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(block => {
      if (!isObject(block)) {
        return ''
      }

      if (block.type === 'text') {
        return typeof block.text === 'string' ? block.text : ''
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function convertMessageContent(content: unknown): {
  content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
} {
  if (typeof content === 'string') {
    return { content }
  }

  if (!Array.isArray(content)) {
    return { content: '' }
  }

  const textParts: string[] = []
  const toolCalls: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }> = []

  for (const block of content) {
    if (!isObject(block)) {
      continue
    }

    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }

    if (block.type === 'tool_use') {
      const name = readString(block.name)
      if (!name) {
        continue
      }

      const id = readString(block.id) || `toolu_${randomUUID()}`
      const input =
        block.input === undefined ? '{}' : JSON.stringify(block.input ?? {})

      toolCalls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: input,
        },
      })
    }
  }

  const result: {
    content?: string
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: {
        name: string
        arguments: string
      }
    }>
  } = {}

  if (textParts.length > 0) {
    result.content = textParts.join('\n')
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls
  }

  if (!result.content && !result.tool_calls) {
    result.content = ''
  }

  return result
}

function convertMessages(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) {
    return []
  }

  const result: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (!isObject(message)) {
      continue
    }

    const role = readString(message.role)
    if (!role) {
      continue
    }

    if (role === 'user') {
      const rawContent = message.content

      if (Array.isArray(rawContent)) {
        const toolResultBlocks = rawContent.filter(
          block => isObject(block) && block.type === 'tool_result',
        )

        if (toolResultBlocks.length > 0) {
          for (const block of toolResultBlocks) {
            const toolUseId = readString(block.tool_use_id)
            if (!toolUseId) {
              continue
            }

            result.push({
              role: 'tool',
              tool_call_id: toolUseId,
              content: stringifyToolResultContent(block.content),
            })
          }

          const textBlocks = rawContent.filter(
            block => isObject(block) && block.type === 'text',
          )
          const text = stringifyToolResultContent(textBlocks)
          if (text) {
            result.push({
              role: 'user',
              content: text,
            })
          }
          continue
        }
      }

      const converted = convertMessageContent(rawContent)
      result.push({
        role: 'user',
        content: converted.content ?? '',
      })
      continue
    }

    if (role === 'assistant') {
      const converted = convertMessageContent(message.content)
      const assistantMessage: Record<string, unknown> = {
        role: 'assistant',
      }

      if (converted.content !== undefined) {
        assistantMessage.content = converted.content
      }

      if (converted.tool_calls) {
        assistantMessage.tool_calls = converted.tool_calls
      }

      result.push(assistantMessage)
      continue
    }

    result.push({
      role,
      content:
        typeof message.content === 'string'
          ? message.content
          : stringifyToolResultContent(message.content),
    })
  }

  return result
}

function convertTools(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  const converted = tools
    .map(tool => {
      if (!isObject(tool)) {
        return null
      }

      const name = readString(tool.name)
      if (!name) {
        return null
      }

      return {
        type: 'function',
        function: {
          name,
          ...(readString(tool.description)
            ? { description: tool.description }
            : {}),
          parameters:
            isObject(tool.input_schema) || Array.isArray(tool.input_schema)
              ? tool.input_schema
              : {
                  type: 'object',
                  properties: {},
                },
        },
      }
    })
    .filter((tool): tool is Record<string, unknown> => Boolean(tool))

  return converted.length > 0 ? converted : undefined
}

function convertToolChoice(toolChoice: unknown): unknown {
  if (!isObject(toolChoice)) {
    return undefined
  }

  if (toolChoice.type === 'auto') {
    return 'auto'
  }

  if (toolChoice.type === 'any') {
    return 'required'
  }

  if (toolChoice.type === 'tool') {
    const name = readString(toolChoice.name)
    if (!name) {
      return undefined
    }

    return {
      type: 'function',
      function: {
        name,
      },
    }
  }

  return undefined
}

function convertResponseFormat(outputConfig: unknown): unknown {
  if (!isObject(outputConfig) || !isObject(outputConfig.format)) {
    return undefined
  }

  const format = outputConfig.format
  const formatType = readString(format.type)

  if (formatType === 'json_object') {
    return { type: 'json_object' }
  }

  if (formatType === 'json_schema') {
    const name = readString(format.name) || 'structured_output'
    const schema = format.schema
    if (!schema || (typeof schema !== 'object' && !Array.isArray(schema))) {
      return undefined
    }

    return {
      type: 'json_schema',
      json_schema: {
        name,
        schema,
      },
    }
  }

  return undefined
}

function convertStop(stopSequences: unknown): string[] | string | undefined {
  if (typeof stopSequences === 'string') {
    return stopSequences
  }

  if (!Array.isArray(stopSequences)) {
    return undefined
  }

  const converted = stopSequences.filter(
    value => typeof value === 'string' && value.length > 0,
  )

  if (converted.length === 0) {
    return undefined
  }

  return converted.length === 1 ? converted[0] : converted
}

function normalizeProviderFinishReason(reason: unknown): string | null {
  const normalized = readString(reason)
  if (!normalized) {
    return null
  }

  if (normalized === 'tool_calls') {
    return 'tool_use'
  }

  if (normalized === 'stop') {
    return 'end_turn'
  }

  if (normalized === 'length') {
    return 'max_tokens'
  }

  return normalized
}

export function createEmptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

function mapUsage(usage: unknown) {
  const base = createEmptyUsage()
  if (!isObject(usage)) {
    return base
  }

  return {
    ...base,
    input_tokens:
      Number.isFinite(usage.prompt_tokens) && typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : 0,
    output_tokens:
      Number.isFinite(usage.completion_tokens) &&
      typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : 0,
  }
}

export function createMessageStartEvent(messageId: string, model: string) {
  return {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: createEmptyUsage(),
    },
  }
}

export function convertResponseChunkToEvents(
  chunk: Record<string, unknown>,
  state: {
    didStart: boolean
    messageId: string | null
    model: string | null
    nextContentIndex: number
  },
) {
  const events: Array<Record<string, unknown>> = []

  const responseId = readString(chunk.messageId) || readString(chunk.message_id)
  const model = readString(chunk.model)

  if (responseId) {
    state.messageId = responseId
  }

  if (model) {
    state.model = model
  }

  if (chunk.type === 'response_start' && !state.didStart) {
    state.didStart = true
    events.push(
      createMessageStartEvent(
        state.messageId || `msg_${randomUUID()}`,
        state.model || 'unknown',
      ),
    )
    return events
  }

  if (!state.didStart && (state.messageId || state.model)) {
    state.didStart = true
    events.push(
      createMessageStartEvent(
        state.messageId || `msg_${randomUUID()}`,
        state.model || 'unknown',
      ),
    )
  }

  if (chunk.type === 'text_delta' && typeof chunk.text === 'string') {
    const index = state.nextContentIndex++
    events.push({
      type: 'content_block_start',
      index,
      content_block: {
        type: 'text',
        text: '',
      },
    })
    events.push({
      type: 'content_block_delta',
      index,
      delta: {
        type: 'text_delta',
        text: chunk.text,
      },
    })
    events.push({
      type: 'content_block_stop',
      index,
    })
    return events
  }

  if (chunk.type === 'tool_call' && isObject(chunk.toolCall)) {
    const toolCall = chunk.toolCall
    const name = readString(toolCall.name)
    if (!name) {
      return events
    }

    const index = state.nextContentIndex++
    const input =
      toolCall.input === undefined ? '{}' : JSON.stringify(toolCall.input ?? {})

    events.push({
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: readString(toolCall.id) || `toolu_${randomUUID()}`,
        name,
        input: {},
      },
    })
    events.push({
      type: 'content_block_delta',
      index,
      delta: {
        type: 'input_json_delta',
        partial_json: input,
      },
    })
    events.push({
      type: 'content_block_stop',
      index,
    })
    return events
  }

  if (chunk.type === 'response_end') {
    events.push({
      type: 'message_delta',
      delta: {
        stop_reason: normalizeProviderFinishReason(chunk.finishReason),
        stop_sequence: null,
      },
      usage: isObject(chunk.usage)
        ? {
            ...createEmptyUsage(),
            input_tokens:
              typeof chunk.usage.inputTokens === 'number'
                ? chunk.usage.inputTokens
                : 0,
            output_tokens:
              typeof chunk.usage.outputTokens === 'number'
                ? chunk.usage.outputTokens
                : 0,
          }
        : createEmptyUsage(),
    })
    events.push({
      type: 'message_stop',
    })
  }

  return events
}

function buildProviderInput(params: Record<string, unknown>, fetchOverride?: unknown) {
  const messages = [
    ...normalizeSystemBlocks(params.system).map(text => ({
      role: 'system',
      content: text,
    })),
    ...convertMessages(params.messages),
  ]

  const providerInput: Record<string, unknown> = {
    model: params.model,
    messages,
  }

  const tools = convertTools(params.tools)
  if (tools) {
    providerInput.tools = tools
  }

  const toolChoice = convertToolChoice(params.tool_choice)
  if (toolChoice !== undefined) {
    providerInput.toolChoice = toolChoice
  }

  if (typeof params.temperature === 'number') {
    providerInput.temperature = params.temperature
  }

  if (typeof params.max_tokens === 'number') {
    providerInput.maxTokens = params.max_tokens
  }

  const responseFormat = convertResponseFormat(params.output_config)
  if (responseFormat !== undefined) {
    providerInput.responseFormat = responseFormat
  }

  const stop = convertStop(params.stop_sequences)
  if (stop !== undefined) {
    providerInput.stop = stop
  }

  if (fetchOverride) {
    providerInput.fetch = fetchOverride
  }

  return providerInput
}

async function collectProviderResponse(stream: AsyncIterable<unknown>) {
  let messageId: string | null = null
  let model: string | null = null
  let stopReason: string | null = null
  let usage = createEmptyUsage()
  const content: Array<Record<string, unknown>> = []

  for await (const chunk of stream) {
    if (!isObject(chunk)) {
      continue
    }

    if (chunk.type === 'response_start') {
      messageId = readString(chunk.messageId) || messageId
      model = readString(chunk.model) || model
      continue
    }

    if (chunk.type === 'text_delta' && typeof chunk.text === 'string') {
      const last = content[content.length - 1]
      if (last?.type === 'text' && typeof last.text === 'string') {
        last.text += chunk.text
      } else {
        content.push({
          type: 'text',
          text: chunk.text,
        })
      }
      continue
    }

    if (chunk.type === 'tool_call' && isObject(chunk.toolCall)) {
      const toolCall = chunk.toolCall
      const name = readString(toolCall.name)
      if (!name) {
        continue
      }

      content.push({
        type: 'tool_use',
        id: readString(toolCall.id) || `toolu_${randomUUID()}`,
        name,
        input: toolCall.input ?? {},
      })
      continue
    }

    if (chunk.type === 'response_end') {
      stopReason = normalizeProviderFinishReason(chunk.finishReason)
      usage = isObject(chunk.usage)
        ? {
            ...usage,
            input_tokens:
              typeof chunk.usage.inputTokens === 'number'
                ? chunk.usage.inputTokens
                : usage.input_tokens,
            output_tokens:
              typeof chunk.usage.outputTokens === 'number'
                ? chunk.usage.outputTokens
                : usage.output_tokens,
          }
        : usage
    }
  }

  return {
    id: messageId || `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: model || 'unknown',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
    _request_id: messageId || undefined,
  }
}

function toHeadersObject(headers: unknown): Record<string, string> {
  if (!headers) {
    return {}
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.filter(
        entry =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string',
      ),
    )
  }

  if (isObject(headers)) {
    return Object.fromEntries(
      Object.entries(headers).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string',
      ),
    )
  }

  return {}
}

function createMergedHeaders(
  defaultHeaders: Record<string, string>,
  requestHeaders: unknown,
  innerHeaders: unknown,
): Record<string, string> {
  return {
    ...defaultHeaders,
    ...toHeadersObject(requestHeaders),
    ...toHeadersObject(innerHeaders),
  }
}

function createAbortController(signal: unknown): AbortController {
  const controller = new AbortController()

  if (signal instanceof AbortSignal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener('abort', () => controller.abort(signal.reason), {
        once: true,
      })
    }
  }

  return controller
}

function roughCountTokens(value: unknown): number {
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return Math.max(1, Math.round(serialized.length / 4))
}

export function createProviderAdapterClient({
  provider,
  defaultHeaders = {},
  fetchOverride,
}: {
  provider: {
    streamChat: (input?: Record<string, unknown>) => AsyncIterable<unknown>
    listModels?: () => Array<{
      id: string
      contextWindow?: number | null
      maxOutputTokens?: number | null
    }>
  }
  defaultHeaders?: Record<string, string>
  fetchOverride?: unknown
}) {
  const invokeCreate = (
    params: Record<string, unknown>,
    requestOptions: Record<string, unknown> = {},
  ) => {
    let lastResponse: Response | null = null
    const fetchImpl = requestOptions.fetch || fetchOverride
    const wrappedFetch =
      typeof fetchImpl === 'function'
        ? async (input: unknown, init: Record<string, unknown> = {}) => {
            const response = await fetchImpl(input, {
              ...init,
              headers: createMergedHeaders(
                defaultHeaders,
                requestOptions.headers,
                init.headers,
              ),
            })
            lastResponse = response
            return response
          }
        : undefined

    const controller = createAbortController(requestOptions.signal)
    const providerInput = buildProviderInput(params, wrappedFetch)
    providerInput.signal = controller.signal

    const responseHeaders = new Headers(
      createMergedHeaders(defaultHeaders, requestOptions.headers, undefined),
    )

    const shouldStream = params.stream === true

    if (shouldStream) {
      return {
        withResponse: async () => {
          const providerStream = provider.streamChat(providerInput)
          const iterator = providerStream[Symbol.asyncIterator]()
          const state = {
            didStart: false,
            messageId: null as string | null,
            model: null as string | null,
            nextContentIndex: 0,
          }
          const initialEvents: Array<Record<string, unknown>> = []

          const firstChunk = await iterator.next()
          if (!firstChunk.done && isObject(firstChunk.value)) {
            initialEvents.push(
              ...convertResponseChunkToEvents(firstChunk.value, state),
            )
          }

          const data = (async function* () {
            for (const event of initialEvents) {
              yield event
            }

            let next = await iterator.next()
            while (!next.done) {
              const chunk = next.value
              if (!isObject(chunk)) {
                next = await iterator.next()
                continue
              }

              for (const event of convertResponseChunkToEvents(chunk, state)) {
                yield event
              }

              next = await iterator.next()
            }
          })()

          return {
            request_id: state.messageId || undefined,
            response: lastResponse || new Response(null, { headers: responseHeaders }),
            data: Object.assign(data, {
              controller,
            }),
          }
        },
        asResponse: async () => lastResponse || new Response(null, { headers: responseHeaders }),
      }
    }

    const messagePromise = collectProviderResponse(provider.streamChat(providerInput))

    return Object.assign(messagePromise, {
      asResponse: async () => lastResponse || new Response(null, { headers: responseHeaders }),
    })
  }

  return {
    beta: {
      messages: {
        create: invokeCreate,
        countTokens: async (params: Record<string, unknown>) => ({
          input_tokens: roughCountTokens({
            system: params.system,
            messages: params.messages,
            tools: params.tools,
          }),
        }),
      },
    },
    models: {
      async *list() {
        const models =
          typeof provider.listModels === 'function' ? provider.listModels() : []

        for (const model of models) {
          yield {
            id: model.id,
            ...(typeof model.contextWindow === 'number'
              ? { max_input_tokens: model.contextWindow }
              : {}),
            ...(typeof model.maxOutputTokens === 'number'
              ? { max_tokens: model.maxOutputTokens }
              : {}),
          }
        }
      },
    },
  }
}
