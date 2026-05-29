import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const bridgeModulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'services',
  'api',
  'providerAdapterClient.ts',
)

const providerModulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'openaiCompatible.js',
)

function createEventStreamResponse(events, options = {}) {
  const encoder = new TextEncoder()
  const separator = options.separator || '\n\n'

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${event}${separator}`))
        }
        controller.close()
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
      },
    },
  )
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
      return {
        type: event.type,
        index: event.index,
      }
    case 'message_delta':
      return {
        type: event.type,
        stopReason: event.delta.stop_reason,
        inputTokens: event.usage?.input_tokens,
        outputTokens: event.usage?.output_tokens,
      }
    case 'message_stop':
      return {
        type: event.type,
      }
    default:
      return {
        type: event.type,
      }
  }
}

test('createProviderAdapterClient bridges Anthropic-style streaming requests into provider adapter streams', async () => {
  const [{ createProviderAdapterClient }, { createOpenAICompatibleProvider }] =
    await Promise.all([
      loadModule(bridgeModulePath),
      loadModule(providerModulePath),
    ])

  const requests = []
  const provider = createOpenAICompatibleProvider({
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'test-key',
  })

  const client = createProviderAdapterClient({
    provider,
    defaultHeaders: {
      'User-Agent': 'ZCode Test',
      'X-App': 'cli',
    },
    fetchOverride: async (url, init) => {
      requests.push({
        url,
        init,
      })

      return createEventStreamResponse([
        JSON.stringify({
          id: 'chatcmpl_bridge_1',
          model: 'deepseek-chat',
          choices: [
            {
              delta: {
                role: 'assistant',
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                content: 'I can do that.',
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }),
        '[DONE]',
      ])
    },
  })

  const result = await client.beta.messages
    .create({
      model: 'claude-sonnet-4-6',
      system: [
        {
          type: 'text',
          text: 'You are a helpful assistant.',
        },
      ],
      messages: [
        {
          role: 'user',
          content: 'Read README.md',
        },
      ],
      tools: [
        {
          name: 'read_file',
          description: 'Read a file from disk',
          input_schema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
              },
            },
            required: ['path'],
          },
        },
      ],
      max_tokens: 512,
      temperature: 0.2,
      stream: true,
    })
    .withResponse()

  const events = []
  for await (const event of result.data) {
    events.push(event)
  }

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.deepEqual(JSON.parse(requests[0]?.init?.body), {
    model: 'claude-sonnet-4-6',
    stream: true,
    stream_options: {
      include_usage: true,
    },
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant.',
      },
      {
        role: 'user',
        content: 'Read README.md',
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from disk',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
              },
            },
            required: ['path'],
          },
        },
      },
    ],
    temperature: 0.2,
    max_tokens: 512,
  })
  assert.equal(requests[0]?.init?.headers['User-Agent'], 'ZCode Test')
  assert.equal(requests[0]?.init?.headers['X-App'], 'cli')

  assert.deepEqual(events.map(simplifyStreamEvent), [
    {
      type: 'message_start',
      messageId: 'chatcmpl_bridge_1',
      model: 'deepseek-chat',
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
      text: 'I can do that.',
      partial_json: undefined,
    },
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'content_block_start',
      index: 1,
      blockType: 'tool_use',
      name: 'read_file',
    },
    {
      type: 'content_block_delta',
      index: 1,
      deltaType: 'input_json_delta',
      text: undefined,
      partial_json: '{"path":"README.md"}',
    },
    {
      type: 'content_block_stop',
      index: 1,
    },
    {
      type: 'message_delta',
      stopReason: 'tool_use',
      inputTokens: 12,
      outputTokens: 4,
    },
    {
      type: 'message_stop',
    },
  ])
})

test('createProviderAdapterClient can synthesize a non-streaming BetaMessage from provider streams', async () => {
  const [{ createProviderAdapterClient }, { createOpenAICompatibleProvider }] =
    await Promise.all([
      loadModule(bridgeModulePath),
      loadModule(providerModulePath),
    ])

  const provider = createOpenAICompatibleProvider({
    provider: 'qwen',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'test-key',
  })

  const client = createProviderAdapterClient({
    provider,
    fetchOverride: async () =>
      createEventStreamResponse([
        JSON.stringify({
          id: 'chatcmpl_bridge_2',
          model: 'qwen-plus',
          choices: [
            {
              delta: {
                content: 'hello back',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
          },
        }),
        '[DONE]',
      ]),
  })

  const message = await client.beta.messages.create({
    model: 'claude-sonnet-4-6',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    max_tokens: 128,
  })

  assert.equal(message.id, 'chatcmpl_bridge_2')
  assert.equal(message.model, 'qwen-plus')
  assert.equal(message.stop_reason, 'end_turn')
  assert.deepEqual(message.content, [
    {
      type: 'text',
      text: 'hello back',
    },
  ])
  assert.deepEqual(message.usage, {
    input_tokens: 5,
    output_tokens: 2,
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
  })
})

test('createProviderAdapterClient exposes countTokens and models.list compatibility helpers', async () => {
  const [{ createProviderAdapterClient }, { createOpenAICompatibleProvider }] =
    await Promise.all([
      loadModule(bridgeModulePath),
      loadModule(providerModulePath),
    ])

  const provider = createOpenAICompatibleProvider({
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'test-key',
  })

  const client = createProviderAdapterClient({ provider })
  const tokenCount = await client.beta.messages.countTokens({
    model: 'claude-sonnet-4-6',
    messages: [
      {
        role: 'user',
        content: 'Count these tokens',
      },
    ],
  })

  assert.equal(typeof tokenCount.input_tokens, 'number')
  assert.equal(tokenCount.input_tokens > 0, true)

  const models = []
  for await (const model of client.models.list()) {
    models.push(model)
  }

  assert.deepEqual(models, [
    { id: 'deepseek-chat' },
    { id: 'claude-3-5-haiku-20241022' },
    { id: 'claude-haiku-4-5-20251001' },
    { id: 'claude-3-5-sonnet-20241022' },
    { id: 'claude-3-7-sonnet-20250219' },
    { id: 'claude-sonnet-4-20250514' },
    { id: 'claude-sonnet-4-5-20250929' },
    { id: 'claude-sonnet-4-6' },
    { id: 'claude-opus-4-20250514' },
    { id: 'claude-opus-4-1-20250805' },
    { id: 'claude-opus-4-5-20251101' },
    { id: 'claude-opus-4-6' },
  ])
})
