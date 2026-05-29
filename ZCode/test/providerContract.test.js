import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'contracts',
  'providerAdapter.js',
)

test('normalizeModelDescriptor fills provider metadata defaults', async () => {
  const { normalizeModelDescriptor } = await loadModule(modulePath)

  const descriptor = normalizeModelDescriptor({
    id: 'qwen-plus',
    provider: 'qwen',
  })

  assert.deepEqual(descriptor, {
    id: 'qwen-plus',
    displayName: 'qwen-plus',
    provider: 'qwen',
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: {
      streaming: false,
      toolCalling: false,
      supportsJsonSchema: false,
    },
  })
})

test('normalizeToolCall parses OpenAI-compatible function calls', async () => {
  const { normalizeToolCall } = await loadModule(modulePath)

  const toolCall = normalizeToolCall({
    id: 'call_123',
    type: 'function',
    function: {
      name: 'write_file',
      arguments: '{"path":"README.md"}',
    },
  })

  assert.deepEqual(toolCall, {
    id: 'call_123',
    type: 'function',
    name: 'write_file',
    input: {
      path: 'README.md',
    },
  })
})

test('createProviderAdapter returns stable provider contract methods', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  const provider = createProviderAdapter({
    id: 'openai-compatible:qwen',
    kind: 'openai-compatible',
    provider: 'qwen',
    capabilities: {
      streaming: true,
      toolCalling: true,
    },
    listModels: () => [{ id: 'qwen-plus', displayName: 'Qwen Plus' }],
  })

  assert.equal(provider.id, 'openai-compatible:qwen')
  assert.equal(provider.kind, 'openai-compatible')
  assert.deepEqual(provider.getCapabilities(), {
    streaming: true,
    toolCalling: true,
    supportsJsonSchema: false,
  })
  assert.deepEqual(provider.listModels(), [
    {
      id: 'qwen-plus',
      displayName: 'Qwen Plus',
      provider: 'qwen',
      contextWindow: null,
      maxOutputTokens: null,
      capabilities: {
        streaming: true,
        toolCalling: true,
        supportsJsonSchema: false,
      },
    },
  ])
  assert.deepEqual(provider.normalizeToolCalls(undefined), [])
})

test('getCapabilities returns defaults when no capabilities in definition', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  const provider = createProviderAdapter({
    id: 'minimal:provider',
    kind: 'minimal',
  })

  assert.deepEqual(provider.getCapabilities(), {
    streaming: false,
    toolCalling: false,
    supportsJsonSchema: false,
  })
})

test('getCapabilities normalizes partial capabilities', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  const provider = createProviderAdapter({
    id: 'partial:provider',
    kind: 'partial',
    capabilities: {
      streaming: true,
    },
  })

  assert.deepEqual(provider.getCapabilities(), {
    streaming: true,
    toolCalling: false,
    supportsJsonSchema: false,
  })
})

test('validateConfig returns config as-is by default', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  const config = { apiKey: 'sk-abc', baseUrl: 'https://api.example.com' }
  const provider = createProviderAdapter({
    id: 'test:provider',
    kind: 'test',
    config,
  })

  const result = provider.validateConfig()
  assert.equal(result, config, 'default validateConfig should return config as-is')
  assert.deepEqual(result, config)
})

test('validateConfig passes explicit config to custom function', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  const provider = createProviderAdapter({
    id: 'custom:provider',
    kind: 'custom',
    config: { apiKey: '', baseUrl: 'https://default.example.com' },
    validateConfig(config) {
      const errors = []
      if (!config.apiKey) errors.push('apiKey is required')
      if (!config.baseUrl) errors.push('baseUrl is required')
      if (errors.length > 0) {
        return { valid: false, errors }
      }
      return { valid: true, config }
    },
  })

  const validResult = provider.validateConfig({
    apiKey: 'sk-xyz',
    baseUrl: 'https://custom.example.com',
  })
  assert.deepEqual(validResult, {
    valid: true,
    config: { apiKey: 'sk-xyz', baseUrl: 'https://custom.example.com' },
  })

  const invalidResult = provider.validateConfig({ apiKey: '' })
  assert.equal(invalidResult.valid, false)
  assert.ok(invalidResult.errors.includes('apiKey is required'))
})

test('validateConfig with custom function uses default config when called without args', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  let capturedConfig = null
  const provider = createProviderAdapter({
    id: 'capture:provider',
    kind: 'capture',
    config: { apiKey: 'default-key', baseUrl: 'https://api.example.com' },
    validateConfig(config) {
      capturedConfig = config
      return { ...config, validated: true }
    },
  })

  provider.validateConfig()
  assert.equal(capturedConfig.apiKey, 'default-key')
  assert.equal(capturedConfig.baseUrl, 'https://api.example.com')
})

test('streamChat throws when not implemented by provider definition', async () => {
  const { createProviderAdapter } = await loadModule(modulePath)

  const provider = createProviderAdapter({
    id: 'no-stream:provider',
    kind: 'no-stream',
  })

  try {
    const stream = provider.streamChat({ messages: [] })
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected streamChat to throw')
  } catch (err) {
    assert.match(err.message, /streamChat is not implemented/i)
  }
})
