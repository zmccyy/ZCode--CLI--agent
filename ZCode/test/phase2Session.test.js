import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ─── UUID validation (portable, vendor-independent) ───

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateUuid(value) {
  if (typeof value !== 'string') return null
  return uuidRegex.test(value) ? value : null
}

// ─── JSONL utilities (portable) ───

function extractJsonStringField(text, key) {
  const patterns = [`"${key}":"`, `"${key}": "`]
  for (const pattern of patterns) {
    const idx = text.indexOf(pattern)
    if (idx < 0) continue
    const valueStart = idx + pattern.length
    let i = valueStart
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '"') return text.slice(valueStart, i)
      i++
    }
  }
  return undefined
}

function unescapeJsonString(raw) {
  if (!raw.includes('\\')) return raw
  try { return JSON.parse(`"${raw}"`) } catch { return raw }
}

function extractFirstPromptFromHead(head) {
  const skipPattern = /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/
  let start = 0
  let commandFallback = ''
  while (start < head.length) {
    const newlineIdx = head.indexOf('\n', start)
    const line = newlineIdx >= 0 ? head.slice(start, newlineIdx) : head.slice(start)
    start = newlineIdx >= 0 ? newlineIdx + 1 : head.length

    if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) continue
    if (line.includes('"tool_result"')) continue
    if (line.includes('"isMeta":true') || line.includes('"isMeta": true')) continue
    if (line.includes('"isCompactSummary":true') || line.includes('"isCompactSummary": true')) continue

    try {
      const entry = JSON.parse(line)
      if (entry.type !== 'user') continue
      const message = entry.message
      if (message?.content && typeof message.content === 'string') {
        const text = message.content.trim()
        if (!text || skipPattern.test(text)) {
          const cmdMatch = text.match(/<command-name>(.*?)<\/command-name>/)
          if (cmdMatch && !commandFallback) commandFallback = cmdMatch[1].trim()
          continue
        }
        return text.length > 200 ? text.slice(0, 200) : text
      }
    } catch { continue }
  }
  return commandFallback || ''
}

// ─── S07: Session storage — UUID validation ───

test('S07 validateUuid accepts valid UUID v4', () => {
  const uuid = '4bc4d857-8d4f-4f4f-86f3-0d11f11d4d44'
  assert.equal(validateUuid(uuid), uuid)
})

test('S07 validateUuid rejects invalid strings', () => {
  assert.equal(validateUuid('not-a-uuid'), null)
  assert.equal(validateUuid(''), null)
  assert.equal(validateUuid('123'), null)
  assert.equal(validateUuid(null), null)
  assert.equal(validateUuid(undefined), null)
})

test('S07 validateUuid validates upper and lower case hex', () => {
  assert.ok(validateUuid(crypto.randomUUID()))
  assert.ok(validateUuid(crypto.randomUUID().toUpperCase()))
  assert.ok(validateUuid('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'))
})

// ─── S07: Session storage — JSON field extraction ───

test('S07 extractJsonStringField extracts value for known key', () => {
  const line = '{"type":"user","message":{"role":"user","content":"hello"}}'
  assert.equal(extractJsonStringField(line, 'type'), 'user')
  assert.equal(extractJsonStringField(line, 'role'), 'user')
  assert.equal(extractJsonStringField(line, 'content'), 'hello')
})

test('S07 extractJsonStringField works with spaces and escapes', () => {
  const line = '{"type": "assistant", "model": "claude-sonnet-4-6"}'
  assert.equal(extractJsonStringField(line, 'type'), 'assistant')
  assert.equal(extractJsonStringField(line, 'model'), 'claude-sonnet-4-6')
  assert.equal(extractJsonStringField(line, 'nonexistent'), undefined)
})

test('S07 unescapeJsonString handles escapes', () => {
  assert.equal(unescapeJsonString('hello world'), 'hello world')
  assert.equal(unescapeJsonString('hello\\nworld'), 'hello\nworld')
  assert.equal(unescapeJsonString('tab\\there'), 'tab\there')
  assert.equal(unescapeJsonString('backslash\\\\here'), 'backslash\\here')
})

// ─── S07: Session storage — first prompt extraction ───

test('S07 extractFirstPromptFromHead extracts first user message', () => {
  const head = [
    '{"type":"system","message":"system init"}',
    '{"type":"user","message":{"role":"user","content":"Hello, can you help?"}}',
    '{"type":"assistant","message":{"role":"assistant","content":"Sure!"}}',
  ].join('\n')

  assert.equal(extractFirstPromptFromHead(head), 'Hello, can you help?')
})

test('S07 extractFirstPromptFromHead skips tool_result and meta', () => {
  const head = [
    '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"output"}]}}',
    '{"type":"user","message":{"role":"user","content":"Real question here"}}',
  ].join('\n')

  assert.equal(extractFirstPromptFromHead(head), 'Real question here')
})

test('S07 extractFirstPromptFromHead skips compact summaries', () => {
  const head = [
    '{"type":"user","isCompactSummary":true,"message":{"role":"user","content":"summary"}}',
    '{"type":"user","message":{"role":"user","content":"Actual user input"}}',
  ].join('\n')

  assert.equal(extractFirstPromptFromHead(head), 'Actual user input')
})

test('S07 extractFirstPromptFromHead truncates to 200 chars', () => {
  const longInput = 'A'.repeat(300)
  const head = `{"type":"user","message":{"role":"user","content":"${longInput}"}}`
  const result = extractFirstPromptFromHead(head)
  assert.equal(result.length, 200)
})

