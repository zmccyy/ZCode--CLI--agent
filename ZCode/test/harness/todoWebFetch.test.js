import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { executeTodoWrite, parseTodos } from '../../src/harness/tools/todo.ts'
import {
  executeWebFetch,
  isPrivateAddress,
  htmlToText,
} from '../../src/harness/tools/webFetch.ts'
import { createCoreTools } from '../../src/harness/tools/index.ts'

function createContext() {
  return { cwd: process.cwd(), state: { readFiles: new Set() } }
}

// ── TodoWrite ──

test('todo: parseTodos enforces list shape and single in_progress', () => {
  assert.ok(parseTodos([]).error)
  assert.ok(parseTodos(undefined).error)
  assert.ok(parseTodos([{ content: '' }]).error)
  assert.ok(parseTodos([{ content: 'x', status: 'bogus' }]).error)
  assert.ok(
    parseTodos([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
    ]).error,
    'two in_progress rejected',
  )
  const ok = parseTodos([{ content: ' only-trimmed ' }])
  assert.deepEqual(ok.items, [{ content: 'only-trimmed', status: 'pending' }])
})

test('todo: execute replaces session state and renders a checklist', async () => {
  const context = createContext()
  const first = await executeTodoWrite(
    {
      todos: [
        { content: 'explore code', status: 'completed' },
        { content: 'write tests', status: 'in_progress' },
        { content: 'run suite' },
      ],
    },
    context,
  )
  assert.equal(first.isError, undefined)
  assert.match(first.content, /1 completed, 1 in progress, 1 pending/)
  assert.match(first.content, /☒ explore code/)
  assert.match(first.content, /◐ write tests/)
  assert.match(first.content, /☐ run suite/)
  assert.equal(context.state.todos.length, 3)

  const second = await executeTodoWrite(
    { todos: [{ content: 'write tests', status: 'completed' }] },
    context,
  )
  assert.equal(second.isError, undefined)
  assert.equal(context.state.todos.length, 1, 'latest call replaces the whole list')
})

test('todo: tool is read-only (works in plan mode) and registered in core tools', () => {
  const tools = createCoreTools()
  const todo = tools.find(tool => tool.name === 'TodoWrite')
  const webFetch = tools.find(tool => tool.name === 'WebFetch')
  assert.ok(todo, 'TodoWrite registered')
  assert.equal(todo.readOnly, true)
  assert.ok(webFetch, 'WebFetch registered')
  assert.equal(webFetch.readOnly, true)
  assert.equal(tools.length, 8, 'six v1 tools + TodoWrite + WebFetch')
})

// ── WebFetch: SSRF guards ──

