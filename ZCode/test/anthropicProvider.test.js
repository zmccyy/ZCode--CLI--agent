import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'anthropic.js',
)

test('createAnthropicProvider exposes first-party models via provider contract', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider()
  const sonnet = provider
    .listModels()
    .find(model => model.id === 'claude-sonnet-4-6')

  assert.equal(provider.id, 'anthropic:firstParty')
  assert.equal(provider.kind, 'anthropic')
  assert.deepEqual(provider.getCapabilities(), {
    streaming: true,
    toolCalling: true,
    supportsJsonSchema: true,
  })
  assert.deepEqual(sonnet, {
    id: 'claude-sonnet-4-6',
    displayName: 'claude-sonnet-4-6',
    provider: 'firstParty',
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: {
      streaming: true,
      toolCalling: true,
      supportsJsonSchema: true,
    },
  })
})

test('createAnthropicProvider maps provider-specific Anthropic model IDs', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ provider: 'bedrock' })
  const sonnet = provider
    .listModels()
    .find(model => model.displayName === 'claude-sonnet-4-6')

  assert.deepEqual(sonnet, {
    id: 'us.anthropic.claude-sonnet-4-6',
    displayName: 'claude-sonnet-4-6',
    provider: 'bedrock',
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: {
      streaming: true,
      toolCalling: true,
      supportsJsonSchema: true,
    },
  })
})
