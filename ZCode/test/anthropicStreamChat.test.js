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

const encoder = new TextEncoder()

function createAnthropicSSEResponse(events, options = {}) {
  const separator = options.separator || '\n\n'
  const chunks = []

  for (const event of events) {
    const lines = []
    if (event.event) {
      lines.push(`event: ${event.event}`)
    }
    lines.push(`data: ${JSON.stringify(event.data)}`)
    chunks.push(lines.join('\n'))
  }

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk + separator))
        }
        controller.close()
      },
    }),
    { status: options.status || 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

function textStream(overrides = {}) {
  const id = overrides.id || 'msg_001'
  const model = overrides.model || 'claude-sonnet-4-6'
  const text = overrides.text || 'Hello from Claude'
  return [
    { event: 'message_start', data: { type: 'message_start', message: { id, model, role: 'assistant', usage: { input_tokens: 10, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, output_tokens: 5 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]
}

function toolUseStream(overrides = {}) {
  const id = overrides.id || 'msg_002'
  const model = overrides.model || 'claude-sonnet-4-6'
  const toolName = overrides.toolName || 'BashTool'
  const toolInput = overrides.toolInput || { command: 'ls' }
  const toolId = overrides.toolId || 'tool_001'
  return [
    { event: 'message_start', data: { type: 'message_start', message: { id, model, role: 'assistant', usage: { input_tokens: 15, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 15, output_tokens: 30 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]
}

test('streamChat yields response_start text_delta response_end for basic text', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async (_url, _init) => createAnthropicSSEResponse(textStream()),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.ok(chunks.length >= 3, `expected at least 3 chunks, got ${chunks.length}`)

  const start = chunks[0]
  assert.equal(start.type, 'response_start')
  assert.equal(start.messageId, 'msg_001')
  assert.equal(start.model, 'claude-sonnet-4-6')
  assert.equal(start.provider, 'firstParty')

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.ok(textChunks.length > 0, 'expected at least one text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'Hello from Claude')

  const end = chunks[chunks.length - 1]
  assert.equal(end.type, 'response_end')
  assert.equal(end.finishReason, 'end_turn')
  assert.equal(end.usage.inputTokens, 10)
  assert.equal(end.usage.outputTokens, 5)
})

test('streamChat yields tool_call chunks for tool_use blocks', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'List files' }],
    tools: [{ name: 'BashTool', description: 'Run a shell command', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
    fetch: async (_url, _init) => createAnthropicSSEResponse(toolUseStream()),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const toolCalls = chunks.filter(c => c.type === 'tool_call')
  assert.equal(toolCalls.length, 1, `expected 1 tool_call, got ${toolCalls.length}`)

  const tc = toolCalls[0]
  assert.equal(tc.toolCall.name, 'BashTool')
  assert.equal(tc.toolCall.id, 'tool_001')
  assert.deepEqual(tc.toolCall.input, { command: 'ls' })

  const end = chunks[chunks.length - 1]
  assert.equal(end.type, 'response_end')
  assert.equal(end.finishReason, 'tool_use')
})

test('streamChat yields tool_call per content_block_stop for multiple tool_use blocks', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_003', model: 'claude-sonnet-4-6', role: 'assistant', usage: { input_tokens: 20, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure, let me do that.' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool_a', name: 'FileRead', input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"filePath":"/tmp/a.txt"}' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool_b', name: 'Glob', input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"pattern":"*.js"}' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 20, output_tokens: 60 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Read file and search' }],
    fetch: async (_url, _init) => createAnthropicSSEResponse(events),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const toolCalls = chunks.filter(c => c.type === 'tool_call')
  assert.equal(toolCalls.length, 2, `expected 2 tool_calls, got ${toolCalls.length}`)
  assert.equal(toolCalls[0].toolCall.name, 'FileRead')
  assert.equal(toolCalls[1].toolCall.name, 'Glob')
  assert.deepEqual(toolCalls[0].toolCall.input, { filePath: '/tmp/a.txt' })
  assert.deepEqual(toolCalls[1].toolCall.input, { pattern: '*.js' })

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'Sure, let me do that.')
})

test('streamChat accumulates fragmented input_json_delta across multiple deltas', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_004', model: 'claude-sonnet-4-6', role: 'assistant', usage: { input_tokens: 5, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_c', name: 'FileEdit', input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"filePath":"/tmp/x"' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ',"oldString":"hello"' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ',"newString":"world"}' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 5, output_tokens: 20 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Edit file' }],
    fetch: async (_url, _init) => createAnthropicSSEResponse(events),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const toolCalls = chunks.filter(c => c.type === 'tool_call')
  assert.equal(toolCalls.length, 1)
  assert.deepEqual(toolCalls[0].toolCall.input, {
    filePath: '/tmp/x',
    oldString: 'hello',
    newString: 'world',
  })
})

test('streamChat throws on non-2xx responses', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async (_url, _init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify({ error: { message: 'Invalid API key' } })))
            controller.close()
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  })

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw')
  } catch (err) {
    assert.match(err.message, /401/)
  }
})