test('webfetch: private address classifier covers IPv4 and IPv6 ranges', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.1.1',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:192.168.0.1',
    '999.1.1.1',
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} is private`)
  }
  for (const address of ['93.184.216.34', '172.32.0.1', '100.63.255.255', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert.equal(isPrivateAddress(address), false, `${address} is public`)
  }
})

test('webfetch: rejects non-http(s) schemes and credential URLs without network', async () => {
  const context = createContext()
  const fileResult = await executeWebFetch({ url: 'file:///etc/passwd' }, context)
  assert.equal(fileResult.isError, true)
  assert.match(fileResult.content, /only http and https/)

  const ftpResult = await executeWebFetch({ url: 'ftp://example.com/x' }, context)
  assert.equal(ftpResult.isError, true)

  const credResult = await executeWebFetch({ url: 'https://user:pass@example.com/' }, context)
  assert.equal(credResult.isError, true)
  assert.match(credResult.content, /credentials/)

  const missing = await executeWebFetch({}, context)
  assert.equal(missing.isError, true)
})

test('webfetch: refuses loopback and private hosts before any request', async () => {
  const context = createContext()
  let fetchCalled = false
  const deps = {
    fetchImpl: async () => {
      fetchCalled = true
    },
  }

  const loopback = await executeWebFetch({ url: 'http://localhost:8080/' }, context, deps)
  assert.equal(loopback.isError, true)
  assert.match(loopback.content, /loopback/)
  const rfc1918 = await executeWebFetch({ url: 'http://192.168.1.10/admin' }, context, deps)
  assert.equal(rfc1918.isError, true)
  assert.match(rfc1918.content, /private/)
  assert.equal(fetchCalled, false, 'no request was attempted')
})

test('webfetch: htmlToText strips scripts, tags, and decodes entities', () => {
  const text = htmlToText(
    '<html><head><style>p{color:red}</style><script>evil()</script></head>' +
      '<body><h1>Title&nbsp;&amp; more</h1><p>First<br>Second</p>' +
      '<p>Quotes: &quot;x&quot; &#39;y&#39; &lt;tag&gt;</p><!-- hidden --></body></html>',
  )
  assert.match(text, /^Title & more/)
  assert.match(text, /First\nSecond/)
  assert.match(text, /Quotes: "x" 'y' <tag>/)
  assert.doesNotMatch(text, /evil|color:red|hidden/)
})

// ── WebFetch: real HTTP round-trip against a local server ──
// The SSRF guard is bypassed via injected deps so the loopback server is
// reachable; production code paths (validation, redirect, capping, decoding)
// are exercised unchanged.

function createTestServer(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const bypassDeps = {
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  isPrivateAddress: () => false,
}

test('webfetch: fetches and converts an HTML page end-to-end', async () => {
  const server = await createTestServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><body><h1>ZCode Docs</h1><p>Content &amp; details</p></body></html>')
  })
  const { port } = server.address()
  const context = createContext()

  try {
    const result = await executeWebFetch({ url: `http://127.0.0.1:${port}/docs` }, context, bypassDeps)
    assert.equal(result.isError, undefined)
    assert.match(result.content, /Fetched http:\/\/127\.0\.0\.1:\d+\/docs \(HTTP 200, html→text\)/)
    assert.match(result.content, /ZCode Docs/)
    assert.match(result.content, /Content & details/)
  } finally {
    server.close()
  }
})

test('webfetch: follows redirects with re-validation and caps characters', async () => {
  const server = await createTestServer((req, res) => {
    if (req.url === '/old') {
      res.writeHead(302, { location: '/new' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('x'.repeat(1500))
  })
  const { port } = server.address()
  const context = createContext()

  try {
    const redirected = await executeWebFetch({ url: `http://127.0.0.1:${port}/old` }, context, bypassDeps)
    assert.equal(redirected.isError, undefined)
    assert.match(redirected.content, /\/new \(HTTP 200/)

    const capped = await executeWebFetch(
      { url: `http://127.0.0.1:${port}/new`, max_chars: 200 },
      context,
      bypassDeps,
    )
    assert.match(capped.content, /truncated to 200 of 1500/)
    assert.ok(capped.content.length < 1200, 'capped body is short')
  } finally {
    server.close()
  }
})

test('webfetch: reports HTTP errors and honors cancellation', async () => {
  const server = await createTestServer((req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('nope')
  })
  const { port } = server.address()

  try {
    const result = await executeWebFetch({ url: `http://127.0.0.1:${port}/missing` }, createContext(), bypassDeps)
    assert.equal(result.isError, true)
    assert.match(result.content, /HTTP 404/)

    const controller = new AbortController()
    const cancelContext = { cwd: process.cwd(), state: { readFiles: new Set() }, signal: controller.signal }
    controller.abort()
    const cancelled = await executeWebFetch(
      { url: `http://127.0.0.1:${port}/missing` },
      cancelContext,
      bypassDeps,
    )
    assert.equal(cancelled.isError, true)
    assert.match(cancelled.content, /cancelled/)
  } finally {
    server.close()
  }
})

test('webfetch: URL-only schema fields stay intact for the wire format', async () => {
  // toolsets are provider-facing: ensure the input schema advertises url + max_chars.
  const tools = createCoreTools()
  const webFetch = tools.find(tool => tool.name === 'WebFetch')
  assert.deepEqual(webFetch.inputSchema.required, ['url'])
  assert.ok(webFetch.inputSchema.properties.max_chars)
})

// ── Session-state sanity ──

test('todo state does not leak into fresh sessions', async () => {
  const first = createContext()
  await executeTodoWrite({ todos: [{ content: 'a' }] }, first)
  const second = createContext()
  assert.equal(second.state.todos, undefined)
  assert.ok(second.state.readFiles instanceof Set)
  // tmpdir usage keeps this suite hermetic.
  assert.ok((await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-todo-'))).length > 0)
})
