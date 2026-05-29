import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modelRegistryPath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'modelRegistry.js',
)
const oaiProviderPath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'openaiCompatible.js',
)
const runtimePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'providers',
  'runtime.js',
)

// ---------------------------------------------------------------------------
// 1. OpenAI-compatible listModels with catalog
// ---------------------------------------------------------------------------

test('openaiCompatible listModels returns all catalog models by default', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(oaiProviderPath)

  const provider = createOpenAICompatibleProvider({
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'test-key',
  })

  const models = provider.listModels()

  // Catalog has 11 canonical Claude models + 1 configured deepseek-chat
  assert.ok(models.length >= 11, `expected >=11 models, got ${models.length}`)

  const sonnet46 = models.find(m => m.id === 'claude-sonnet-4-6')
  assert.ok(sonnet46, 'should include claude-sonnet-4-6')
  assert.equal(sonnet46.displayName, 'claude-sonnet-4-6')
  assert.equal(sonnet46.provider, 'deepseek')

  const configured = models.find(m => m.id === 'deepseek-chat')
  assert.ok(configured, 'should include the configured model')
  assert.equal(configured.displayName, 'deepseek-chat')
})

test('openaiCompatible listModels falls back to single model when catalog disabled', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(oaiProviderPath)

  const provider = createOpenAICompatibleProvider(
    {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key',
    },
    { useCatalog: false },
  )

  const models = provider.listModels()
  assert.equal(models.length, 1)

  // Normalized descriptor includes capabilities + context metadata
  assert.equal(models[0].id, 'deepseek-chat')
  assert.equal(models[0].displayName, 'deepseek-chat')
  assert.equal(models[0].provider, 'deepseek')
  assert.equal(models[0].capabilities.streaming, true)
  assert.equal(models[0].capabilities.toolCalling, true)
})

test('openaiCompatible listModels does not duplicate configured model', async () => {
  const { createOpenAICompatibleProvider } = await loadModule(oaiProviderPath)

  const provider = createOpenAICompatibleProvider({
    provider: 'anthropic-proxy',
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://proxy.example.com/v1',
    apiKey: 'test-key',
  })

  const models = provider.listModels()
  const sonnet46Entries = models.filter(m => m.id === 'claude-sonnet-4-6')

  assert.equal(sonnet46Entries.length, 1, 'should not duplicate catalog entries')
})

// ---------------------------------------------------------------------------
// 2. createProviderModelRegistry with multiple providers
// ---------------------------------------------------------------------------

test('createProviderModelRegistry merges models from two openai-compatible providers', async () => {
  const { createProviderModelRegistry } = await loadModule(modelRegistryPath)
  const { createOpenAICompatibleProvider } = await loadModule(oaiProviderPath)

  const registry = createProviderModelRegistry([
    createOpenAICompatibleProvider({
      provider: 'qwen',
      model: 'qwen-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'test-key',
    }),
    createOpenAICompatibleProvider({
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key',
    }),
  ])

  // Each provider contributes its catalog models + configured model
  const qwenModels = registry.listByProvider('qwen')
  assert.ok(qwenModels.length >= 1)
  assert.ok(qwenModels.some(m => m.id === 'qwen-plus'))

  const deepseekModels = registry.listByProvider('deepseek')
  assert.ok(deepseekModels.length >= 1)
  assert.ok(deepseekModels.some(m => m.id === 'deepseek-chat'))

  // Total models should be both lines combined
  const all = registry.list()
  assert.ok(all.length >= 22, `expected >=22 dual-provider models, got ${all.length}`)
})

// ---------------------------------------------------------------------------
// 3. createDualLineModelRegistry
// ---------------------------------------------------------------------------

test('createDualLineModelRegistry includes Anthropic firstParty models with no openai config', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry({}, {})

  assert.equal(registry.has('claude-sonnet-4-6'), true)
  assert.equal(registry.has('claude-opus-4-6'), true)

  const firstPartyModels = registry.listByProvider('firstParty')
  assert.ok(firstPartyModels.length >= 11)
})

test('createDualLineModelRegistry includes both lines when openai-compatible configured', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    {
      openaiCompatible: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
      },
    },
    {},
  )

  // Anthropic models present (provider = firstParty)
  assert.equal(registry.has('claude-sonnet-4-6'), true)

  // OpenAI-compatible models present
  const deepseekModels = registry.listByProvider('deepseek')
  assert.ok(deepseekModels.length >= 1)

  // Configured model present
  assert.equal(registry.has('deepseek-chat'), true)

  // listByProvider discriminates correctly
  const firstPartyModels = registry.listByProvider('firstParty')
  assert.ok(firstPartyModels.length >= 11)

  const all = registry.list()
  assert.ok(all.length >= 23, `expected >=23 dual-line models, got ${all.length}`)
})

test('createDualLineModelRegistry with openai-compatible provider mode still includes Anthropic baseline', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    {
      provider: 'openai-compatible',
      openaiCompatible: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
      },
    },
    {},
  )

  // Must include Anthropic firstParty models as baseline
  assert.equal(registry.has('claude-sonnet-4-6'), true)

  // Must include OpenAI-compatible models
  assert.equal(registry.has('deepseek-chat'), true)
})

