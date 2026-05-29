import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'openaiCompatible.js',
)

test('createOpenAICompatibleProvider validates required config', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(modulePath)

  assert.throws(
    () =>
      createOpenAICompatibleProvider({
        provider: 'deepseek',
        model: 'deepseek-chat',
      }),
    /baseUrl/i,
  )
})

test('createOpenAICompatibleProvider exposes normalized capabilities', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(modulePath)

  const provider = createOpenAICompatibleProvider({
    provider: 'qwen',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'test-key',
  })

  assert.equal(provider.id, 'openai-compatible:qwen')
  assert.equal(provider.getCapabilities().toolCalling, true)
  assert.equal(provider.getCapabilities().streaming, true)
  assert.equal(provider.getCapabilities().supportsJsonSchema, true)

  const models = provider.listModels()
  assert.ok(models.length >= 1, 'should have at least the configured model')

  // Configured model must be first
  assert.equal(models[0].id, 'qwen-plus')
  assert.equal(models[0].displayName, 'qwen-plus')
  assert.equal(models[0].provider, 'qwen')
  assert.equal(models[0].capabilities.streaming, true)
  assert.equal(models[0].capabilities.toolCalling, true)
  assert.equal(models[0].capabilities.supportsJsonSchema, true)
})

test('createOpenAICompatibleProvider normalizes config and tool calls', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(modulePath)

  const provider = createOpenAICompatibleProvider({
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1///',
    apiKey: 'test-key',
    headers: {
      Authorization: 'Bearer test-key',
      Empty: '   ',
    },
  })

  assert.equal(provider.config.baseUrl, 'https://api.deepseek.com/v1')
  assert.deepEqual(provider.config.headers, {
    Authorization: 'Bearer test-key',
  })
  assert.equal(provider.config.timeout, 600000)
  assert.deepEqual(
    provider.normalizeToolCalls([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    ]),
    [
      {
        id: 'call_1',
        type: 'function',
        name: 'read_file',
        input: {
          path: 'README.md',
        },
      },
    ],
  )
})

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

test('createOpenAICompatibleProvider can stream chat completions through an OpenAI-compatible API', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(modulePath)

  const requests = []
  const provider = createOpenAICompatibleProvider({
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1///',
    apiKey: 'test-key',
    headers: {
      'X-Test': '1',
    },
  })

  const chunks = []
  const stream = provider.streamChat({
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
    maxTokens: 512,
    fetch: async (url, init) => {
      requests.push({
        url,
        init,
      })

      return createEventStreamResponse([
        JSON.stringify({
          id: 'chatcmpl_123',
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
                      arguments: '{"path"',
                    },
                  },
                ],
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
                    function: {
                      arguments: ':"README.md"}',
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

  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(requests[0]?.init?.method, 'POST')
  assert.deepEqual(requests[0]?.init?.headers, {
    Accept: 'text/event-stream',
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
    'X-Test': '1',
  })
  assert.deepEqual(JSON.parse(requests[0]?.init?.body), {
    model: 'deepseek-chat',
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
  assert.deepEqual(chunks, [
    {
      type: 'response_start',
      messageId: 'chatcmpl_123',
      model: 'deepseek-chat',
      provider: 'deepseek',
    },
    {
      type: 'text_delta',
      text: 'I can do that.',
    },
    {
      type: 'tool_call',
      toolCall: {
        id: 'call_1',
        type: 'function',
        name: 'read_file',
        input: {
          path: 'README.md',
        },
      },
    },
    {
      type: 'response_end',
      finishReason: 'tool_calls',
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
    },
  ])
})

test('createOpenAICompatibleProvider surfaces upstream API errors when streaming fails', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(modulePath)

  const provider = createOpenAICompatibleProvider({
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'test-key',
  })

  await assert.rejects(
    async () => {
      for await (const _chunk of provider.streamChat({
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'invalid api key',
              },
            }),
            {
              status: 401,
              headers: {
                'content-type': 'application/json',
              },
            },
          ),
      })) {
        // Exhaust the generator to trigger the request.
      }
    },
    /401.*invalid api key/i,
  )
})

test('createOpenAICompatibleProvider parses SSE streams that use CRLF separators', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(modulePath)

  const provider = createOpenAICompatibleProvider({
    provider: 'qwen',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'test-key',
  })

  const chunks = []
  for await (const chunk of provider.streamChat({
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    fetch: async () =>
      createEventStreamResponse(
        [
          JSON.stringify({
            id: 'chatcmpl_crlf',
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
        ],
        {
          separator: '\r\n\r\n',
        },
      ),
  })) {
    chunks.push(chunk)
  }

  assert.deepEqual(chunks, [
    {
      type: 'response_start',
      messageId: 'chatcmpl_crlf',
      model: 'qwen-plus',
      provider: 'qwen',
    },
    {
      type: 'text_delta',
      text: 'hello back',
    },
    {
      type: 'response_end',
      finishReason: 'stop',
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
      },
    },
  ])
})