test('streamChat throws when apiKey is missing', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider()
  try {
    const _stream = provider.streamChat({
      messages: [{ role: 'user', content: 'Hello' }],
    })
    assert.fail('expected streamChat to throw synchronously')
  } catch (err) {
    assert.match(err.message, /ANTHROPIC_API_KEY/i)
  }
})

test('streamChat supports CRLF separators in SSE', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    fetch: async (_url, _init) => createAnthropicSSEResponse(textStream({ text: 'CRLF works' }), { separator: '\r\n\r\n' }),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'CRLF works')
})

test('streamChat handles thinking content gracefully', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_005', model: 'claude-opus-4-6', role: 'assistant', usage: { input_tokens: 8, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think about this...' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig_abc' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'The answer is 42.' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 8, output_tokens: 25 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'What is the answer?' }],
    fetch: async (_url, _init) => createAnthropicSSEResponse(events),
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  // thinking content should not produce text_delta chunks
  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.equal(textChunks.length, 1, 'only the text block should yield text_delta, not thinking')
  assert.equal(textChunks[0].text, 'The answer is 42.')

  assert.ok(chunks.some(c => c.type === 'response_start'))
  assert.ok(chunks.some(c => c.type === 'response_end'))
})

test('streamChat sends input model in request body', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  let capturedBody = null
  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    model: 'claude-opus-4-6',
    maxTokens: 8192,
    temperature: 0.5,
    fetch: async (_url, init) => {
      capturedBody = JSON.parse(init.body)
      return createAnthropicSSEResponse(textStream())
    },
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.equal(capturedBody.model, 'claude-opus-4-6')
  assert.equal(capturedBody.max_tokens, 8192)
  assert.equal(capturedBody.temperature, 0.5)
  assert.ok(capturedBody.stream)

  const start = chunks.find(c => c.type === 'response_start')
  assert.equal(start.type, 'response_start')
})

test('streamChat aborts when signal is already aborted', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const controller = new AbortController()
  controller.abort()

  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    signal: controller.signal,
    fetch: async (_url, init) => {
      // Simulate what fetch does when signal is already aborted
      throw new DOMException('The operation was aborted', 'AbortError')
    },
  })

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw on aborted signal')
  } catch (err) {
    assert.ok(
      err.name === 'AbortError' || err.message.includes('abort'),
      `expected AbortError, got ${err.message}`,
    )
  }
})

test('streamChat aborts mid-stream when signal fires during iteration', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const controller = new AbortController()

  let chunkCount = 0
  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_abort', model: 'claude-sonnet-4-6', role: 'assistant', usage: { input_tokens: 5, output_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 5, output_tokens: 1 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]

  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    signal: controller.signal,
    fetch: async (_url, _init) => {
      const encoder = new TextEncoder()
      let cancelled = false
      return new Response(
        new ReadableStream({
          async start(ctrl) {
            for (const event of events) {
              if (cancelled) break
              const lines = []
              if (event.event) lines.push(`event: ${event.event}`)
              lines.push(`data: ${JSON.stringify(event.data)}`)
              ctrl.enqueue(encoder.encode(lines.join('\n') + '\n\n'))
              await new Promise(r => setTimeout(r, 5))
            }
            if (!cancelled) ctrl.close()
          },
          cancel() {
            cancelled = true
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })

  for await (const chunk of stream) {
    chunkCount++
    if (chunkCount >= 2) {
      controller.abort()
    }
  }

  // Should have stopped early, not consumed all 6 events
  assert.ok(chunkCount < events.length, `expected early abort, consumed ${chunkCount} chunks`)
})

test('streamChat passes signal through to fetch (merged with timeout)', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const controller = new AbortController()

  let capturedSignal = null
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    signal: controller.signal,
    fetch: async (_url, init) => {
      capturedSignal = init.signal
      return createAnthropicSSEResponse(textStream())
    },
  })

  for await (const _ of stream) { /* drain */ }

  assert.ok(capturedSignal instanceof AbortSignal, 'should pass an AbortSignal')
  assert.equal(capturedSignal.aborted, false, 'signal should not be aborted initially')
})