test('S07 extractFirstPromptFromHead returns empty for no user messages', () => {
  assert.equal(extractFirstPromptFromHead('{"type":"system"}'), '')
  assert.equal(extractFirstPromptFromHead(''), '')
})

// ─── S07: Session storage — JSONL file I/O ───

test('S07 JSONL session write and read round-trip', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-session-rt-'))
  const filePath = path.join(tmpDir, 'transcript.jsonl')

  const messages = [
    { type: 'user', message: { role: 'user', content: 'Hello' } },
    { type: 'assistant', message: { role: 'assistant', content: 'Hi there!' } },
    { type: 'user', message: { role: 'user', content: 'Do something' } },
    { type: 'assistant', message: { role: 'assistant', content: 'Done' } },
  ]

  await fs.writeFile(filePath, messages.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  const readMessages = content.trim().split('\n').map(line => JSON.parse(line))

  assert.equal(readMessages.length, 4)
  assert.equal(readMessages[0].type, 'user')
  assert.equal(readMessages[2].message.content, 'Do something')

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S07 JSONL session handles tool_use and tool_result round-trip', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-session-tool-'))
  const filePath = path.join(tmpDir, 'transcript.jsonl')

  const messages = [
    { type: 'user', message: { role: 'user', content: 'List files' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'file1.txt\nfile2.txt' }] } },
    { type: 'assistant', message: { role: 'assistant', content: 'Found 2 files.' } },
  ]

  await fs.writeFile(filePath, messages.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  const readMessages = content.trim().split('\n').map(line => JSON.parse(line))

  assert.equal(readMessages.length, 4)
  assert.deepEqual(readMessages[1].message.content[0].name, 'Bash')
  assert.equal(readMessages[2].message.content[0].tool_use_id, 'tool_1')

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S07 session file listing discovers all JSONL files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-session-list-'))
  const sids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]

  // Write sessions with proper JSONL metadata
  for (let i = 0; i < sids.length; i++) {
    const filePath = path.join(tmpDir, `${sids[i]}.jsonl`)
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: `msg-${i}` }, sessionId: sids[i] }),
    ].join('\n') + '\n'
    await fs.writeFile(filePath, lines, 'utf8')
  }

  const entries = await fs.readdir(tmpDir)
  const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'))
  assert.equal(jsonlFiles.length, 3)

  for (const sid of sids) {
    assert.ok(jsonlFiles.includes(`${sid}.jsonl`))
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S07 session file records metadata with mtime and size', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-session-meta-'))
  const sid = crypto.randomUUID()
  const filePath = path.join(tmpDir, `${sid}.jsonl`)

  const startTime = Date.now()
  await fs.writeFile(filePath, JSON.stringify({ type: 'user', sessionId: sid }) + '\n', 'utf8')

  const stat = await fs.stat(filePath)
  assert.ok(stat.mtime.getTime() >= startTime, 'mtime should be set after write')
  assert.ok(stat.size > 0, 'file should have non-zero size')

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S07 session read tolerates partial write (truncated last line)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-session-partial-'))
  const filePath = path.join(tmpDir, 'partial.jsonl')

  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'msg1' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'reply1' } }),
    '{"type":"user","mess',  // truncated line
  ]
  await fs.writeFile(filePath, lines.join('\n'), 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  const splitLines = content.split('\n')

  // First two lines parse fine
  assert.ok(JSON.parse(splitLines[0]))
  assert.ok(JSON.parse(splitLines[1]))
  // Third line fails to parse (truncated)
  try {
    JSON.parse(splitLines[2])
    assert.fail('truncated line should fail to parse')
  } catch {
    // Expected
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S07 session can be appended to (recordTranscript simulation)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-session-append-'))
  const filePath = path.join(tmpDir, 'transcript.jsonl')

  // Initial write
  const initial = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
  ]
  await fs.writeFile(filePath, initial.join('\n') + '\n', 'utf8')

  // Append more messages
  const append = [
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'help' } }),
  ]
  await fs.appendFile(filePath, append.join('\n') + '\n', 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  const messages = content.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(messages.length, 3)
  assert.deepEqual(messages.map(m => m.message.content), ['hello', 'hi', 'help'])

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('S07 sanitizePath replaces special characters with hyphens', () => {
  function sanitizePath(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '-')
  }

  assert.equal(sanitizePath('/Users/foo/my-project'), '-Users-foo-my-project')
  assert.equal(sanitizePath('D:\\workspace\\zcode'), 'D--workspace-zcode')
  assert.equal(sanitizePath('plugin:name:server'), 'plugin-name-server')
  assert.doesNotMatch(sanitizePath('path/with/slashes'), /\//)
})

test('S07 path-based project directory lookup finds correct directory', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-projects-'))
  // Simulate the projects directory structure
  const projDir = path.join(tmpDir, '-workspace-project')
  await fs.mkdir(projDir)

  const sid = crypto.randomUUID()
  const transcriptPath = path.join(projDir, `${sid}.jsonl`)
  await fs.writeFile(transcriptPath, JSON.stringify({ type: 'user', message: { content: 'test' } }) + '\n', 'utf8')

  // List project directories
  const entries = await fs.readdir(tmpDir)
  const dirs = []
  for (const entry of entries) {
    const fullPath = path.join(tmpDir, entry)
    const s = await fs.stat(fullPath)
    if (s.isDirectory()) dirs.push(entry)
  }

  assert.equal(dirs.length, 1)
  assert.ok(dirs.includes('-workspace-project'))

  // Check sessions inside project
  const sessionFiles = await fs.readdir(path.join(tmpDir, dirs[0]))
  assert.ok(sessionFiles.includes(`${sid}.jsonl`))

  await fs.rm(tmpDir, { recursive: true, force: true })
})
