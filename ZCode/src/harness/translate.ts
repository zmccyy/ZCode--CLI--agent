/**
 * Message translation between the provider-agnostic harness format and the
 * two wire dialects spoken by src/providers (OpenAI-compatible, Anthropic).
 */

import type {
  ChatMessage,
  JsonSchemaObject,
  ToolCall,
  ToolDefinition,
  WireDialect,
} from './types.ts'

let syntheticCounter = 0

export function nextSyntheticToolCallId(): string {
  syntheticCounter += 1
  return `toolu_synth_${syntheticCounter}`
}

export function toolCallIdFor(call: ToolCall, fallbackIndex: number): string {
  if (call.id && call.id.trim() !== '') {
    return call.id
  }
  return `${nextSyntheticToolCallId()}_${fallbackIndex}`
}

export function resolveDialect(provider: { kind?: string }): WireDialect {
  return provider.kind === 'anthropic' ? 'anthropic' : 'openai'
}

// ─── OpenAI-compatible wire format ───────────────────────────────────────────

export function toOpenAIMessages(
  system: string | null,
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = []

  if (system && system.trim() !== '') {
    wire.push({ role: 'system', content: system })
  }

  for (const message of messages) {
    if (message.role === 'user') {
      wire.push({ role: 'user', content: message.content })
      continue
    }

    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls || []
      wire.push({
        role: 'assistant',
        content: message.text ?? null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call, index) => ({
                id: toolCallIdFor(call, index),
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input ?? {}),
                },
              })),
            }
          : {}),
      })
      continue
    }

    wire.push({
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content,
    })
  }

  return wire
}

export function toOpenAITools(
  tools: ToolDefinition[],
): Array<Record<string, unknown>> {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

// ─── Anthropic wire format ───────────────────────────────────────────────────

export function toAnthropicMessages(
  _system: string | null,
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.role === 'user') {
      wire.push({ role: 'user', content: message.content })
      continue
    }

    if (message.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = []
      if (typeof message.text === 'string' && message.text !== '') {
        blocks.push({ type: 'text', text: message.text })
      }
      for (const [index, call] of (message.toolCalls || []).entries()) {
        blocks.push({
          type: 'tool_use',
          id: toolCallIdFor(call, index),
          name: call.name,
          input: call.input ?? {},
        })
      }
      wire.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
      })
      continue
    }

    // Tool results ride in a user message; merge consecutive results into one
    // user turn with multiple tool_result blocks (Anthropic conversation rules).
    const block: Record<string, unknown> = {
      type: 'tool_result',
      tool_use_id: message.toolCallId,
      content: message.content,
    }
    if (message.isError) {
      block.is_error = true
    }

    const previous = wire[wire.length - 1]
    const previousBlocks =
      previous &&
      previous.role === 'user' &&
      Array.isArray(previous.content) &&
      previous.content.length > 0 &&
      (previous.content[0] as Record<string, unknown>)?.type === 'tool_result'
        ? (previous.content as Array<Record<string, unknown>>)
        : null

    if (previousBlocks) {
      previousBlocks.push(block)
    } else {
      wire.push({ role: 'user', content: [block] })
    }
  }

  return wire
}

export function toAnthropicTools(
  tools: ToolDefinition[],
): Array<Record<string, unknown>> {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function toAnthropicSystem(system: string | null): string | null {
  return system && system.trim() !== '' ? system : null
}

// ─── Shared dispatch ─────────────────────────────────────────────────────────

export interface TranslatedRequest {
  messages: Array<Record<string, unknown>>
  tools?: Array<Record<string, unknown>>
  system?: string | null
}

export function translateRequest(options: {
  dialect: WireDialect
  system: string | null
  messages: ChatMessage[]
  tools: ToolDefinition[]
}): TranslatedRequest {
  const { dialect, system, messages, tools } = options

  if (dialect === 'anthropic') {
    return {
      messages: toAnthropicMessages(system, messages),
      tools: toAnthropicTools(tools),
      system: toAnthropicSystem(system),
    }
  }

  return {
    messages: toOpenAIMessages(system, messages),
    tools: toOpenAITools(tools),
  }
}

/**
 * Flatten a JSON schema's required/optional property names into a readable
 * signature used in tool descriptions rendered into the system prompt.
 */
export function summarizeSchema(schema: JsonSchemaObject): string {
  const properties = schema.properties || {}
  const required = new Set(schema.required || [])
  return Object.keys(properties)
    .map(name => (required.has(name) ? name : `${name}?`))
    .join(', ')
}
