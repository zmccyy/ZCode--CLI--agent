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
