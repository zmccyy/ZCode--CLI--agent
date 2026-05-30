import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const anthropicModulePath = resolveFromHere(import.meta.url, '..', 'src', 'providers', 'anthropic.js')

const encoder = new TextEncoder()

function sseResponse(events) {
  const chunks = []
  for (const event of events) {
    const lines = []
    if (event.event) lines.push(`event: ${event.event}`)
    lines.push(`data: ${JSON.stringify(event.data)}`)
    chunks.push(lines.join('\n'))
  }
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk + '\n\n'))
        }
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

function buildTextResponse({ id = 'msg_s03', model = 'claude-sonnet-4-6', text = 'E2E response text', inputTokens = 10, outputTokens = 20 } = {}) {
  return [
    { event: 'message_start', data: { type: 'message_start', message: { id, model, role: 'assistant', usage: { input_tokens: inputTokens, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: inputTokens, output_tokens: outputTokens } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]
}

// ─── S03: single-turn conversation (anthropic line) ───

test('S03 streamChat returns complete response — response_start, text_delta, response_end in order', async () => {
  const { createAnthropicProvider } = await loadModule(anthropicModulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async (_url, _init) => sseResponse(buildTextResponse({ text: 'Hello, world!' })),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const types = chunks.map(c => c.type)
  assert.ok(types.indexOf('response_start') >= 0, 'should have response_start')
  assert.ok(types.indexOf('text_delta') >= 0, 'should have text_delta')
  assert.ok(types.indexOf('response_end') >= 0, 'should have response_end')

  const startIdx = types.indexOf('response_start')
  const endIdx = types.lastIndexOf('response_end')
  assert.ok(startIdx < endIdx, 'response_start should come before response_end')
})

test('S03 streamChat yields at least one text_delta for a text response', async () => {
  const { createAnthropicProvider } = await loadModule(anthropicModulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Query' }],
    fetch: async (_url, _init) => sseResponse(buildTextResponse({ text: 'A complete response.' })),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.ok(textChunks.length >= 1, 'should have at least one text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'A complete response.')
})

test('S03 streamChat response_start carries model and messageId', async () => {
  const { createAnthropicProvider } = await loadModule(anthropicModulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async (_url, _init) => sseResponse(buildTextResponse({ id: 'msg_abc123', model: 'claude-haiku-4-6' })),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const start = chunks.find(c => c.type === 'response_start')
  assert.ok(start, 'should have response_start')
  assert.equal(start.messageId, 'msg_abc123')
  assert.equal(start.model, 'claude-haiku-4-6')
})

test('S03 streamChat response_end carries finishReason and usage', async () => {
  const { createAnthropicProvider } = await loadModule(anthropicModulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async (_url, _init) => sseResponse(buildTextResponse({ inputTokens: 15, outputTokens: 35 })),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const end = chunks.find(c => c.type === 'response_end')
  assert.ok(end, 'should have response_end')
  assert.equal(end.finishReason, 'end_turn')
  assert.ok(end.usage, 'should carry usage')
  assert.equal(end.usage.inputTokens, 15)
  assert.equal(end.usage.outputTokens, 35)
  assert.equal(end.usage.totalTokens, 50)
})

test('S03 streamChat passes request model to the API', async () => {
  const { createAnthropicProvider } = await loadModule(anthropicModulePath)

  let capturedBody = null
  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  const stream = provider.streamChat({
    model: 'claude-opus-4-6',
    maxTokens: 2048,
    temperature: 0.3,
    messages: [{ role: 'user', content: 'Ping' }],
    fetch: async (_url, init) => {
      capturedBody = JSON.parse(init.body)
      return sseResponse(buildTextResponse())
    },
  })

  for await (const _ of stream) { /* drain */ }

  assert.equal(capturedBody.model, 'claude-opus-4-6')
  assert.equal(capturedBody.max_tokens, 2048)
  assert.equal(capturedBody.temperature, 0.3)
  assert.equal(capturedBody.stream, true)
})

test('S03 streamChat completes for multi-paragraph text response', async () => {
  const { createAnthropicProvider } = await loadModule(anthropicModulePath)

  const longText = 'First paragraph with useful content.\n\nSecond paragraph with more details.\n\nThird paragraph wrapping up.'
  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Explain something.' }],
    fetch: async (_url, _init) => sseResponse(buildTextResponse({ text: longText })),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  const text = textChunks.map(c => c.text).join('')
  assert.equal(text, longText)

  const end = chunks.find(c => c.type === 'response_end')
  assert.equal(end.finishReason, 'end_turn')
})

// ─── S05 / S11 already covered in phase2FirstWaveHarness.test.js ───
// These verify: shell permission surfaces (S05), allow/deny rules (S11)
