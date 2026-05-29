import { randomUUID } from 'crypto'
import {
  convertResponseChunkToEvents,
  createEmptyUsage,
  createMessageStartEvent,
} from './providerAdapterClient.ts'

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function roughCountTokens(value: unknown): number {
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return Math.max(1, Math.round(serialized.length / 4))
}

function toHeadersObject(headers: unknown): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.filter(
        (entry): entry is [string, string] =>
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
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    )
  }
  return {}
}

function normalizeFinishReason(reason: unknown): string | null {
  const normalized = readString(reason)
  if (!normalized) return null
  if (normalized === 'tool_calls') return 'tool_use'
  if (normalized === 'stop') return 'end_turn'
  if (normalized === 'length') return 'max_tokens'
  return normalized
}

async function collectResponse(stream: AsyncIterable<unknown>) {
  let messageId: string | null = null
  let model: string | null = null
  let stopReason: string | null = null
  let usage = createEmptyUsage()
  const content: Array<Record<string, unknown>> = []

  for await (const chunk of stream) {
    if (!isObject(chunk)) continue

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
        content.push({ type: 'text', text: chunk.text })
      }
      continue
    }

    if (chunk.type === 'tool_call' && isObject(chunk.toolCall)) {
      const toolCall = chunk.toolCall
      const name = readString(toolCall.name)
      if (!name) continue
      content.push({
        type: 'tool_use',
        id: readString(toolCall.id) || `toolu_${randomUUID()}`,
        name,
        input: toolCall.input ?? {},
      })
      continue
    }

    if (chunk.type === 'response_end') {
      stopReason = normalizeFinishReason(chunk.finishReason)
      if (isObject(chunk.usage)) {
        usage = {
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
      }
    }
  }

  return {
    id: messageId || `msg_${randomUUID()}`,
    type: 'message' as const,
    role: 'assistant' as const,
    model: model || 'unknown',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
    _request_id: messageId || undefined,
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

/**
 * Wraps an Anthropic provider (from createAnthropicProvider) so it exposes the
 * same shape as @anthropic-ai/sdk — specifically `beta.messages.create()` with
 * streaming `.withResponse()` and non-streaming promise+`.asResponse()`.
 *
 * Unlike createProviderAdapterClient, this adapter does NOT convert params to
 * OpenAI-compatible format.  The Anthropic provider's streamChat already accepts
 * native Anthropic-format messages / system / tools / thinking / stop_sequences.
 */
export function createAnthropicPassthroughClient({
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
              headers: {
                ...defaultHeaders,
                ...toHeadersObject(requestOptions.headers),
                ...toHeadersObject(init.headers),
              },
            })
            lastResponse = response
            return response
          }
        : undefined

    const controller = createAbortController(requestOptions.signal)

    // Pass through native Anthropic-format params directly — no OpenAI conversion.
    const providerInput: Record<string, unknown> = {
      model: params.model,
      messages: params.messages ?? [],
      maxTokens: params.max_tokens,
    }

    if (params.system !== undefined) {
      providerInput.system = params.system
    }

    if (Array.isArray(params.tools) && params.tools.length > 0) {
      providerInput.tools = params.tools
    }

    if (typeof params.temperature === 'number') {
      providerInput.temperature = params.temperature
    }

    if (params.thinking !== undefined) {
      providerInput.thinking = params.thinking
    }

    if (params.stop_sequences !== undefined) {
      providerInput.stopSequences = params.stop_sequences
    }

    if (wrappedFetch) {
      providerInput.fetch = wrappedFetch
    }

    providerInput.signal = controller.signal

    const responseHeaders = new Headers(
      {
        ...defaultHeaders,
        ...toHeadersObject(requestOptions.headers),
      },
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
          let eventIndex = 0

          // Emit a synthetic message_start so downstream code that expects
          // Anthropic SSE semantics sees message_start before any content block.
          const first = await iterator.next()
          if (!first.done && isObject(first.value)) {
            const chunk = first.value
            if (chunk.type === 'response_start') {
              state.didStart = true
              state.messageId = readString(chunk.messageId) || state.messageId
              state.model = readString(chunk.model) || state.model
              initialEvents.push(
                createMessageStartEvent(
                  state.messageId || `msg_${randomUUID()}`,
                  state.model || 'unknown',
                ),
              )
              // response_start itself does not produce content-block events
            } else {
              // First chunk is not response_start — emit message_start anyway
              if (readString(chunk.messageId)) state.messageId = readString(chunk.messageId)
              if (readString(chunk.model)) state.model = readString(chunk.model)
              if (!state.didStart && (state.messageId || state.model)) {
                state.didStart = true
                initialEvents.push(
                  createMessageStartEvent(
                    state.messageId || `msg_${randomUUID()}`,
                    state.model || 'unknown',
                  ),
                )
              }
              initialEvents.push(
                ...convertResponseChunkToEvents(chunk, state),
              )
            }
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
            response:
              lastResponse ||
              new Response(null, { headers: responseHeaders }),
            data: Object.assign(data, { controller }),
          }
        },
        asResponse: async () =>
          lastResponse || new Response(null, { headers: responseHeaders }),
      }
    }

    // Non-streaming: collect the entire stream into a single message object.
    const messagePromise = collectResponse(provider.streamChat(providerInput))

    return Object.assign(messagePromise, {
      asResponse: async () =>
        lastResponse || new Response(null, { headers: responseHeaders }),
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
