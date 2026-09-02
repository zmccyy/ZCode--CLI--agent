/**
 * Fake LLM server — a scripted SSE server speaking either the OpenAI-compatible
 * or the Anthropic streaming dialect.
 *
 * Drives the REAL provider adapters → REAL agent loop → REAL tools in tests.
 * The script is a list of turns; request N gets script[N]. Each turn may
 * produce text, reasoning, and/or tool calls, optionally split across
 * multiple SSE chunks to exercise delta merging.
 */

import http from 'node:http'

function sseBlock(dialect, payload) {
  if (dialect === 'anthropic') {
    const event = payload.event || payload.data.type
    return `event: ${event}\ndata: ${JSON.stringify(payload.data)}\n\n`
  }
  return payload.done ? 'data: [DONE]\n\n' : `data: ${JSON.stringify(payload.data)}\n\n`
}

function openAiTurnChunks(turn, model) {
  const chunks = []
  const id = turn.id || `chatcmpl_fake_${Math.random().toString(36).slice(2, 10)}`
  const first = {
    id,
    model: turn.model || model,
    choices: [{ index: 0, delta: {}, finish_reason: null }],
  }

  if (turn.responseStart !== false) {
    chunks.push(first)
  }

  for (const piece of turn.textPieces || (turn.text ? [turn.text] : [])) {
    chunks.push({
      id,
      model: turn.model || model,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    })
  }

  for (const piece of turn.reasoningPieces || (turn.reasoning ? [turn.reasoning] : [])) {
    chunks.push({
      id,
      model: turn.model || model,
      choices: [{ index: 0, delta: { reasoning_content: piece }, finish_reason: null }],
    })
  }

  for (const call of turn.toolCalls || []) {
    const callId = call.id || `call_${Math.random().toString(36).slice(2, 10)}`
    const args = JSON.stringify(call.input ?? {})
    const splitAt = call.splitArguments === false ? args.length : Math.max(1, Math.floor(args.length / 2))
    // First delta carries id+name+first half of arguments; second carries the rest.
    chunks.push({
      id,
      model: turn.model || model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: call.index ?? 0,
                id: callId,
                type: 'function',
                function: { name: call.name, arguments: args.slice(0, splitAt) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })
    if (splitAt < args.length) {
      chunks.push({
        id,
        model: turn.model || model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: call.index ?? 0,
                  function: { arguments: args.slice(splitAt) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })
    }
  }

  const finishReason = turn.finishReason || (turn.toolCalls?.length ? 'tool_calls' : 'stop')
  chunks.push({
    id,
    model: turn.model || model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    usage: turn.usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })

  return chunks
}

function anthropicTurnBlocks(turn, model) {
  const messageId = turn.id || `msg_fake_${Math.random().toString(36).slice(2, 10)}`
  const blocks = []

  if (turn.text) {
    for (const piece of turn.textPieces || [turn.text]) {
      blocks.push({ kind: 'text_delta', text: piece })
    }
  }
  if (turn.reasoning) {
    blocks.push({ kind: 'thinking', text: turn.reasoning })
  }
  for (const [index, call] of (turn.toolCalls || []).entries()) {
    blocks.push({
      kind: 'tool_use',
      index,
      id: call.id || `toolu_${Math.random().toString(36).slice(2, 10)}`,
      name: call.name,
      input: call.input ?? {},
      splitArguments: call.splitArguments !== false,
    })
  }

  return { messageId, model: turn.model || model, blocks }
}

export function createFakeLlmServer({
  dialect = 'openai',
  script = [],
  apiKey = null,
  model = 'fake-model',
  status = 200,
  statusBody = null,
} = {}) {
  let requestCount = 0
  const requests = []
  const responses = []

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      let body
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = null
      }
      const request = { url: req.url, method: req.method, headers: req.headers, body }
      requests.push(request)

      const respond = (statusCode, contentType, payload) => {
        res.writeHead(statusCode, { 'content-type': contentType })
        res.end(payload)
      }

      if (status !== 200) {
        respond(status, 'application/json', statusBody ?? JSON.stringify({ error: { message: 'fake server error' } }))
        return
      }

      // ── Auth gate, mirroring real provider behavior ──
      if (apiKey !== null) {
        if (dialect === 'openai') {
          const authorization = req.headers.authorization || ''
          if (authorization !== `Bearer ${apiKey}`) {
            respond(401, 'application/json', JSON.stringify({ error: { message: 'invalid api key' } }))
            return
          }
        } else {
          const headerKey = req.headers['x-api-key'] || ''
          if (headerKey !== apiKey) {
            respond(401, 'application/json', JSON.stringify({ error: { message: 'invalid api key' } }))
            return
          }
        }
      }

      const turnIndex = requestCount
      requestCount += 1
      const turn = script[Math.min(turnIndex, script.length - 1)]

      if (!turn) {
        // Script exhausted: behave like a model that ends the conversation.
        turn = { text: '(fake server: script exhausted)', finishReason: 'stop' }
      }

      const record = { turnIndex, turn }
      responses.push(record)

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })

      const writeChunk = payload => {
        res.write(sseBlock(dialect, payload))
      }

      if (dialect === 'openai') {
        for (const data of openAiTurnChunks(turn, model)) {
          writeChunk({ data })
        }
        writeChunk({ done: true })
        res.end()
        return
      }

      // ── Anthropic dialect ──
      const { messageId, blocks } = anthropicTurnBlocks(turn, model)
      writeChunk({
        data: {
          type: 'message_start',
          message: {
            id: messageId,
            model,
            usage: { input_tokens: turn.usage?.input_tokens ?? 10, output_tokens: 1 },
          },
        },
      })

      let blockIndex = 0
      for (const block of blocks) {
        if (block.kind === 'text_delta') {
          writeChunk({ data: { type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } } })
          writeChunk({ data: { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: block.text } } })
          writeChunk({ data: { type: 'content_block_stop', index: blockIndex } })
        } else if (block.kind === 'thinking') {
          writeChunk({ data: { type: 'content_block_start', index: blockIndex, content_block: { type: 'thinking', thinking: '' } } })
          writeChunk({ data: { type: 'content_block_delta', index: blockIndex, delta: { type: 'thinking_delta', thinking: block.text } } })
          writeChunk({ data: { type: 'content_block_stop', index: blockIndex } })
        } else {
          writeChunk({
            data: {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'tool_use', id: block.id, name: block.name },
            },
          })
          const args = JSON.stringify(block.input)
          const pieces = block.splitArguments
            ? [args.slice(0, Math.max(1, Math.floor(args.length / 2))), args.slice(Math.max(1, Math.floor(args.length / 2)))]
            : [args]
          for (const piece of pieces) {
            if (piece === '') continue
            writeChunk({
              data: {
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'input_json_delta', partial_json: piece },
              },
            })
          }
          writeChunk({ data: { type: 'content_block_stop', index: blockIndex } })
        }
        blockIndex += 1
      }

      writeChunk({
        data: {
          type: 'message_delta',
          delta: { stop_reason: turn.finishReason || (turn.toolCalls?.length ? 'tool_use' : 'end_turn') },
          usage: turn.usage || { input_tokens: 10, output_tokens: 5 },
        },
      })
      writeChunk({ data: { type: 'message_stop' } })
      res.end()
    })
  })

  let listenPromise = null

  return {
    get url() {
      return `http://127.0.0.1:${server.address()?.port ?? 0}`
    },
    /** Base URL configured for the OpenAI-compatible provider (adds /v1). */
    get openaiBaseUrl() {
      return `${this.url}/v1`
    },
    /** Base URL configured for the Anthropic provider (it appends /v1/messages). */
    get anthropicBaseUrl() {
      return this.url
    },
    get requests() {
      return requests
    },
    get responses() {
      return responses
    },
    get requestCount() {
      return requestCount
    },
    listen() {
      if (!listenPromise) {
        listenPromise = new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => resolve())
        })
      }
      return listenPromise
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    },
  }
}
