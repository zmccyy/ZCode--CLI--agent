/**
 * Fake MCP stdio server — a scripted MCP endpoint for hermetic tests.
 *
 * Speaks the P1.3 minimal subset: newline-delimited JSON-RPC 2.0 over stdio,
 * `initialize` handshake, `notifications/initialized`, `tools/list`,
 * `tools/call`, and `notifications/cancelled` (ignored — responses always
 * arrive, which is what the client's cancellation path tolerates).
 *
 * Scenarios (argv):
 *   --scenario noisy      emit malformed/garbage stdout lines around responses
 *   --scenario hang       never answer `initialize` (handshake timeout test)
 *   --scenario duplicate  advertise the `echo` tool twice (name-collision test)
 *   --scenario badversion reply to initialize with an unsupported version
 */

import readline from 'node:readline'

const scenarioFlag = process.argv.indexOf('--scenario')
const scenario = scenarioFlag === -1 ? 'default' : process.argv[scenarioFlag + 1]

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the provided text back with an "echo:" prefix.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text'],
    },
  },
  {
    name: 'fail',
    description: 'Always fails with a business error ("boom").',
    inputSchema: { type: 'object' },
  },
  {
    name: 'slow',
    description: 'Answers after the given delay (ms), then returns "slow:<ms>".',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'number' } },
      required: ['ms'],
    },
  },
  {
    name: 'big',
    description: 'Returns the requested number of bytes of output.',
    inputSchema: {
      type: 'object',
      properties: { bytes: { type: 'number' } },
      required: ['bytes'],
    },
  },
  {
    name: 'crash_me',
    description: 'Exits the server process without answering (crash tests).',
    inputSchema: { type: 'object' },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
  if (scenario === 'noisy') {
    // Garbage that must never be mistaken for a response or crash the client.
    process.stdout.write('this is not json\n')
    process.stdout.write('[200 OK] logged\n')
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callTool(name, args) {
  switch (name) {
    case 'echo':
      return { content: [{ type: 'text', text: `echo:${args?.text ?? ''}` }], isError: false }
    case 'fail':
      return { content: [{ type: 'text', text: 'boom' }], isError: true }
    case 'slow': {
      const ms = typeof args?.ms === 'number' ? args.ms : 1000
      await delay(ms)
      return { content: [{ type: 'text', text: `slow:${ms}` }], isError: false }
    }
    case 'big': {
      const bytes = typeof args?.bytes === 'number' ? Math.max(0, Math.floor(args.bytes)) : 0
      return { content: [{ type: 'text', text: 'x'.repeat(bytes) }], isError: false }
    }
    case 'crash_me':
      process.exit(1)
      return { content: [], isError: true }
    default:
      return {
        content: [{ type: 'text', text: `unknown tool: ${name}` }],
        isError: true,
      }
  }
}

function toolsForScenario() {
  if (scenario === 'duplicate') return [...TOOLS.filter(t => t.name !== 'crash_me'), TOOLS[0]]
  return TOOLS
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', line => {
  const trimmed = line.trim()
  if (trimmed === '') return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }
  if (!message || typeof message !== 'object') return

  if (message.method === 'initialize') {
    if (scenario === 'hang') return // never answer: handshake timeout test
    const version = scenario === 'badversion' ? '1999-01-01' : message.params?.protocolVersion
    reply(message.id, {
      protocolVersion: version,
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-mcp-server', version: '0.0.0' },
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    reply(message.id, { tools: toolsForScenario() })
    return
  }
  if (message.method === 'tools/call') {
    void callTool(message.params?.name, message.params?.arguments).then(result =>
      reply(message.id, result),
    )
    return
  }
  if (message.id !== undefined && message.id !== null) {
    reply(message.id, {})
  }
})

rl.on('close', () => process.exit(0))
// Parent died without closing stdin (hard kill path): exit anyway.
process.on('disconnect', () => process.exit(0))