test('createDualLineModelRegistry with bedrock mode uses bedrock model IDs', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    { provider: 'bedrock' },
    { CLAUDE_CODE_USE_BEDROCK: '1' },
  )

  const bedrockModels = registry.listByProvider('bedrock')
  assert.ok(bedrockModels.length >= 11)

  const sonnet46 = registry.get('us.anthropic.claude-sonnet-4-6')
  assert.ok(sonnet46, 'should find bedrock sonnet 4.6 by ARN')
  assert.equal(sonnet46.displayName, 'claude-sonnet-4-6')
})

test('createDualLineModelRegistry with vertex mode uses vertex model IDs', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    { provider: 'vertex' },
    { CLAUDE_CODE_USE_VERTEX: '1' },
  )

  const vertexModels = registry.listByProvider('vertex')
  assert.ok(vertexModels.length >= 11)

  const sonnet46 = registry.get('claude-sonnet-4-6')
  assert.ok(sonnet46, 'should find vertex sonnet 4.6')
  assert.equal(sonnet46.displayName, 'claude-sonnet-4-6')
})

// ---------------------------------------------------------------------------
// 4. modelOverrides and availableModels with dual-line registry
// ---------------------------------------------------------------------------

test('createDualLineModelRegistry applies modelOverrides to both lines', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    {
      modelOverrides: {
        'claude-sonnet-4-6': 'my-custom-sonnet',
      },
      openaiCompatible: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
      },
    },
    {},
  )

  assert.equal(registry.has('my-custom-sonnet'), true)
  const overridden = registry.get('my-custom-sonnet')
  assert.equal(overridden.displayName, 'claude-sonnet-4-6')
})

test('createDualLineModelRegistry filters by availableModels', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    { availableModels: ['sonnet'] },
    {},
  )

  const all = registry.list()
  // Sonnet family: sonnet35, sonnet37, sonnet40, sonnet45, sonnet46
  assert.ok(all.length >= 3, `expected >=3 sonnet models, got ${all.length}`)

  const opusModels = all.filter(m => m.id.includes('opus'))
  assert.equal(opusModels.length, 0, 'should not include opus when only sonnet requested')
})

// ---------------------------------------------------------------------------
// 5. Backward compatibility
// ---------------------------------------------------------------------------

test('createModelRegistryFromSettings works for single-line Anthropic firstParty', async () => {
  const { createModelRegistryFromSettings } = await loadModule(runtimePath)

  const registry = createModelRegistryFromSettings({}, {})

  assert.equal(registry.has('claude-sonnet-4-6'), true)

  const models = registry.listByProvider('firstParty')
  assert.ok(models.length >= 11, `expected >=11, got ${models.length}`)
})

test('createModelRegistryFromSettings works for single-line openai-compatible', async () => {
  const { createModelRegistryFromSettings } = await loadModule(runtimePath)

  const registry = createModelRegistryFromSettings(
    {
      provider: 'openai-compatible',
      openaiCompatible: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
      },
    },
    {},
  )

  // listModels uses catalog, so includes 11 known models + configured
  const all = registry.list()
  assert.ok(all.length >= 11, `expected >=11 models, got ${all.length}`)
})

test('createProviderModelRegistry returns empty registry for empty providers', async () => {
  const { createProviderModelRegistry } = await loadModule(modelRegistryPath)

  const registry = createProviderModelRegistry([])
  assert.equal(registry.list().length, 0)
})

// ---------------------------------------------------------------------------
// 6. Foundry mode
// ---------------------------------------------------------------------------

test('createDualLineModelRegistry with foundry mode uses foundry model IDs', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  const registry = createDualLineModelRegistry(
    { provider: 'foundry' },
    { CLAUDE_CODE_USE_FOUNDRY: '1' },
  )

  const foundryModels = registry.listByProvider('foundry')
  assert.ok(foundryModels.length >= 11, `expected >=11 foundry models, got ${foundryModels.length}`)

  const sonnet46 = registry.get('claude-sonnet-4-6')
  assert.ok(sonnet46, 'should find foundry sonnet 4.6')
  assert.equal(sonnet46.displayName, 'claude-sonnet-4-6')
  assert.equal(sonnet46.provider, 'foundry')
})

// ---------------------------------------------------------------------------
// 7. Error resilience
// ---------------------------------------------------------------------------

test('createDualLineModelRegistry degrades gracefully with invalid openai config', async () => {
  const { createDualLineModelRegistry } = await loadModule(runtimePath)

  // openaiCompatible present but missing required fields — should not crash
  const registry = createDualLineModelRegistry(
    { openaiCompatible: {} },
    {},
  )

  // Should still have Anthropic firstParty baseline
  assert.equal(registry.has('claude-sonnet-4-6'), true)

  const firstPartyModels = registry.listByProvider('firstParty')
  assert.ok(firstPartyModels.length >= 11, `expected >=11 firstParty models, got ${firstPartyModels.length}`)
})