test('streamChat multi-turn: tool_use parsed then tool_result submitted for final text', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  let turn = 0

  function mockFetch(_url, init) {
    turn++
    const body = JSON.parse(init.body)
    const messages = body.messages || []

    if (turn === 1) {
      // Turn 1: return a tool_use for BashTool
      return createAnthropicSSEResponse(toolUseStream({
        id: 'msg_turn1',
        toolName: 'BashTool',
        toolInput: { command: 'ls' },
        toolId: 'tool_001',
      }))
    }

    // Turn 2: verify tool_result was passed in messages, return text
    const lastUserMsg = messages[messages.length - 1]
    assert.ok(lastUserMsg, 'turn 2 should have a user message')
    assert.equal(lastUserMsg.role, 'user')

    const hasToolResult = lastUserMsg.content.some(
      block => block.type === 'tool_result' && block.tool_use_id === 'tool_001',
    )
    assert.ok(hasToolResult, 'turn 2 should include tool_result for tool_001')

    return createAnthropicSSEResponse(textStream({
      id: 'msg_turn2',
      text: 'file1.txt\nfile2.txt',
    }))
  }

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  // Turn 1: request with tools, receive tool_use
  const stream1 = provider.streamChat({
    messages: [{ role: 'user', content: 'List files' }],
    tools: [{ name: 'BashTool', description: 'Run a shell command', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
    fetch: mockFetch,
  })

  const chunks1 = []
  for await (const chunk of stream1) {
    chunks1.push(chunk)
  }

  const toolCalls = chunks1.filter(c => c.type === 'tool_call')
  assert.equal(toolCalls.length, 1, 'turn 1 should yield one tool_call')
  assert.equal(toolCalls[0].toolCall.name, 'BashTool')
  assert.equal(toolCalls[0].toolCall.id, 'tool_001')
  assert.deepEqual(toolCalls[0].toolCall.input, { command: 'ls' })

  const end1 = chunks1[chunks1.length - 1]
  assert.equal(end1.type, 'response_end')
  assert.equal(end1.finishReason, 'tool_use')

  // Turn 2: submit tool_result, receive final text
  const stream2 = provider.streamChat({
    messages: [
      { role: 'user', content: 'List files' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_001', name: 'BashTool', input: { command: 'ls' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_001', content: 'file1.txt\nfile2.txt' }] },
    ],
    tools: [{ name: 'BashTool', description: 'Run a shell command', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
    fetch: mockFetch,
  })

  const chunks2 = []
  for await (const chunk of stream2) {
    chunks2.push(chunk)
  }

  const toolCalls2 = chunks2.filter(c => c.type === 'tool_call')
  assert.equal(toolCalls2.length, 0, 'turn 2 should have no tool_calls')

  const textChunks = chunks2.filter(c => c.type === 'text_delta')
  assert.ok(textChunks.length > 0, 'turn 2 should have text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'file1.txt\nfile2.txt')

  const end2 = chunks2[chunks2.length - 1]
  assert.equal(end2.type, 'response_end')
  assert.equal(end2.finishReason, 'end_turn')
})

// --- Timeout ---

test('streamChat throws on timeout before response', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    timeout: 50,
    fetch: async (_url, init) => {
      await new Promise((resolve, reject) => {
        const id = setTimeout(resolve, 99999)
        if (init.signal?.aborted) {
          clearTimeout(id)
          reject(new DOMException('The operation was aborted', 'AbortError'))
          return
        }
        init.signal?.addEventListener('abort', () => {
          clearTimeout(id)
          reject(new DOMException('The operation was aborted', 'AbortError'))
        }, { once: true })
      })
      return createAnthropicSSEResponse(textStream())
    },
  })

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw on timeout')
  } catch (err) {
    assert.ok(
      err.name === 'AbortError' || err.message.includes('abort') || err.name === 'TimeoutError',
      `expected AbortError or TimeoutError, got ${err.name}: ${err.message}`,
    )
  }
})

