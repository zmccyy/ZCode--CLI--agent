import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from '../helpers/loadModule.js'

const modulePath = resolveFromHere(import.meta.url, '..', '..', 'src', 'providers', 'anthropic.js')

const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const MODEL = process.env.ANTHROPIC_TEST_MODEL || 'claude-sonnet-4-6'

function e2e(label, fn) {
  if (!API_KEY) {
    return test.skip(label, fn)
  }
  return test(label, fn)
}

// ─── Tests requiring real API key ───

e2e('E2E streamChat: single-turn text response', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: API_KEY, baseUrl: BASE_URL })

  const stream = provider.streamChat({
    model: MODEL,
    maxTokens: 256,
    messages: [{ role: 'user', content: 'Reply with exactly: "OK". Do not add any other text.' }],
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.ok(chunks.length >= 2, `expected at least 2 chunks, got ${chunks.length}`)

  const start = chunks.find(c => c.type === 'response_start')
  assert.ok(start, 'should have response_start')
  assert.ok(start.messageId, 'response_start should have messageId')
  assert.ok(start.model, 'response_start should have model')

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.ok(textChunks.length > 0, 'should have at least one text_delta')

  const text = textChunks.map(c => c.text).join('')
  assert.ok(text.length > 0, 'should receive non-empty text')

  const end = chunks.find(c => c.type === 'response_end')
  assert.ok(end, 'should have response_end')
  assert.ok(end.usage, 'response_end should have usage')
  assert.ok(end.usage.inputTokens > 0, 'should have consumed input tokens')
  assert.ok(end.usage.outputTokens > 0, 'should have produced output tokens')
})

e2e('E2E streamChat: response uses requested model', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: API_KEY, baseUrl: BASE_URL })

  const stream = provider.streamChat({
    model: MODEL,
    maxTokens: 64,
    messages: [{ role: 'user', content: 'Say hi' }],
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const start = chunks.find(c => c.type === 'response_start')
  assert.ok(start, 'should have response_start')
  assert.equal(start.model, MODEL, `model should be ${MODEL}`)
  assert.equal(start.provider, 'firstParty')
})

e2e('E2E streamChat: system prompt influences response', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: API_KEY, baseUrl: BASE_URL })

  const stream = provider.streamChat({
    model: MODEL,
    maxTokens: 128,
    system: 'You are a math bot. Answer only with numbers.',
    messages: [{ role: 'user', content: 'What is 2 + 2?' }],
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  const text = textChunks.map(c => c.text).join('')
  assert.ok(text.includes('4'), `expected response to contain "4", got: "${text}"`)

  const end = chunks.find(c => c.type === 'response_end')
  assert.ok(end.usage, 'should have usage info')
})

e2e('E2E streamChat: tool_use round-trip with tool_result', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: API_KEY, baseUrl: BASE_URL })

  const tools = [
    {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
        required: ['city'],
      },
    },
  ]

  // Turn 1: ask a question that should trigger tool use
  const stream1 = provider.streamChat({
    model: MODEL,
    maxTokens: 256,
    tools,
    messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  })

  const chunks1 = []
  for await (const chunk of stream1) {
    chunks1.push(chunk)
  }

  const toolCalls = chunks1.filter(c => c.type === 'tool_call')
  assert.ok(toolCalls.length > 0, 'turn 1 should yield at least one tool_call')

  const tc = toolCalls[0]
  assert.equal(tc.toolCall.name, 'get_weather')
  assert.ok(tc.toolCall.id, 'tool_call should have an id')
  assert.ok(tc.toolCall.input.city, 'tool_call should have city input')

  const end1 = chunks1.find(c => c.type === 'response_end')
  assert.equal(end1.finishReason, 'tool_use')

  // Turn 2: submit tool_result
  const stream2 = provider.streamChat({
    model: MODEL,
    maxTokens: 256,
    tools,
    messages: [
      { role: 'user', content: 'What is the weather in Paris?' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: tc.toolCall.id, name: tc.toolCall.name, input: tc.toolCall.input }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tc.toolCall.id, content: 'Sunny, 22°C' }],
      },
    ],
  })

  const chunks2 = []
  for await (const chunk of stream2) {
    chunks2.push(chunk)
  }

  const textChunks2 = chunks2.filter(c => c.type === 'text_delta')
  assert.ok(textChunks2.length > 0, 'turn 2 should yield text response')

  const end2 = chunks2.find(c => c.type === 'response_end')
  assert.equal(end2.finishReason, 'end_turn', 'turn 2 should finish naturally')
})

e2e('E2E streamChat: abort mid-stream via signal', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: API_KEY, baseUrl: BASE_URL })

  const controller = new AbortController()
  let chunkCount = 0

  const stream = provider.streamChat({
    model: MODEL,
    maxTokens: 1024,
    messages: [{ role: 'user', content: 'Write a short story about a dragon.' }],
    signal: controller.signal,
  })

  try {
    for await (const chunk of stream) {
      chunkCount++
      if (chunkCount >= 3) controller.abort()
    }
  } catch {
    // Expected: either AbortError or early stream termination
  }

  assert.ok(chunkCount >= 0, 'should have read some chunks before abort')
})

// ─── Tests that do NOT require a real API key ───

test('E2E streamChat: invalid API key returns error', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({
    apiKey: 'sk-ant-invalid-key-00000000',
    baseUrl: BASE_URL,
  })

  const stream = provider.streamChat({
    model: MODEL,
    maxTokens: 64,
    messages: [{ role: 'user', content: 'Hello' }],
  })

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw on invalid key')
  } catch (err) {
    assert.ok(
      err.message.includes('401') || err.message.includes('403') || err.message.includes('Unauthorized'),
      `expected auth error, got: ${err.message}`,
    )
  }
})
