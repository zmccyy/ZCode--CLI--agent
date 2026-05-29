import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const adapterModulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'services',
  'api',
  'anthropicAdapterClient.ts',
)

function createMockProvider(chunks = []) {
  return {
    streamChat: async function* (input) {
      for (const chunk of chunks) {
        yield chunk
      }
    },
    listModels() {
      return [
        {
          id: 'claude-sonnet-4-6',
          contextWindow: 200000,
          maxOutputTokens: 8192,
        },
      ]
    },
  }
}

function textResponseChunks(overrides = {}) {
  return [
    {
      type: 'response_start',
      messageId: overrides.messageId || 'msg_001',
      model: overrides.model || 'claude-sonnet-4-6',
      provider: 'firstParty',
    },
    { type: 'text_delta', text: 'Hello' },
    { type: 'text_delta', text: ' from' },
    { type: 'text_delta', text: ' ZCode' },
    {
      type: 'response_end',
      finishReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 3 },
    },
  ]
}

function toolUseResponseChunks(overrides = {}) {
  return [
    {
      type: 'response_start',
      messageId: overrides.messageId || 'msg_002',
      model: overrides.model || 'claude-sonnet-4-6',
      provider: 'firstParty',
    },
    { type: 'text_delta', text: 'Let me read that file.' },
    {
      type: 'tool_call',
      toolCall: {
        id: 'tool_001',
        type: 'function',
        name: 'FileRead',
        input: { filePath: '/tmp/test.txt' },
      },
    },
    {
      type: 'response_end',
      finishReason: 'tool_use',
      usage: { inputTokens: 15, outputTokens: 20 },
    },
  ]
}

function simplifyStreamEvent(event) {
  switch (event.type) {
    case 'message_start':
      return {
        type: event.type,
        messageId: event.message.id,
        model: event.message.model,
      }
    case 'content_block_start':
      return {
        type: event.type,
        index: event.index,
        blockType: event.content_block.type,
        name: event.content_block.name,
      }
    case 'content_block_delta':
      return {
        type: event.type,
        index: event.index,
        deltaType: event.delta.type,
        text: event.delta.text,
        partial_json: event.delta.partial_json,
      }
    case 'content_block_stop':
      return { type: event.type, index: event.index }
    case 'message_delta':
      return {
        type: event.type,
        stopReason: event.delta.stop_reason,
        inputTokens: event.usage?.input_tokens,
        outputTokens: event.usage?.output_tokens,
      }
    case 'message_stop':
      return { type: event.type }
    default:
      return { type: event.type }
  }
}

test('streaming withResponse yields Anthropic SSE events for text response', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider(textResponseChunks())
  const client = createAnthropicPassthroughClient({ provider })

  const result = await client.beta.messages
    .create({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 512,
      stream: true,
    })
    .withResponse()

  const events = []
  for await (const event of result.data) {
    events.push(event)
  }

  assert.equal(result.request_id, 'msg_001')

  assert.deepEqual(events.map(simplifyStreamEvent), [
    {
      type: 'message_start',
      messageId: 'msg_001',
      model: 'claude-sonnet-4-6',
    },
    {
      type: 'content_block_start',
      index: 0,
      blockType: 'text',
      name: undefined,
    },
    {
      type: 'content_block_delta',
      index: 0,
      deltaType: 'text_delta',
      text: 'Hello',
      partial_json: undefined,
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'content_block_start',
      index: 1,
      blockType: 'text',
      name: undefined,
    },
    {
      type: 'content_block_delta',
      index: 1,
      deltaType: 'text_delta',
      text: ' from',
      partial_json: undefined,
    },
    {
      type: 'content_block_stop',
      index: 1,
    },
    {
      type: 'content_block_start',
      index: 2,
      blockType: 'text',
      name: undefined,
    },
    {
      type: 'content_block_delta',
      index: 2,
      deltaType: 'text_delta',
      text: ' ZCode',
      partial_json: undefined,
    },
    {
      type: 'content_block_stop',
      index: 2,
    },
    {
      type: 'message_delta',
      stopReason: 'end_turn',
      inputTokens: 10,
      outputTokens: 3,
    },
    {
      type: 'message_stop',
    },
  ])
})

