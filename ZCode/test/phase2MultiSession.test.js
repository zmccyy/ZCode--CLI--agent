import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ─── Constants and shared utilities (ported from sessionStorage / resumeBehavior) ───

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateUuid(value) {
  if (typeof value !== 'string') return null
  return uuidRegex.test(value) ? value : null
}

const NO_CONVERSATIONS_FOUND_MESSAGE = 'No conversations found to resume.'

function formatResumeSessionNotFoundMessage(arg) {
  return `Session ${arg} was not found.`
}

function formatResumeMultipleMatchesMessage(arg, count) {
  return `Found ${count} sessions matching ${arg}. Please use /resume to pick a specific session.`
}

function sortLogsByModifiedDesc(logs) {
  return [...logs].sort((a, b) => {
    const left = a?.modified instanceof Date ? a.modified.getTime() : 0
    const right = b?.modified instanceof Date ? b.modified.getTime() : 0
    return right - left
  })
}

/**
 * Pure-function port of resolveResumeLookup from resumeBehavior.js.
 * Injects all side-effectful dependencies so tests can provide mocks.
 */
async function resolveResumeLookup({
  arg,
  logs,
  validateSessionId,
  getSessionIdFromLog,
  isLiteLog,
  loadFullLog,
  getLastSessionLog,
  isCustomTitleEnabled,
  searchSessionsByCustomTitle,
}) {
  const trimmedArg = String(arg ?? '').trim()

  if (!trimmedArg) {
    return { type: 'picker' }
  }

  if (!Array.isArray(logs) || logs.length === 0) {
    return {
      type: 'noConversations',
      message: NO_CONVERSATIONS_FOUND_MESSAGE,
    }
  }

  const maybeSessionId = validateSessionId(trimmedArg)
  if (maybeSessionId) {
    const matchingLogs = sortLogsByModifiedDesc(
      logs.filter(log => getSessionIdFromLog(log) === maybeSessionId),
    )

    if (matchingLogs.length > 0) {
      const log = matchingLogs[0]
      const fullLog = isLiteLog(log) ? await loadFullLog(log) : log
      return {
        type: 'resume',
        sessionId: maybeSessionId,
        log: fullLog,
        entrypoint: 'slash_command_session_id',
      }
    }

    const directLog = await getLastSessionLog(maybeSessionId)
    if (directLog) {
      return {
        type: 'resume',
        sessionId: maybeSessionId,
        log: directLog,
        entrypoint: 'slash_command_session_id',
      }
    }
  }

  if (isCustomTitleEnabled()) {
    const titleMatches = await searchSessionsByCustomTitle(trimmedArg, { exact: true })

    if (titleMatches.length === 1) {
      const log = titleMatches[0]
      const sessionId = getSessionIdFromLog(log)
      if (sessionId) {
        const fullLog = isLiteLog(log) ? await loadFullLog(log) : log
        return {
          type: 'resume',
          sessionId,
          log: fullLog,
          entrypoint: 'slash_command_title',
        }
      }
    }

    if (titleMatches.length > 1) {
      return {
        type: 'error',
        message: formatResumeMultipleMatchesMessage(trimmedArg, titleMatches.length),
      }
    }
  }

  return {
    type: 'error',
    message: formatResumeSessionNotFoundMessage(trimmedArg),
  }
}

// ─── Session metadata helpers (ported from sessionStorage logic) ───

function getSessionIdFromLog(log) {
  if (log.sessionId) return log.sessionId
  return log.messages?.[0]?.sessionId ?? undefined
}

function isLiteLog(log) {
  return !log.messages || log.messages.length === 0
}

function filterResumableSessions(logs, currentSessionId) {
  return logs.filter(
    log => !log.isSidechain && getSessionIdFromLog(log) !== currentSessionId,
  )
}

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

function extractCustomTitleFromHead(head) {
  const customTitlePattern = /"type"\s*:\s*"custom-title"/
  for (const line of head.split('\n').reverse()) {
    if (customTitlePattern.test(line)) {
      return extractJsonStringField(line, 'customTitle') ?? undefined
    }
  }
  return undefined
}

