import test from 'node:test'
import assert from 'node:assert/strict'

import {
  toOpenAIMessages,
  toOpenAITools,
  toAnthropicMessages,
  toAnthropicTools,
  translateRequest,
  resolveDialect,
} from '../../src/harness/translate.ts'

const SCHEMA = { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] }

test('OpenAI translation: system, tool calls, and tool results', () => {
  const messages = [
    { role: 'user', content: 'do it' },
    { role: 'assistant', text: null, toolCalls: [{ id: 'call_1', name: 'Read', input: { file_path: 'a.ts' } }] },
    { role: 'tool', toolCallId: 'call_1', toolName: 'Read', content: 'file content' },
    { role: 'assistant', text: 'finished', toolCalls: [] },
  ]

  const wire = toOpenAIMessages('be terse', messages)

  assert.deepEqual(wire[0], { role: 'system', content: 'be terse' })
  assert.deepEqual(wire[1], { role: 'user', content: 'do it' })
  assert.equal(wire[2].role, 'assistant')
  assert.equal(wire[2].content, null)
  assert.deepEqual(wire[2].tool_calls, [
    { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
  ])
  assert.deepEqual(wire[3], { role: 'tool', tool_call_id: 'call_1', content: 'file content' })
  assert.deepEqual(wire[4], { role: 'assistant', content: 'finished' })
})

test('OpenAI translation synthesizes ids for calls missing one', () => {
  const wire = toOpenAIMessages(null, [
    { role: 'assistant', text: null, toolCalls: [{ id: null, name: 'Bash', input: { command: 'ls' } }] },
  ])
  assert.match(wire[0].tool_calls[0].id, /^toolu_synth_/)
  assert.equal(wire[0].tool_calls[0].function.name, 'Bash')
})

test('OpenAI tools wire format', () => {
  const wire = toOpenAITools([
    { name: 'Read', description: 'reads', inputSchema: SCHEMA, readOnly: true, execute: () => ({ content: '' }) },
  ])
  assert.deepEqual(wire, [
    { type: 'function', function: { name: 'Read', description: 'reads', parameters: SCHEMA } },
  ])
})

test('Anthropic translation: tool_use blocks and merged tool_result user turns', () => {
  const messages = [
    { role: 'user', content: 'do it' },
    { role: 'assistant', text: 'thinking aloud', toolCalls: [{ id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } }] },
    { role: 'tool', toolCallId: 'toolu_1', toolName: 'Read', content: 'file content' },
    { role: 'tool', toolCallId: 'toolu_2', toolName: 'Grep', content: 'no matches', isError: true },
    { role: 'assistant', text: null, toolCalls: [{ id: 'toolu_3', name: 'Bash', input: { command: 'ls' } }] },
  ]

  const wire = toAnthropicMessages('be terse', messages)

  assert.equal(wire.length, 4)
  assert.deepEqual(wire[0], { role: 'user', content: 'do it' })

  assert.deepEqual(wire[1].role, 'assistant')
  assert.deepEqual(wire[1].content, [
    { type: 'text', text: 'thinking aloud' },
    { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } },
  ])

  // Consecutive tool results merge into ONE user message.
  assert.equal(wire[2].role, 'user')
  assert.equal(wire[2].content.length, 2)
  assert.deepEqual(wire[2].content[0], { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file content' })
  assert.deepEqual(wire[2].content[1], {
    type: 'tool_result',
    tool_use_id: 'toolu_2',
    content: 'no matches',
    is_error: true,
  })

  // An assistant message ends the merged run; the next result starts a new user turn.
  assert.deepEqual(wire[3].role, 'assistant')
  assert.equal(wire[3].content.length, 1)
  assert.deepEqual(wire[3].content[0].type, 'tool_use')
})

test('Anthropic tools wire format and system passthrough', () => {
  const tools = [
    { name: 'Read', description: 'reads', inputSchema: SCHEMA, readOnly: true, execute: () => ({ content: '' }) },
  ]
  const wire = toAnthropicTools(tools)
  assert.deepEqual(wire, [{ name: 'Read', description: 'reads', input_schema: SCHEMA }])

  const translated = translateRequest({
    dialect: 'anthropic',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    tools,
  })
  assert.equal(translated.system, 'sys')
  assert.equal(translated.tools[0].input_schema, SCHEMA)
  assert.equal(translated.messages.length, 1)

  const emptySystem = translateRequest({
    dialect: 'anthropic',
    system: '   ',
    messages: [],
    tools: tools,
  })
  assert.equal(emptySystem.system, null)
})

test('resolveDialect infers the wire dialect from provider kind', () => {
  assert.equal(resolveDialect({ kind: 'openai-compatible' }), 'openai')
  assert.equal(resolveDialect({ kind: 'anthropic' }), 'anthropic')
  assert.equal(resolveDialect({}), 'openai')
})
