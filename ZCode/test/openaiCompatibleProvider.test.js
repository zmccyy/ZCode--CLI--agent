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
  assert.deepEqual(provider.listModels(), [
    {
      id: 'qwen-plus',
      displayName: 'qwen-plus',
      provider: 'qwen',
      contextWindow: null,
      maxOutputTokens: null,
      capabilities: {
        streaming: true,
        toolCalling: true,
        supportsJsonSchema: true,
      },
    },
  ])
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
