import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'modelRegistry.js',
)

test('createModelRegistry indexes models by id and provider', async () => {
  const { createModelRegistry } = await loadModule(modulePath)

  const registry = createModelRegistry([
    {
      id: 'qwen-plus',
      displayName: 'Qwen Plus',
      provider: 'qwen',
    },
    {
      id: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      provider: 'deepseek',
    },
  ])

  assert.equal(registry.has('qwen-plus'), true)
  assert.equal(registry.has('missing-model'), false)
  assert.deepEqual(registry.get('deepseek-chat'), {
    id: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    provider: 'deepseek',
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: {
      streaming: false,
      toolCalling: false,
      supportsJsonSchema: false,
    },
  })
  assert.deepEqual(registry.listByProvider('qwen'), [
    {
      id: 'qwen-plus',
      displayName: 'Qwen Plus',
      provider: 'qwen',
      contextWindow: null,
      maxOutputTokens: null,
      capabilities: {
        streaming: false,
        toolCalling: false,
        supportsJsonSchema: false,
      },
    },
  ])
})

test('createProviderModelRegistry flattens provider adapters into one registry', async () => {
  const { createProviderModelRegistry } = await loadModule(modulePath)
  const { createOpenAICompatibleProvider } = await loadModule(
    resolveFromHere(
      import.meta.url,
      '..',
      'src',
      'providers',
      'openaiCompatible.js',
    ),
  )

  const registry = createProviderModelRegistry([
    createOpenAICompatibleProvider({
      provider: 'qwen',
      model: 'qwen-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'test-key',
    }),
  ])

  assert.deepEqual(registry.get('qwen-plus'), {
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
  })
})
