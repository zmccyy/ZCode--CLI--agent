import test from 'node:test'
import assert from 'node:assert/strict'

import { createOpenAICompatibleProvider } from '../../src/providers/openaiCompatible.js'

/**
 * Retry behavior of the OpenAI-compatible provider — mirrored from the
 * Anthropic provider contract: 5xx/429 retried with exponential backoff
 * (retry-after honored), 4xx terminal, network errors retried, attempts
 * exhausted honestly.
 */

// Fake credential accepted by the overridden fetch; never a real secret.
const FAKE_API_KEY = process.env.ZCODE_TEST_FAKE_KEY || 'test'

const encoder = new TextEncoder()

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function sseResponse(events) {
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(sseChunk(event)))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function chatStreamEvents(text) {
  return [
    {
      id: 'chatcmpl-1',
      model: 'fake-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-1',
      model: 'fake-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    },
  ]
}

function createProvider(config = {}) {
  // The base URL is never contacted — every test overrides fetch.
  return createOpenAICompatibleProvider({
    provider: 'fake',
    model: 'fake-model',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: FAKE_API_KEY,
    ...config,
  })
}

async function collect(stream) {
  const chunks = []
  try {
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
  } catch (error) {
    return { chunks, error }
  }
  return { chunks, error: null }
}

test('streamChat retries on 5xx then succeeds', async () => {
  const provider = createProvider()

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async () => {
      callCount += 1
      if (callCount === 1) {
        return new Response('Service Unavailable', { status: 503 })
      }
      return sseResponse(chatStreamEvents('Recovered'))
    },
  })

  const { chunks, error } = await collect(stream)
  assert.equal(error, null)
  assert.equal(callCount, 2, 'should have retried once')
  const text = chunks.filter(chunk => chunk.type === 'text_delta').map(chunk => chunk.text).join('')
  assert.equal(text, 'Recovered')
})

test('streamChat retries on network error then succeeds', async () => {
  const provider = createProvider()

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async () => {
      callCount += 1
      if (callCount === 1) {
        throw new TypeError('fetch failed')
      }
      return sseResponse(chatStreamEvents('After network fix'))
    },
  })

  const { chunks, error } = await collect(stream)
  assert.equal(error, null)
  assert.equal(callCount, 2, 'should have retried once')
  const text = chunks.filter(chunk => chunk.type === 'text_delta').map(chunk => chunk.text).join('')
  assert.equal(text, 'After network fix')
})

test('streamChat does NOT retry on 4xx client errors', async () => {
  const provider = createProvider()

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async () => {
      callCount += 1
      return new Response(JSON.stringify({ error: { message: 'Bad request' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const { error } = await collect(stream)
  assert.match(error.message, /400/)
  assert.equal(callCount, 1, 'should NOT retry on 4xx')
})

test('streamChat respects maxRetries and gives up after exhausting retries', async () => {
  const provider = createProvider()

  let callCount = 0
  // 429 with a ~0s retry-after keeps the test fast while still exercising
  // the retryable-status path to exhaustion.
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 2,
    fetch: async () => {
      callCount += 1
      return new Response('Rate Limited', { status: 429, headers: { 'retry-after': '0.01' } })
    },
  })

  const { error } = await collect(stream)
  assert.match(error.message, /429/)
  assert.equal(callCount, 3, 'should have tried 3 times (1 initial + 2 retries)')
})

test('streamChat honors the retry-after header on 429', async () => {
  const provider = createProvider()

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async () => {
      callCount += 1
      if (callCount === 1) {
        return new Response('Rate Limited', { status: 429, headers: { 'retry-after': '0.01' } })
      }
      return sseResponse(chatStreamEvents('After rate limit'))
    },
  })

  const { chunks, error } = await collect(stream)
  assert.equal(error, null)
  assert.equal(callCount, 2)
  const text = chunks.filter(chunk => chunk.type === 'text_delta').map(chunk => chunk.text).join('')
  assert.equal(text, 'After rate limit')
})

test('config-level maxRetries: 0 disables retrying entirely', async () => {
  const provider = createProvider({ maxRetries: 0 })

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async () => {
      callCount += 1
      return new Response('Server Error', { status: 500 })
    },
  })

  const { error } = await collect(stream)
  assert.match(error.message, /500/)
  assert.equal(callCount, 1, 'should not retry when maxRetries is 0')
})