test('streamChat timeout mid-stream aborts early', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  function makeSignalAwareDelay(ms, signal) {
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms)
      if (signal?.aborted) {
        clearTimeout(id)
        reject(new DOMException('aborted', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => {
        clearTimeout(id)
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    })
  }

  let chunkCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    timeout: 120,
    fetch: async (_url, init) => {
      const signal = init.signal
      return new Response(
        new ReadableStream({
          async start(ctrl) {
            ctrl.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_tmo","model":"claude-sonnet-4-6","role":"assistant","usage":{"input_tokens":5,"output_tokens":0}}}\n\n'))
            try {
              await makeSignalAwareDelay(40, signal)
              ctrl.enqueue(encoder.encode('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'))
              await makeSignalAwareDelay(40, signal)
              ctrl.enqueue(encoder.encode('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"AB"}}\n\n'))
              // Timeout at 80ms should fire before this 99999ms delay completes
              await makeSignalAwareDelay(99999, signal)
            } catch {
              ctrl.error(new DOMException('aborted', 'AbortError'))
              return
            }
            ctrl.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })

  try {
    for await (const chunk of stream) {
      chunkCount++
    }
  } catch {
    // Expected: timeout aborts the stream
  }

  assert.ok(chunkCount < 6, `expected early timeout, consumed ${chunkCount} chunks`)
})

test('streamChat timeout and user abort signals can both trigger', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })
  const controller = new AbortController()

  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    timeout: 99999,
    signal: controller.signal,
    fetch: async (_url, init) => {
      await new Promise((resolve, reject) => {
        const id = setTimeout(resolve, 99999)
        if (init.signal?.aborted) {
          clearTimeout(id)
          reject(new DOMException('The operation was aborted', 'AbortError'))
          return
        }
        init.signal?.addEventListener('abort', () => {
          clearTimeout(id)
          reject(new DOMException('The operation was aborted', 'AbortError'))
        }, { once: true })
      })
      return createAnthropicSSEResponse(textStream())
    },
  })

  // User abort should win over long timeout
  setTimeout(() => controller.abort(), 30)

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw on user abort')
  } catch (err) {
    assert.ok(
      err.name === 'AbortError' || err.message.includes('abort'),
      `expected AbortError, got ${err.name}: ${err.message}`,
    )
  }
})

// --- Retry ---

test('streamChat retries on 5xx then succeeds', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 2,
    fetch: async (_url, _init) => {
      callCount++
      if (callCount === 1) {
        return new Response('Service Unavailable', { status: 503 })
      }
      return createAnthropicSSEResponse(textStream({ text: 'Recovered' }))
    },
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.equal(callCount, 2, 'should have retried once')
  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'Recovered')
})

test('streamChat retries on network error then succeeds', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 2,
    fetch: async (_url, _init) => {
      callCount++
      if (callCount === 1) {
        throw new TypeError('fetch failed')
      }
      return createAnthropicSSEResponse(textStream({ text: 'After network fix' }))
    },
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.equal(callCount, 2, 'should have retried once')
  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'After network fix')
})

test('streamChat does NOT retry on 4xx client errors', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 2,
    fetch: async (_url, _init) => {
      callCount++
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify({ error: { message: 'Bad request' } })))
            controller.close()
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    },
  })

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw')
  } catch (err) {
    assert.match(err.message, /400/)
  }

  assert.equal(callCount, 1, 'should NOT retry on 4xx')
})

test('streamChat respects maxRetries and gives up after exhausting retries', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 2,
    fetch: async (_url, _init) => {
      callCount++
      return new Response('Server Error', { status: 500 })
    },
  })

  try {
    for await (const _ of stream) { /* drain */ }
    assert.fail('expected stream to throw')
  } catch (err) {
    assert.match(err.message, /500/)
  }

  assert.equal(callCount, 3, 'should have tried 3 times (1 initial + 2 retries)')
})

test('streamChat retries on 429 with retry-after header', async () => {
  const { createAnthropicProvider } = await loadModule(modulePath)

  const provider = createAnthropicProvider({ apiKey: 'sk-test' })

  let callCount = 0
  const stream = provider.streamChat({
    messages: [{ role: 'user', content: 'Hello' }],
    maxRetries: 2,
    fetch: async (_url, _init) => {
      callCount++
      if (callCount === 1) {
        return new Response('Rate Limited', {
          status: 429,
          headers: { 'retry-after': '0.01' },
        })
      }
      return createAnthropicSSEResponse(textStream({ text: 'After rate limit' }))
    },
  })

  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  assert.equal(callCount, 2, 'should have retried once after 429')
  const textChunks = chunks.filter(c => c.type === 'text_delta')
  assert.equal(textChunks.map(c => c.text).join(''), 'After rate limit')
})