test('streaming withResponse yields tool_use events for tool calls', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider(toolUseResponseChunks())
  const client = createAnthropicPassthroughClient({ provider })

  const result = await client.beta.messages
    .create({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Read /tmp/test.txt' }],
      tools: [
        {
          name: 'FileRead',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { filePath: { type: 'string' } },
            required: ['filePath'],
          },
        },
      ],
      max_tokens: 512,
      stream: true,
    })
    .withResponse()

  const events = []
  for await (const event of result.data) {
    events.push(event)
  }

  const toolUseStart = events.find(
    e => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
  )
  assert.ok(toolUseStart, 'expected a tool_use content_block_start')
  assert.equal(toolUseStart.content_block.name, 'FileRead')
  assert.equal(toolUseStart.content_block.id, 'tool_001')

  const toolUseDelta = events.find(
    e =>
      e.type === 'content_block_delta' &&
      e.delta.type === 'input_json_delta',
  )
  assert.ok(toolUseDelta, 'expected an input_json_delta')
  assert.equal(
    toolUseDelta.delta.partial_json,
    '{"filePath":"/tmp/test.txt"}',
  )

  const messageDelta = events.find(e => e.type === 'message_delta')
  assert.equal(messageDelta.delta.stop_reason, 'tool_use')
})

test('non-streaming create resolves with a collected BetaMessage', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider(textResponseChunks())
  const client = createAnthropicPassthroughClient({ provider })

  const message = await client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 512,
  })

  assert.equal(message.id, 'msg_001')
  assert.equal(message.model, 'claude-sonnet-4-6')
  assert.equal(message.stop_reason, 'end_turn')
  assert.equal(message.role, 'assistant')
  assert.equal(message.type, 'message')
  assert.deepEqual(message.content, [
    { type: 'text', text: 'Hello from ZCode' },
  ])
  assert.equal(message.usage.input_tokens, 10)
  assert.equal(message.usage.output_tokens, 3)
})

test('non-streaming create result has .asResponse() on the promise', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider(textResponseChunks())
  const client = createAnthropicPassthroughClient({ provider })

  const result = client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 512,
  })

  // .asResponse() is attached to the promise-like object, accessible before await
  assert.equal(typeof result.asResponse, 'function')
  const response = await result.asResponse()
  assert.ok(response instanceof Response)

  // After awaiting, we get the plain message
  const message = await result
  assert.equal(message.id, 'msg_001')
})

test('streaming asResponse returns a Response', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider(textResponseChunks())
  const client = createAnthropicPassthroughClient({ provider })

  const streamResult = client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 512,
    stream: true,
  })

  const response = await streamResult.asResponse()
  assert.ok(response instanceof Response)
})

test('countTokens returns an estimated input token count', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider([])
  const client = createAnthropicPassthroughClient({ provider })

  const result = await client.beta.messages.countTokens({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Count these tokens please' }],
  })

  assert.equal(typeof result.input_tokens, 'number')
  assert.ok(result.input_tokens > 0, 'token count should be positive')
})

test('models.list yields models from the provider', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider([])
  const client = createAnthropicPassthroughClient({ provider })

  const models = []
  for await (const model of client.models.list()) {
    models.push(model)
  }

  assert.deepEqual(models, [
    {
      id: 'claude-sonnet-4-6',
      max_input_tokens: 200000,
      max_tokens: 8192,
    },
  ])
})