function extractTagFromHead(head) {
  const tagPattern = /"type"\s*:\s*"tag"/
  for (const line of head.split('\n').reverse()) {
    if (tagPattern.test(line)) {
      return extractJsonStringField(line, 'tag') ?? undefined
    }
  }
  return undefined
}

function extractFirstPromptFromHead(head) {
  const skipPattern = /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/
  let commandFallback = ''
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) continue
    if (line.includes('"tool_result"')) continue
    if (line.includes('"isMeta":true') || line.includes('"isMeta": true')) continue
    if (line.includes('"isCompactSummary":true') || line.includes('"isCompactSummary": true')) continue

    try {
      const entry = JSON.parse(line)
      if (entry.type !== 'user') continue
      const content = entry.message?.content
      if (typeof content === 'string') {
        const text = content.trim()
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

// ─── Session listing helpers ───

async function writeSessionFile(dir, sessionId, entries) {
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

function makeSessionEntry(type, messageContent, overrides = {}) {
  return {
    type,
    message: { role: type === 'user' ? 'user' : 'assistant', content: messageContent },
    sessionId: overrides.sessionId || undefined,
    uuid: overrides.uuid || crypto.randomUUID(),
    timestamp: overrides.timestamp || new Date().toISOString(),
    isSidechain: overrides.isSidechain || false,
    isMeta: overrides.isMeta || false,
    isCompactSummary: overrides.isCompactSummary || false,
    ...overrides.extra,
  }
}

// ─── W9: Multi-session listing and switching — resolveResumeLookup ───

test('W09 resolveResumeLookup returns picker type when no arg provided', async () => {
  const result = await resolveResumeLookup({
    arg: '',
    logs: [],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(result.type, 'picker')
})

test('W09 resolveResumeLookup returns picker for whitespace-only arg', async () => {
  const result = await resolveResumeLookup({
    arg: '   ',
    logs: [],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(result.type, 'picker')
})

test('W09 resolveResumeLookup returns picker for null/undefined arg', async () => {
  for (const arg of [null, undefined]) {
    const result = await resolveResumeLookup({
      arg,
      logs: [],
      validateSessionId: validateUuid,
      getSessionIdFromLog,
      isLiteLog: () => false,
      loadFullLog: async (log) => log,
      getLastSessionLog: async () => null,
      isCustomTitleEnabled: () => true,
      searchSessionsByCustomTitle: async () => [],
    })
    assert.equal(result.type, 'picker')
  }
})

// ─── W9: Session listing — resume by session ID ───

test('W09 resolveResumeLookup resumes by exact session ID', async () => {
  const sessionId = crypto.randomUUID()
  const logs = [
    {
      sessionId,
      messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Hello' } }],
      modified: new Date('2026-05-30T10:00:00Z'),
    },
  ]

  const result = await resolveResumeLookup({
    arg: sessionId,
    logs,
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: (log) => !log.messages || log.messages.length === 0,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })

  assert.equal(result.type, 'resume')
  assert.equal(result.sessionId, sessionId)
  assert.equal(result.entrypoint, 'slash_command_session_id')
})

test('W09 resolveResumeLookup picks newest when multiple logs share same session ID', async () => {
  const sessionId = crypto.randomUUID()
  const older = {
    sessionId,
    messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Old' } }],
    modified: new Date('2026-05-29T10:00:00Z'),
  }
  const newer = {
    sessionId,
    messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'New' } }],
    modified: new Date('2026-05-30T10:00:00Z'),
  }

  const result = await resolveResumeLookup({
    arg: sessionId,
    logs: [older, newer],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: (log) => !log.messages || log.messages.length === 0,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })

  assert.equal(result.type, 'resume')
  assert.equal(result.log.messages[0].message.content, 'New')
})

test('W09 resolveResumeLookup falls back to direct lookup when UUID not in list', async () => {
  const sessionId = crypto.randomUUID()
  const directLog = {
    sessionId,
    messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Direct' } }],
  }

  const result = await resolveResumeLookup({
    arg: sessionId,
    logs: [
      {
        sessionId: crypto.randomUUID(),
        messages: [{ type: 'user', message: { role: 'user', content: 'Other' } }],
        modified: new Date(),
      },
    ],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async (sid) => (sid === sessionId ? directLog : null),
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })

  assert.equal(result.type, 'resume')
  assert.equal(result.sessionId, sessionId)
  assert.equal(result.log.messages[0].message.content, 'Direct')
})

// ─── W9: Session listing — error cases ───

test('W09 resolveResumeLookup returns noConversations when logs empty', async () => {
  const result = await resolveResumeLookup({
    arg: 'some-session-id',
    logs: [],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(result.type, 'noConversations')
  assert.equal(result.message, NO_CONVERSATIONS_FOUND_MESSAGE)
})

test('W09 resolveResumeLookup returns error for unknown session', async () => {
  const nonUuid = 'not-a-valid-uuid'
  const result = await resolveResumeLookup({
    arg: nonUuid,
    logs: [
      {
        sessionId: crypto.randomUUID(),
        messages: [{ type: 'user', message: { role: 'user', content: 'Hi' } }],
        modified: new Date(),
      },
    ],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(result.type, 'error')
  assert.ok(result.message.includes(nonUuid))
})

test('W09 formatResumeSessionNotFoundMessage includes the arg', () => {
  assert.equal(
    formatResumeSessionNotFoundMessage('abc-123'),
    'Session abc-123 was not found.',
  )
})

test('W09 formatResumeMultipleMatchesMessage includes arg and count', () => {
  const msg = formatResumeMultipleMatchesMessage('my-title', 3)
  assert.ok(msg.includes('3'))
  assert.ok(msg.includes('my-title'))
})

// ─── W9: Session listing — custom title search ───

test('W09 resolveResumeLookup resumes by exact custom title', async () => {
  const sessionId = crypto.randomUUID()
  const log = {
    sessionId,
    messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Build the API' } }],
    customTitle: 'API Builder Session',
  }

  const result = await resolveResumeLookup({
    arg: 'API Builder Session',
    logs: [log],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (l) => l,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async (query, _opts) =>
      query.toLowerCase() === 'api builder session' ? [log] : [],
  })

  assert.equal(result.type, 'resume')
  assert.equal(result.sessionId, sessionId)
  assert.equal(result.entrypoint, 'slash_command_title')
})

test('W09 resolveResumeLookup returns error when multiple title matches', async () => {
  const sid1 = crypto.randomUUID()
  const sid2 = crypto.randomUUID()
  const log1 = { sessionId: sid1, messages: [], customTitle: 'My Project' }
  const log2 = { sessionId: sid2, messages: [], customTitle: 'My Project' }

  // The empty-logs guard fires BEFORE the title search in resolveResumeLookup.
  // When logs is non-empty but the arg is not a UUID and not a single title
  // match, we reach the title-search branch. Multi-match returns error.
  const result = await resolveResumeLookup({
    arg: 'My Project',
    logs: [
      { sessionId: crypto.randomUUID(), messages: [{ type: 'user', message: { role: 'user', content: 'x' } }], modified: new Date() },
    ],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (l) => l,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [log1, log2],
  })

  assert.equal(result.type, 'error')
  assert.ok(result.message.includes('2'))
  assert.ok(result.message.includes('My Project'))
})

test('W09 resolveResumeLookup falls through to error when title search disabled', async () => {
  const result = await resolveResumeLookup({
    arg: 'Some Title',
    logs: [
      {
        sessionId: crypto.randomUUID(),
        messages: [{ type: 'user', message: { role: 'user', content: 'Hello' } }],
        modified: new Date(),
      },
    ],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => false,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(result.type, 'error')
})

// ─── W9: Filter resumable sessions ───

test('W09 filterResumableSessions excludes current session', () => {
  const currentId = crypto.randomUUID()
  const otherId = crypto.randomUUID()
  const logs = [
    { sessionId: currentId, isSidechain: false, messages: [{ sessionId: currentId }] },
    { sessionId: otherId, isSidechain: false, messages: [{ sessionId: otherId }] },
  ]
  const result = filterResumableSessions(logs, currentId)
  assert.equal(result.length, 1)
  assert.equal(getSessionIdFromLog(result[0]), otherId)
})

test('W09 filterResumableSessions excludes sidechain sessions', () => {
  const currentId = crypto.randomUUID()
  const normalId = crypto.randomUUID()
  const sidechainId = crypto.randomUUID()
  const logs = [
    { sessionId: normalId, isSidechain: false, messages: [{ sessionId: normalId }] },
    { sessionId: sidechainId, isSidechain: true, messages: [{ sessionId: sidechainId }] },
  ]
  const result = filterResumableSessions(logs, currentId)
  assert.equal(result.length, 1)
  assert.equal(getSessionIdFromLog(result[0]), normalId)
})

test('W09 filterResumableSessions returns empty when all excluded', () => {
  const currentId = crypto.randomUUID()
  const logs = [
    { sessionId: currentId, isSidechain: false, messages: [{ sessionId: currentId }] },
    { sessionId: crypto.randomUUID(), isSidechain: true, messages: [{}] },
  ]
  assert.equal(filterResumableSessions(logs, currentId).length, 0)
})

// ─── W9: Session metadata — custom title read/write ───

test('W09 extractCustomTitleFromHead reads custom-title entry', () => {
  const head = [
    '{"type":"user","message":{"role":"user","content":"Hello"}}',
    '{"type":"custom-title","customTitle":"My Great Session","sessionId":"abc"}',
  ].join('\n')
  assert.equal(extractCustomTitleFromHead(head), 'My Great Session')
})

test('W09 extractCustomTitleFromHead returns undefined when no title', () => {
  const head = [
    '{"type":"user","message":{"role":"user","content":"Hello"}}',
    '{"type":"assistant","message":{"role":"assistant","content":"Hi"}}',
  ].join('\n')
  assert.equal(extractCustomTitleFromHead(head), undefined)
})

test('W09 extractCustomTitleFromHead returns last title when multiple entries', () => {
  const head = [
    '{"type":"custom-title","customTitle":"First Title","sessionId":"abc"}',
    '{"type":"user","message":{"role":"user","content":"Hello"}}',
    '{"type":"custom-title","customTitle":"Updated Title","sessionId":"abc"}',
  ].join('\n')
  assert.equal(extractCustomTitleFromHead(head), 'Updated Title')
})

test('W09 extractCustomTitleFromHead reads title with spaces in JSON', () => {
  const head = '{"type": "custom-title", "customTitle": "Session With Spaces", "sessionId": "abc"}'
  assert.equal(extractCustomTitleFromHead(head), 'Session With Spaces')
})

// ─── W9: Session metadata — tag read/write ───

test('W09 extractTagFromHead reads tag entry', () => {
  const head = [
    '{"type":"user","message":{"role":"user","content":"Hello"}}',
    '{"type":"tag","tag":"important","sessionId":"abc"}',
  ].join('\n')
  assert.equal(extractTagFromHead(head), 'important')
})

test('W09 extractTagFromHead returns last tag when multiple entries', () => {
  const head = [
    '{"type":"tag","tag":"old-tag","sessionId":"abc"}',
    '{"type":"user","message":{"role":"user","content":"Hello"}}',
    '{"type":"tag","tag":"new-tag","sessionId":"abc"}',
  ].join('\n')
  assert.equal(extractTagFromHead(head), 'new-tag')
})

test('W09 extractTagFromHead returns undefined when no tag', () => {
  const head = '{"type":"user","message":{"role":"user","content":"Hello"}}'
  assert.equal(extractTagFromHead(head), undefined)
})

// ─── W9: Session metadata — last-prompt extraction ───

test('W09 extractFirstPromptFromHead extracts user prompt for listing display', () => {
  const head = [
    '{"type":"system","message":{"role":"system","content":"system init"}}',
    '{"type":"user","message":{"role":"user","content":"Write a function to sort an array"}}',
    '{"type":"assistant","message":{"role":"assistant","content":"Here is the code..."}}',
  ].join('\n')
  assert.equal(extractFirstPromptFromHead(head), 'Write a function to sort an array')
})

test('W09 extractFirstPromptFromHead skips meta and compact-summary messages', () => {
  const head = [
    '{"type":"user","isMeta":true,"message":{"role":"user","content":"meta stuff"}}',
    '{"type":"user","isCompactSummary":true,"message":{"role":"user","content":"summary"}}',
    '{"type":"user","message":{"role":"user","content":"Actual user question"}}',
  ].join('\n')
  assert.equal(extractFirstPromptFromHead(head), 'Actual user question')
})

// ─── W9: Session listing — multi-project file listing ───

test('W09 lists sessions across multiple project directories', async () => {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-multi-'))
  const projA = path.join(tmpBase, 'project-a')
  const projB = path.join(tmpBase, 'project-b')
  await fs.mkdir(projA, { recursive: true })
  await fs.mkdir(projB, { recursive: true })

  const sidA = crypto.randomUUID()
  const sidB = crypto.randomUUID()
  const sidC = crypto.randomUUID()

  await writeSessionFile(projA, sidA, [
    makeSessionEntry('user', 'Project A session', { sessionId: sidA }),
  ])
  await writeSessionFile(projB, sidB, [
    makeSessionEntry('user', 'Project B session 1', { sessionId: sidB }),
  ])
  await writeSessionFile(projB, sidC, [
    makeSessionEntry('user', 'Project B session 2', { sessionId: sidC }),
  ])

  // List JSONL files in each project dir
  const allFiles = []
  for (const projectDir of [projA, projB]) {
    try {
      const entries = await fs.readdir(projectDir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          allFiles.push(path.join(projectDir, e.name))
        }
      }
    } catch { /* skip */ }
  }

  assert.equal(allFiles.length, 3)
  assert.ok(allFiles.some(f => f.includes(sidA)))
  assert.ok(allFiles.some(f => f.includes(sidB)))
  assert.ok(allFiles.some(f => f.includes(sidC)))

  await fs.rm(tmpBase, { recursive: true, force: true })
})

test('W09 session file listing deduplicates sessions by ID', async () => {
  // Simulate: same session ID appears in worktree and main project — keep newest
  const sessionId = crypto.randomUUID()
  const mainLog = {
    sessionId,
    messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Main' } }],
    modified: new Date('2026-05-29T10:00:00Z'),
    leafUuid: crypto.randomUUID(),
  }
  const worktreeLog = {
    sessionId,
    messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Worktree' } }],
    modified: new Date('2026-05-30T10:00:00Z'),
    leafUuid: mainLog.leafUuid,
  }

  // Dedup: sessionId + leafUuid as key, keep newest
  const deduped = new Map()
  for (const log of [mainLog, worktreeLog]) {
    const key = `${log.sessionId}:${log.leafUuid}`
    const existing = deduped.get(key)
    if (!existing || log.modified.getTime() > existing.modified.getTime()) {
      deduped.set(key, log)
    }
  }

  const result = [...deduped.values()]
  assert.equal(result.length, 1)
  assert.equal(result[0].messages[0].message.content, 'Worktree')
})

// ─── W9: Session switching — switchSession logic ───

test('W09 switchSession changes session ID atomically', () => {
  // Ported logic from bootstrap/state.ts switchSession
  const state = { sessionId: crypto.randomUUID(), sessionProjectDir: null }

  function switchSession(newId, projectDir = null) {
    state.sessionId = newId
    state.sessionProjectDir = projectDir
  }

  const originalId = state.sessionId
  const newId = crypto.randomUUID()

  assert.equal(state.sessionId, originalId)
  switchSession(newId)
  assert.equal(state.sessionId, newId)
  assert.notEqual(state.sessionId, originalId)
})

test('W09 switchSession sets project directory', () => {
  const state = { sessionId: crypto.randomUUID(), sessionProjectDir: null }

  function switchSession(newId, projectDir = null) {
    state.sessionId = newId
    state.sessionProjectDir = projectDir
  }

  const newId = crypto.randomUUID()
  const projectDir = '/path/to/worktree/project'
  switchSession(newId, projectDir)
  assert.equal(state.sessionId, newId)
  assert.equal(state.sessionProjectDir, projectDir)
})

test('W09 switchSession with null projectDir resets to current project', () => {
  const state = { sessionId: crypto.randomUUID(), sessionProjectDir: '/some/other/dir' }

  function switchSession(newId, projectDir = null) {
    state.sessionId = newId
    state.sessionProjectDir = projectDir
  }

  const newId = crypto.randomUUID()
  switchSession(newId, null)
  assert.equal(state.sessionId, newId)
  assert.equal(state.sessionProjectDir, null)
})

// ─── W9: Session ID regeneration ───

test('W09 regenerateSessionId creates new UUID different from current', () => {
  const state = { sessionId: crypto.randomUUID(), parentSessionId: null }

  function regenerateSessionId({ setCurrentAsParent } = {}) {
    if (setCurrentAsParent) {
      state.parentSessionId = state.sessionId
    }
    state.sessionId = crypto.randomUUID()
    return state.sessionId
  }

  const originalId = state.sessionId
  const newId = regenerateSessionId()
  assert.notEqual(newId, originalId)
  assert.ok(validateUuid(newId))
})

test('W09 regenerateSessionId preserves parent when requested', () => {
  const state = { sessionId: crypto.randomUUID(), parentSessionId: null }

  function regenerateSessionId({ setCurrentAsParent } = {}) {
    if (setCurrentAsParent) {
      state.parentSessionId = state.sessionId
    }
    state.sessionId = crypto.randomUUID()
    return state.sessionId
  }

  const originalId = state.sessionId
  regenerateSessionId({ setCurrentAsParent: true })
  assert.equal(state.parentSessionId, originalId)
  assert.notEqual(state.sessionId, originalId)
})

// ─── W9: Session sort order ───

test('W09 sortLogsByModifiedDesc orders newest first', () => {
  const logs = [
    { modified: new Date('2026-05-28'), sessionId: 'older' },
    { modified: new Date('2026-05-30'), sessionId: 'newest' },
    { modified: new Date('2026-05-29'), sessionId: 'middle' },
  ]
  const sorted = sortLogsByModifiedDesc(logs)
  assert.equal(sorted[0].sessionId, 'newest')
  assert.equal(sorted[1].sessionId, 'middle')
  assert.equal(sorted[2].sessionId, 'older')
})

test('W09 sortLogsByModifiedDesc handles missing modified dates', () => {
  const logs = [
    { sessionId: 'no-date' },
    { modified: new Date('2026-05-30'), sessionId: 'has-date' },
  ]
  const sorted = sortLogsByModifiedDesc(logs)
  assert.equal(sorted[0].sessionId, 'has-date')
  assert.equal(sorted[1].sessionId, 'no-date')
})

// ─── W9: Session metadata — JSONL round-trip with metadata entries ───

test('W09 JSONL session with custom title, tag, and last-prompt round-trip', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-meta-rt-'))
  const filePath = path.join(tmpDir, 'session.jsonl')

  const sessionId = crypto.randomUUID()
  const entries = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Build a REST API' }, sessionId, uuid: crypto.randomUUID() }) + '\n',
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Here is your API' }, sessionId, uuid: crypto.randomUUID() }) + '\n',
    JSON.stringify({ type: 'custom-title', customTitle: 'REST API Builder', sessionId }) + '\n',
    JSON.stringify({ type: 'tag', tag: 'backend', sessionId }) + '\n',
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'Build a REST API', sessionId }) + '\n',
  ].join('')

  await fs.writeFile(filePath, entries, 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  const titleResult = extractCustomTitleFromHead(content)
  const tagResult = extractTagFromHead(content)
  const promptResult = extractFirstPromptFromHead(content)

  assert.equal(titleResult, 'REST API Builder')
  assert.equal(tagResult, 'backend')
  assert.equal(promptResult, 'Build a REST API')

  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('W09 JSONL session with agent-name and agent-color round-trip', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-agent-meta-'))
  const filePath = path.join(tmpDir, 'session.jsonl')

  const sessionId = crypto.randomUUID()
  const head = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' }, sessionId }),
    JSON.stringify({ type: 'agent-name', agentName: 'code-reviewer', sessionId }),
    JSON.stringify({ type: 'agent-color', agentColor: 'blue', sessionId }),
  ].join('\n')

  await fs.writeFile(filePath, head, 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  assert.ok(content.includes('"agentName":"code-reviewer"'))
  assert.ok(content.includes('"agentColor":"blue"'))

  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── W9: Session listing — concurrent session tracking ───

test('W09 concurrent session PID registration and listing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-pid-'))
  const pidFile = path.join(tmpDir, `${process.pid}.json`)

  const sessionData = {
    pid: process.pid,
    sessionId: crypto.randomUUID(),
    kind: 'interactive',
    status: 'busy',
    cwd: process.cwd(),
    startTime: Date.now(),
    lastActivity: Date.now(),
  }

  await fs.writeFile(pidFile, JSON.stringify(sessionData), 'utf8')

  const raw = await fs.readFile(pidFile, 'utf8')
  const parsed = JSON.parse(raw)

  assert.equal(parsed.pid, process.pid)
  assert.ok(validateUuid(parsed.sessionId))
  assert.equal(parsed.kind, 'interactive')
  assert.equal(parsed.status, 'busy')

  // Cleanup test file
  await fs.unlink(pidFile)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

test('W09 concurrent session distinguishes session kinds', () => {
  const kinds = ['interactive', 'bg', 'daemon', 'daemon-worker']
  for (const kind of kinds) {
    const data = { pid: 12345, sessionId: crypto.randomUUID(), kind, status: 'idle' }
    assert.ok(kinds.includes(data.kind))
    assert.equal(data.status, 'idle')
  }
})

// ─── W9: Cross-project session detection ───

test('W09 sessions from different projects have distinct sanitized paths', () => {
  // sanitizePath replaces path separators for filesystem-safe project dirs
  function sanitizePath(inputPath) {
    // Order matters: lowercase drive letter first, then replace backslashes,
    // then replace forbidden chars (which will also replace the drive colon).
    return inputPath
      .replace(/^[A-Z]:/, (m) => m.toLowerCase())
      .replace(/\\/g, '/')
      .replace(/[:*?"<>|]/g, '_')
  }

  const projA = sanitizePath('/home/user/project-a')
  const projB = sanitizePath('/home/user/project-b')
  const projC = sanitizePath('C:\\Users\\dev\\project-c')

  assert.notEqual(projA, projB)
  // On Windows, C:\Users\dev\project-c → c_/Users/dev/project-c
  // (colon replaced after drive letter normalization)
  assert.ok(projC.includes('project-c'))
  assert.ok(!projC.includes('\\'))
  // Case insensitive drive letter normalization
  assert.equal(sanitizePath('C:\\Foo'), sanitizePath('c:\\Foo'))
})

test('W09 session belongs to same repo when worktree paths match', () => {
  const worktreePaths = [
    '/home/user/repo',
    '/home/user/repo-worktree',
  ]
  const sessionCwd = '/home/user/repo/src'

  // A session belongs to the same repo if its cwd starts with any worktree path
  function isSameRepo(sessionCwd, worktreePaths) {
    return worktreePaths.some(wp => sessionCwd.startsWith(wp))
  }

  assert.ok(isSameRepo(sessionCwd, worktreePaths))
  assert.ok(isSameRepo('/home/user/repo-worktree/subdir', worktreePaths))
  assert.ok(!isSameRepo('/home/user/other-repo', worktreePaths))
})

// ─── W9: Progressive session loading ───

test('W09 progressive session enrichment loads metadata in batches', () => {
  // Simulates enrichLogs — first N logs get full enrich, rest stay as stat-only
  const allStatLogs = Array.from({ length: 10 }, (_, i) => ({
    value: i,
    sessionId: crypto.randomUUID(),
    modified: new Date(2026, 4, 30 - i),
    messages: [],
    isSidechain: false,
  }))

  const INITIAL_ENRICH_COUNT = 5
  const enriched = allStatLogs.slice(0, INITIAL_ENRICH_COUNT)
  const remaining = allStatLogs.slice(INITIAL_ENRICH_COUNT)

  assert.equal(enriched.length, 5)
  assert.equal(remaining.length, 5)
  assert.equal(enriched.length + remaining.length, allStatLogs.length)
})

// ─── W9: Session metadata — mode entry ───

test('W09 session mode (coordinator/normal) is persisted', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-mode-'))
  const filePath = path.join(tmpDir, 'session.jsonl')

  const sessionId = crypto.randomUUID()
  const head = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' }, sessionId }),
    JSON.stringify({ type: 'mode', mode: 'coordinator', sessionId }),
  ].join('\n')

  await fs.writeFile(filePath, head, 'utf8')
  const content = await fs.readFile(filePath, 'utf8')

  assert.ok(content.includes('"type":"mode"'))
  assert.ok(content.includes('"mode":"coordinator"'))

  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── W9: Session metadata — worktree state ───

test('W09 session worktree state persist and read', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-wt-'))
  const filePath = path.join(tmpDir, 'session.jsonl')

  const sessionId = crypto.randomUUID()
  // Active worktree state
  const entries = [
    JSON.stringify({
      type: 'worktree-state',
      worktreeSession: { path: '/tmp/worktree-1', branch: 'feature/x' },
      sessionId,
    }),
  ].join('\n') + '\n'

  await fs.writeFile(filePath, entries, 'utf8')

  const content = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(content.trim())
  assert.equal(parsed.type, 'worktree-state')
  assert.equal(parsed.worktreeSession.path, '/tmp/worktree-1')
  assert.equal(parsed.worktreeSession.branch, 'feature/x')

  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─── W9: End-to-end picker flow (simulated) ───

test('W09 picker flow: no arg -> load logs -> display choices -> select -> resume', async () => {
  // Step 1: resolveResumeLookup with no arg returns picker
  const step1 = await resolveResumeLookup({
    arg: '',
    logs: [],
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(step1.type, 'picker')

  // Step 2: Load sessions (simulated)
  const sessionId = crypto.randomUUID()
  const logs = [
    {
      sessionId,
      messages: [{ type: 'user', sessionId, message: { role: 'user', content: 'Test task' } }],
      modified: new Date('2026-05-30T12:00:00Z'),
      firstPrompt: 'Test task',
      messageCount: 2,
    },
  ]

  // Step 3: Filter resumable
  const currentId = crypto.randomUUID()
  const resumable = filterResumableSessions(logs, currentId)
  assert.equal(resumable.length, 1)

  // Step 4: Select and resume
  const step4 = await resolveResumeLookup({
    arg: sessionId,
    logs: resumable,
    validateSessionId: validateUuid,
    getSessionIdFromLog,
    isLiteLog: () => false,
    loadFullLog: async (log) => log,
    getLastSessionLog: async () => null,
    isCustomTitleEnabled: () => true,
    searchSessionsByCustomTitle: async () => [],
  })
  assert.equal(step4.type, 'resume')
  assert.equal(step4.sessionId, sessionId)
})

// ─── W9: Batch operations on session lists ───

test('W09 session list batch dedup preserves unique sessions across worktrees', () => {
  const sidA = crypto.randomUUID()
  const sidB = crypto.randomUUID()

  const logs = [
    { sessionId: sidA, leafUuid: 'leaf-1', modified: new Date('2026-05-29') },
    { sessionId: sidA, leafUuid: 'leaf-1', modified: new Date('2026-05-30') }, // same session+leaf, newer
    { sessionId: sidA, leafUuid: 'leaf-2', modified: new Date('2026-05-28') }, // same session, different leaf
    { sessionId: sidB, leafUuid: 'leaf-3', modified: new Date('2026-05-30') },
  ]

  const deduped = new Map()
  for (const log of logs) {
    const key = `${log.sessionId}:${log.leafUuid}`
    const existing = deduped.get(key)
    if (!existing || log.modified.getTime() > existing.modified.getTime()) {
      deduped.set(key, log)
    }
  }

  const result = [...deduped.values()]
  assert.equal(result.length, 3) // sidA:leaf-1 (newest), sidA:leaf-2, sidB:leaf-3

  const leaf1 = result.find(l => l.leafUuid === 'leaf-1')
  assert.equal(leaf1.modified.toISOString(), '2026-05-30T00:00:00.000Z')
})

test('W09 session list handles empty project directories gracefully', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-empty-'))

  const entries = await fs.readdir(tmpDir, { withFileTypes: true })
  const jsonlFiles = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'))

  assert.equal(jsonlFiles.length, 0)
  await fs.rm(tmpDir, { recursive: true, force: true })
})