test('passthrough adapter passes system param through unchanged', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  let capturedInput = null
  const provider = {
    streamChat(input) {
      capturedInput = input
      return (async function* () {
        yield {
          type: 'response_start',
          messageId: 'msg_sys',
          model: 'claude-sonnet-4-6',
          provider: 'firstParty',
        }
        yield { type: 'text_delta', text: 'OK' }
        yield {
          type: 'response_end',
          finishReason: 'end_turn',
          usage: { inputTokens: 5, outputTokens: 1 },
        }
      })()
    },
    listModels() {
      return []
    },
  }

  const client = createAnthropicPassthroughClient({ provider })

  const _message = await client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    system: [
      { type: 'text', text: 'You are a helpful assistant.' },
      { type: 'text', text: 'Be concise.' },
    ],
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 128,
  })

  assert.deepEqual(capturedInput.system, [
    { type: 'text', text: 'You are a helpful assistant.' },
    { type: 'text', text: 'Be concise.' },
  ])
  assert.deepEqual(capturedInput.messages, [
    { role: 'user', content: 'Hi' },
  ])
  assert.equal(capturedInput.maxTokens, 128)
  assert.equal(capturedInput.model, 'claude-sonnet-4-6')
})

test('passthrough adapter passes tools through in native Anthropic format', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  let capturedInput = null
  const provider = {
    streamChat(input) {
      capturedInput = input
      return (async function* () {
        yield {
          type: 'response_start',
          messageId: 'msg_tools',
          model: 'claude-sonnet-4-6',
          provider: 'firstParty',
        }
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tool_x',
            type: 'function',
            name: 'BashTool',
            input: { command: 'ls' },
          },
        }
        yield {
          type: 'response_end',
          finishReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 15 },
        }
      })()
    },
    listModels() {
      return []
    },
  }

  const client = createAnthropicPassthroughClient({ provider })
  const tools = [
    {
      name: 'BashTool',
      description: 'Run shell commands',
      input_schema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  ]

  const _message = await client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'List files' }],
    tools,
    max_tokens: 256,
  })

  // Tools should pass through unchanged (no OpenAI function-format conversion)
  assert.deepEqual(capturedInput.tools, tools)
  assert.equal(capturedInput.tools[0].input_schema.type, 'object')
})

test('passthrough adapter merges defaultHeaders with request headers', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider(textResponseChunks({ messageId: 'msg_hdr' }))
  const client = createAnthropicPassthroughClient({
    provider,
    defaultHeaders: {
      'X-App': 'cli',
      'User-Agent': 'ZCode-Test',
    },
  })

  const result = await client.beta.messages
    .create(
      {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 128,
        stream: true,
      },
      {
        headers: { 'X-Request-Id': 'req-123' },
      },
    )
    .withResponse()

  // The response should carry merged headers
  const response = result.response
  assert.equal(response.headers.get('x-app'), 'cli')
  assert.equal(response.headers.get('user-agent'), 'ZCode-Test')
  assert.equal(response.headers.get('x-request-id'), 'req-123')
})

test('passthrough adapter handles empty stream gracefully', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider([])
  const client = createAnthropicPassthroughClient({ provider })

  const message = await client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 128,
  })

  assert.equal(message.role, 'assistant')
  assert.deepEqual(message.content, [])
  assert.equal(message.stop_reason, null)
})

test('passthrough adapter handles multiple tool calls in one response', async () => {
  const { createAnthropicPassthroughClient } = await loadModule(adapterModulePath)

  const provider = createMockProvider([
    {
      type: 'response_start',
      messageId: 'msg_multi',
      model: 'claude-sonnet-4-6',
      provider: 'firstParty',
    },
    {
      type: 'tool_call',
      toolCall: {
        id: 'tool_a',
        type: 'function',
        name: 'FileRead',
        input: { filePath: '/tmp/a.txt' },
      },
    },
    {
      type: 'tool_call',
      toolCall: {
        id: 'tool_b',
        type: 'function',
        name: 'Glob',
        input: { pattern: '*.js' },
      },
    },
    {
      type: 'response_end',
      finishReason: 'tool_use',
      usage: { inputTokens: 20, outputTokens: 60 },
    },
  ])
  const client = createAnthropicPassthroughClient({ provider })

  const message = await client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Read files' }],
    max_tokens: 512,
  })

  assert.equal(message.content.length, 2)
  assert.equal(message.content[0].type, 'tool_use')
  assert.equal(message.content[0].name, 'FileRead')
  assert.equal(message.content[1].type, 'tool_use')
  assert.equal(message.content[1].name, 'Glob')
  assert.equal(message.stop_reason, 'tool_use')
})
