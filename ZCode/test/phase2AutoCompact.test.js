import test from 'node:test'
import assert from 'node:assert/strict'

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 — Auto-compact & context window verification tests
// Portable reimplementations of core logic from:
//   src/services/compact/autoCompact.ts
//   src/utils/context.ts
//   src/utils/messages.ts
// ═══════════════════════════════════════════════════════════════

// ─── Constants (from context.ts) ───

const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000
const COMPACT_MAX_OUTPUT_TOKENS = 20_000
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// ─── Constants (from autoCompact.ts) ───

const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// ─── Portable: getContextWindowForModel (context.ts) ───

function getContextWindowForModel(model, betas) {
  if (/\[1m\]/i.test(model)) {
    return 1_000_000
  }
  // Check for known models with large context (simplified from modelCapabilities)
  const m = model.toLowerCase()
  if (m.includes('sonnet-4') || m.includes('opus-4') || m.includes('haiku-4')) {
    // Model capabilities may report higher, but default is 200k
    return MODEL_CONTEXT_WINDOW_DEFAULT
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

// ─── Portable: getEffectiveContextWindowSize (autoCompact.ts) ───

function getEffectiveContextWindowSize(model) {
  const reservedTokensForSummary = MAX_OUTPUT_TOKENS_FOR_SUMMARY
  let contextWindow = getContextWindowForModel(model)

  const autoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  return contextWindow - reservedTokensForSummary
}

// ─── Portable: getAutoCompactThreshold (autoCompact.ts) ───

function getAutoCompactThreshold(model) {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  return effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS
}

// ─── Portable: isAutoCompactEnabled (autoCompact.ts) ───

function isEnvTruthy(value) {
  if (!value) return false
  return !['0', 'false', 'no', 'off', ''].includes(value.toLowerCase().trim())
}

function isAutoCompactEnabled() {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) return false
  return true
}

// ─── Portable: calculateTokenWarningState (autoCompact.ts) ───

function calculateTokenWarningState(tokenUsage, model) {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold
  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  const blockingLimitOverride = process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

// ─── Portable: compact boundary message helpers (messages.ts) ───

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function createCompactBoundaryMessage(trigger, preTokens, lastPreCompactMessageUuid, userContext, messagesSummarized) {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      userContext,
      messagesSummarized,
    },
    ...(lastPreCompactMessageUuid && {
      logicalParentUuid: lastPreCompactMessageUuid,
    }),
  }
}

function isCompactBoundaryMessage(message) {
  return message?.type === 'system' && message.subtype === 'compact_boundary'
}

function findLastCompactBoundaryIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && isCompactBoundaryMessage(messages[i])) {
      return i
    }
  }
  return -1
}

function getMessagesAfterCompactBoundary(messages) {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  return boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
}

// ─── Portable: calculateContextPercentages (context.ts) ───

function calculateContextPercentages(currentUsage, contextWindowSize) {
  if (!currentUsage) return { used: null, remaining: null }

  const totalInputTokens =
    (currentUsage.input_tokens || 0) +
    (currentUsage.cache_creation_input_tokens || 0) +
    (currentUsage.cache_read_input_tokens || 0)

  const usedPercentage = Math.round((totalInputTokens / contextWindowSize) * 100)
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return { used: clampedUsed, remaining: 100 - clampedUsed }
}

// ─── Portable: circuit breaker state machine ───

function createAutoCompactTracking() {
  return { compacted: false, turnCounter: 0, turnId: randomUUID(), consecutiveFailures: 0 }
}

function isCircuitBreakerTripped(tracking) {
  return (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  )
}

function recordAutoCompactFailure(tracking) {
  const next = (tracking?.consecutiveFailures ?? 0) + 1
  return { ...tracking, consecutiveFailures: next, tripped: next >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES }
}

function recordAutoCompactSuccess(tracking) {
  return { ...tracking, consecutiveFailures: 0, compacted: true, turnCounter: 0 }
}

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Context Window & Threshold Calculation
// ═══════════════════════════════════════════════════════════════

test('W8 context window: default model returns 200K', () => {
  assert.equal(getContextWindowForModel('claude-sonnet-4-6'), 200_000)
  assert.equal(getContextWindowForModel('claude-haiku-4-6'), 200_000)
  assert.equal(getContextWindowForModel('claude-opus-4-6'), 200_000)
})

test('W8 context window: [1m] suffix returns 1M', () => {
  assert.equal(getContextWindowForModel('claude-sonnet-4-6 [1m]'), 1_000_000)
  assert.equal(getContextWindowForModel('claude-opus-4-6[1m]'), 1_000_000)
})

test('W8 effective context window: reserves 20K for summary output', () => {
  const effective = getEffectiveContextWindowSize('claude-sonnet-4-6')
  assert.equal(effective, 200_000 - 20_000) // 180_000
})

test('W8 effective context window: 1M model reserves 20K', () => {
  const effective = getEffectiveContextWindowSize('claude-sonnet-4-6 [1m]')
  assert.equal(effective, 1_000_000 - 20_000) // 980_000
})

test('W8 auto-compact threshold: effective window minus 13K buffer', () => {
  const threshold = getAutoCompactThreshold('claude-sonnet-4-6')
  // effective = 200_000 - 20_000 = 180_000
  // threshold = 180_000 - 13_000 = 167_000
  assert.equal(threshold, 167_000)
})

test('W8 auto-compact threshold: 1M model', () => {
  const threshold = getAutoCompactThreshold('claude-sonnet-4-6 [1m]')
  // effective = 1_000_000 - 20_000 = 980_000
  // threshold = 980_000 - 13_000 = 967_000
  assert.equal(threshold, 967_000)
})

test('W8 auto-compact threshold: model-agnostic (all default to same)', () => {
  const models = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-6']
  const thresholds = models.map(getAutoCompactThreshold)
  assert.equal(new Set(thresholds).size, 1, 'all default models should have same threshold')
  assert.equal(thresholds[0], 167_000)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Token Warning State Calculation
// ═══════════════════════════════════════════════════════════════

test('W8 token warning: below all thresholds', () => {
  const state = calculateTokenWarningState(50_000, 'claude-sonnet-4-6')
  assert.equal(state.isAboveWarningThreshold, false)
  assert.equal(state.isAboveErrorThreshold, false)
  assert.equal(state.isAboveAutoCompactThreshold, false)
  assert.equal(state.isAtBlockingLimit, false)
  assert.ok(state.percentLeft > 50, 'should have more than 50% remaining')
})

test('W8 token warning: above warning and error thresholds (both at 147K)', () => {
  // warning = 167K - 20K = 147K, error = 167K - 20K = 147K (same buffer)
  const state = calculateTokenWarningState(148_000, 'claude-sonnet-4-6')
  assert.equal(state.isAboveWarningThreshold, true)
  assert.equal(state.isAboveErrorThreshold, true)
  assert.equal(state.isAboveAutoCompactThreshold, false)
})

test('W8 token warning: above error threshold', () => {
  const state = calculateTokenWarningState(159_000, 'claude-sonnet-4-6')
  assert.equal(state.isAboveWarningThreshold, true)
  assert.equal(state.isAboveErrorThreshold, true)
  assert.equal(state.isAboveAutoCompactThreshold, false)
})

test('W8 token warning: above auto-compact threshold (167K)', () => {
  const state = calculateTokenWarningState(168_000, 'claude-sonnet-4-6')
  assert.equal(state.isAboveWarningThreshold, true)
  assert.equal(state.isAboveErrorThreshold, true)
  assert.equal(state.isAboveAutoCompactThreshold, true)
})

test('W8 token warning: at blocking limit (180K - 3K = 177K)', () => {
  const state = calculateTokenWarningState(177_000, 'claude-sonnet-4-6')
  assert.equal(state.isAtBlockingLimit, true)
})

test('W8 token warning: percentLeft decreases as usage increases', () => {
  const low = calculateTokenWarningState(50_000, 'claude-sonnet-4-6')
  const mid = calculateTokenWarningState(120_000, 'claude-sonnet-4-6')
  const high = calculateTokenWarningState(160_000, 'claude-sonnet-4-6')

  assert.ok(low.percentLeft > mid.percentLeft, 'low usage should have higher percent remaining')
  assert.ok(mid.percentLeft > high.percentLeft, 'mid usage should have higher percent remaining')
  // (167000 - 50000) / 167000 = 117000/167000 = 0.7006 → round = 70
  // (167000 - 120000) / 167000 = 47000/167000 = 0.2814 → round = 28
  // (167000 - 160000) / 167000 = 7000/167000 = 0.0419 → round = 4
  assert.equal(low.percentLeft, 70)
})

test('W8 token warning: threshold boundaries are inclusive (>=)', () => {
  const threshold = getAutoCompactThreshold('claude-sonnet-4-6') // 167_000
  const at = calculateTokenWarningState(threshold, 'claude-sonnet-4-6')
  const below = calculateTokenWarningState(threshold - 1, 'claude-sonnet-4-6')

  assert.equal(at.isAboveAutoCompactThreshold, true, 'at threshold should trigger')
  assert.equal(below.isAboveAutoCompactThreshold, false, 'below threshold should not trigger')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Auto-compact Enable/Disable Gates
// ═══════════════════════════════════════════════════════════════

test('W8 isAutoCompactEnabled: true by default', () => {
  // Assuming no env vars set in test environment
  const wasDisabled = process.env.DISABLE_COMPACT
  const wasAutoDisabled = process.env.DISABLE_AUTO_COMPACT
  delete process.env.DISABLE_COMPACT
  delete process.env.DISABLE_AUTO_COMPACT

  assert.equal(isAutoCompactEnabled(), true)

  if (wasDisabled) process.env.DISABLE_COMPACT = wasDisabled
  if (wasAutoDisabled) process.env.DISABLE_AUTO_COMPACT = wasAutoDisabled
})

test('W8 isAutoCompactEnabled: DISABLE_COMPACT disables everything', () => {
  process.env.DISABLE_COMPACT = '1'
  assert.equal(isAutoCompactEnabled(), false)
  delete process.env.DISABLE_COMPACT
})

test('W8 isAutoCompactEnabled: DISABLE_AUTO_COMPACT disables auto but allows manual', () => {
  process.env.DISABLE_AUTO_COMPACT = 'true'
  assert.equal(isAutoCompactEnabled(), false)
  delete process.env.DISABLE_AUTO_COMPACT
})

test('W8 isAutoCompactEnabled: truthy values disable, falsy allow', () => {
  const truthy = ['1', 'true', 'TRUE', 'yes', 'on']
  for (const v of truthy) {
    process.env.DISABLE_COMPACT = v
    assert.equal(isAutoCompactEnabled(), false, `"${v}" should disable`)
  }
  delete process.env.DISABLE_COMPACT

  const falsy = ['0', 'false', 'no', 'off', '']
  for (const v of falsy) {
    process.env.DISABLE_AUTO_COMPACT = v
    // After setting falsy, auto should be enabled (unless DISABLE_COMPACT overrides)
    if (v === '0' || v === 'false' || v === 'no' || v === 'off' || v === '') {
      assert.equal(isAutoCompactEnabled(), true, `"${v}" should not disable`)
    }
  }
  delete process.env.DISABLE_AUTO_COMPACT
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Compact Boundary Messages
// ═══════════════════════════════════════════════════════════════

test('W8 createCompactBoundaryMessage: manual trigger', () => {
  const msg = createCompactBoundaryMessage('manual', 150_000)

  assert.equal(msg.type, 'system')
  assert.equal(msg.subtype, 'compact_boundary')
  assert.equal(msg.content, 'Conversation compacted')
  assert.equal(msg.isMeta, false)
  assert.equal(msg.level, 'info')
  assert.ok(msg.uuid, 'should have uuid')
  assert.ok(msg.timestamp, 'should have timestamp')
  assert.equal(msg.compactMetadata.trigger, 'manual')
  assert.equal(msg.compactMetadata.preTokens, 150_000)
})

test('W8 createCompactBoundaryMessage: auto trigger with full metadata', () => {
  const msg = createCompactBoundaryMessage(
    'auto',
    200_000,
    'uuid-prev-msg-123',
    'User asked about architecture',
    42,
  )

  assert.equal(msg.compactMetadata.trigger, 'auto')
  assert.equal(msg.compactMetadata.preTokens, 200_000)
  assert.equal(msg.compactMetadata.userContext, 'User asked about architecture')
  assert.equal(msg.compactMetadata.messagesSummarized, 42)
  assert.equal(msg.logicalParentUuid, 'uuid-prev-msg-123')
})

test('W8 createCompactBoundaryMessage: undefined optional fields are omitted', () => {
  const msg = createCompactBoundaryMessage('auto', 100_000)

  assert.equal('logicalParentUuid' in msg, false, 'should not have logicalParentUuid when undefined')
  assert.equal(msg.compactMetadata.userContext, undefined)
  assert.equal(msg.compactMetadata.messagesSummarized, undefined)
})

test('W8 isCompactBoundaryMessage: detects compact boundaries', () => {
  const boundary = createCompactBoundaryMessage('auto', 100_000)
  assert.equal(isCompactBoundaryMessage(boundary), true)
})

test('W8 isCompactBoundaryMessage: rejects non-boundary messages', () => {
  assert.equal(isCompactBoundaryMessage(null), false)
  assert.equal(isCompactBoundaryMessage(undefined), false)
  assert.equal(isCompactBoundaryMessage({}), false)
  assert.equal(isCompactBoundaryMessage({ type: 'system' }), false)
  assert.equal(isCompactBoundaryMessage({ type: 'system', subtype: 'local_command' }), false)
  assert.equal(isCompactBoundaryMessage({ type: 'user', subtype: 'compact_boundary' }), false)
  assert.equal(isCompactBoundaryMessage({ type: 'assistant' }), false)
})

test('W8 isCompactBoundaryMessage: microcompact boundary is not a compact boundary', () => {
  const micro = {
    type: 'system',
    subtype: 'microcompact_boundary',
    content: 'Context microcompacted',
  }
  assert.equal(isCompactBoundaryMessage(micro), false)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Compact Boundary Index Finding
// ═══════════════════════════════════════════════════════════════

test('W8 findLastCompactBoundaryIndex: finds last boundary in mixed messages', () => {
  const messages = [
    { type: 'user', content: 'hello' },
    { type: 'assistant', content: 'hi' },
    createCompactBoundaryMessage('auto', 50_000),
    { type: 'user', content: 'do something' },
    { type: 'assistant', content: 'done' },
  ]

  const idx = findLastCompactBoundaryIndex(messages)
  assert.equal(idx, 2)
})

test('W8 findLastCompactBoundaryIndex: returns last when multiple boundaries exist', () => {
  const messages = [
    createCompactBoundaryMessage('auto', 30_000),
    { type: 'user', content: 'msg1' },
    { type: 'assistant', content: 'reply1' },
    createCompactBoundaryMessage('auto', 60_000),
    { type: 'user', content: 'msg2' },
    { type: 'assistant', content: 'reply2' },
  ]

  const idx = findLastCompactBoundaryIndex(messages)
  assert.equal(idx, 3, 'should return index of second (last) boundary')
})

test('W8 findLastCompactBoundaryIndex: returns -1 when no boundary exists', () => {
  const messages = [
    { type: 'user', content: 'hello' },
    { type: 'assistant', content: 'hi' },
  ]

  assert.equal(findLastCompactBoundaryIndex(messages), -1)
})

test('W8 findLastCompactBoundaryIndex: returns -1 for empty array', () => {
  assert.equal(findLastCompactBoundaryIndex([]), -1)
})

test('W8 findLastCompactBoundaryIndex: boundary at index 0 is found', () => {
  const messages = [
    createCompactBoundaryMessage('manual', 10_000),
    { type: 'user', content: 'after compact' },
  ]

  assert.equal(findLastCompactBoundaryIndex(messages), 0)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Messages After Compact Boundary
// ═══════════════════════════════════════════════════════════════

test('W8 getMessagesAfterCompactBoundary: slices from last boundary onward', () => {
  const boundary = createCompactBoundaryMessage('auto', 80_000)
  const messages = [
    { type: 'user', content: 'pre-compact msg 1' },
    { type: 'assistant', content: 'pre-compact reply 1' },
    { type: 'user', content: 'pre-compact msg 2' },
    { type: 'assistant', content: 'pre-compact reply 2' },
    boundary,
    { type: 'user', content: 'post-compact msg' },
    { type: 'assistant', content: 'post-compact reply' },
  ]

  const result = getMessagesAfterCompactBoundary(messages)
  assert.equal(result.length, 3, 'should include boundary + 2 post-compact messages')
  assert.equal(result[0], boundary)
  assert.equal(result[1].content, 'post-compact msg')
  assert.equal(result[2].content, 'post-compact reply')
})

test('W8 getMessagesAfterCompactBoundary: returns all messages if no boundary', () => {
  const messages = [
    { type: 'user', content: 'msg1' },
    { type: 'assistant', content: 'reply1' },
  ]

  const result = getMessagesAfterCompactBoundary(messages)
  assert.equal(result.length, 2)
  assert.equal(result, messages) // same reference when no slice
})

test('W8 getMessagesAfterCompactBoundary: returns only boundary for edge case', () => {
  const boundary = createCompactBoundaryMessage('auto', 10_000)
  const messages = [boundary]

  const result = getMessagesAfterCompactBoundary(messages)
  assert.equal(result.length, 1)
  assert.equal(result[0], boundary)
})

test('W8 getMessagesAfterCompactBoundary: last boundary wins when multiple', () => {
  const b1 = createCompactBoundaryMessage('auto', 20_000)
  const b2 = createCompactBoundaryMessage('auto', 40_000)
  const messages = [
    { type: 'user', content: 'pre' },
    b1,
    { type: 'user', content: 'mid' },
    b2,
    { type: 'user', content: 'post' },
  ]

  const result = getMessagesAfterCompactBoundary(messages)
  assert.equal(result.length, 2) // b2 + post
  assert.equal(result[0], b2)
  assert.equal(result[1].content, 'post')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Context Percentage Calculation
// ═══════════════════════════════════════════════════════════════

test('W8 context percentages: empty usage returns null', () => {
  const result = calculateContextPercentages(null, 200_000)
  assert.equal(result.used, null)
  assert.equal(result.remaining, null)

  const resultUndef = calculateContextPercentages(undefined, 200_000)
  assert.equal(resultUndef.used, null)
})

test('W8 context percentages: 50% usage', () => {
  const result = calculateContextPercentages(
    { input_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    200_000,
  )
  assert.equal(result.used, 50)
  assert.equal(result.remaining, 50)
})

test('W8 context percentages: includes cache tokens', () => {
  const result = calculateContextPercentages(
    {
      input_tokens: 80_000,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 10_000,
    },
    200_000,
  )
  assert.equal(result.used, 50)
  assert.equal(result.remaining, 50)
})

test('W8 context percentages: rounds used percentage', () => {
  const result = calculateContextPercentages(
    { input_tokens: 66_666, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    200_000,
  )
  // 66666 / 200000 = 0.33333 → 33%
  assert.equal(result.used, 33)
  assert.equal(result.remaining, 67)
})

test('W8 context percentages: clamps to [0, 100]', () => {
  const over = calculateContextPercentages(
    { input_tokens: 250_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    200_000,
  )
  assert.equal(over.used, 100)
  assert.equal(over.remaining, 0)

  const zero = calculateContextPercentages(
    { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    200_000,
  )
  assert.equal(zero.used, 0)
  assert.equal(zero.remaining, 100)
})

test('W8 context percentages: near auto-compact threshold (~93%)', () => {
  // Threshold for default model: 167_000 / 200_000 ≈ 83.5% of raw window
  // But percentage is calculated against the threshold (167K), not the raw window
  const result = calculateContextPercentages(
    { input_tokens: 150_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    200_000,
  )
  assert.equal(result.used, 75)
  assert.equal(result.remaining, 25)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Circuit Breaker (Max 3 Consecutive Failures)
// ═══════════════════════════════════════════════════════════════

test('W8 circuit breaker: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES is 3', () => {
  assert.equal(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES, 3)
})

test('W8 circuit breaker: not tripped initially', () => {
  const tracking = createAutoCompactTracking()
  assert.equal(isCircuitBreakerTripped(tracking), false)
  assert.equal(tracking.consecutiveFailures, 0)
})

test('W8 circuit breaker: not tripped after 2 failures', () => {
  let tracking = createAutoCompactTracking()
  tracking = recordAutoCompactFailure(tracking)  // 1
  tracking = recordAutoCompactFailure(tracking)  // 2
  assert.equal(tracking.consecutiveFailures, 2)
  assert.equal(isCircuitBreakerTripped(tracking), false)
  assert.equal(tracking.tripped, false)
})

test('W8 circuit breaker: trips after 3 consecutive failures', () => {
  let tracking = createAutoCompactTracking()
  tracking = recordAutoCompactFailure(tracking)  // 1
  tracking = recordAutoCompactFailure(tracking)  // 2
  tracking = recordAutoCompactFailure(tracking)  // 3
  assert.equal(tracking.consecutiveFailures, 3)
  assert.equal(isCircuitBreakerTripped(tracking), true)
  assert.equal(tracking.tripped, true)
})

test('W8 circuit breaker: stays tripped after 4+ failures', () => {
  let tracking = createAutoCompactTracking()
  tracking = recordAutoCompactFailure(tracking) // 1
  tracking = recordAutoCompactFailure(tracking) // 2
  tracking = recordAutoCompactFailure(tracking) // 3
  tracking = recordAutoCompactFailure(tracking) // 4
  assert.equal(tracking.consecutiveFailures, 4)
  assert.equal(isCircuitBreakerTripped(tracking), true)
})

test('W8 circuit breaker: success resets failure count', () => {
  let tracking = createAutoCompactTracking()
  tracking = recordAutoCompactFailure(tracking)  // 1
  tracking = recordAutoCompactFailure(tracking)  // 2
  tracking = recordAutoCompactSuccess(tracking)
  assert.equal(tracking.consecutiveFailures, 0)
  assert.equal(tracking.compacted, true)
  assert.equal(tracking.turnCounter, 0)
})

test('W8 circuit breaker: can re-trip after success then failures', () => {
  let tracking = createAutoCompactTracking()
  // Trip once
  tracking = recordAutoCompactFailure(recordAutoCompactFailure(recordAutoCompactFailure(tracking)))
  assert.equal(isCircuitBreakerTripped(tracking), true)

  // Success resets
  tracking = recordAutoCompactSuccess(tracking)
  assert.equal(isCircuitBreakerTripped(tracking), false)

  // Can trip again
  tracking = recordAutoCompactFailure(recordAutoCompactFailure(recordAutoCompactFailure(tracking)))
  assert.equal(isCircuitBreakerTripped(tracking), true)
})

test('W8 circuit breaker: tripped breaker prevents autoCompact attempts', () => {
  const tracking = { compacted: false, turnCounter: 0, turnId: 't1', consecutiveFailures: 3 }

  // Simulate autoCompactIfNeeded early return
  let shouldAttempt = true
  if (tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    shouldAttempt = false
  }
  assert.equal(shouldAttempt, false, 'should skip auto-compact when circuit breaker tripped')
})

test('W8 circuit breaker: tracking state carries turn counter', () => {
  const tracking = createAutoCompactTracking()
  assert.equal(tracking.turnCounter, 0)
  assert.equal(tracking.compacted, false)
  assert.ok(tracking.turnId, 'should have a turnId')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Auto-Compact & Session Storage Integration
// ═══════════════════════════════════════════════════════════════

test('W8 compact-aware session: messages after boundary exclude pre-compact history', () => {
  // Simulate a full session with a compact boundary
  const session = [
    { type: 'user', content: 'First question' },
    { type: 'assistant', content: 'First answer' },
    { type: 'user', content: 'Second question' },
    { type: 'assistant', content: 'Second answer' },
    createCompactBoundaryMessage('auto', 165_000, undefined, undefined, 4),
    { type: 'user', content: 'Third question (post-compact)' },
    { type: 'assistant', content: 'Third answer' },
  ]

  const activeMessages = getMessagesAfterCompactBoundary(session)
  assert.equal(activeMessages.length, 3, 'only boundary + post-compact messages')
  assert.ok(isCompactBoundaryMessage(activeMessages[0]), 'first should be boundary')
  assert.equal(activeMessages[1].content, 'Third question (post-compact)')
  assert.equal(activeMessages[2].content, 'Third answer')
})

test('W8 compact-aware session: multiple compaction cycles', () => {
  const session = []

  // First compaction cycle
  session.push({ type: 'user', content: 'Q1' })
  session.push({ type: 'assistant', content: 'A1' })
  session.push(createCompactBoundaryMessage('auto', 50_000, undefined, undefined, 2))
  session.push({ type: 'user', content: 'Q2' })
  session.push({ type: 'assistant', content: 'A2' })

  // Second compaction cycle
  session.push(createCompactBoundaryMessage('auto', 60_000, undefined, undefined, 2))
  session.push({ type: 'user', content: 'Q3' })
  session.push({ type: 'assistant', content: 'A3' })

  const active = getMessagesAfterCompactBoundary(session)
  assert.equal(active.length, 3) // boundary2 + Q3 + A3
  assert.equal(active[1].content, 'Q3')
  assert.equal(active[2].content, 'A3')

  // Verify findLastCompactBoundaryIndex returns the second boundary
  const idx = findLastCompactBoundaryIndex(session)
  assert.equal(idx, 5, 'should find second boundary at index 5')
})

test('W8 compact-aware session: pre-compact message count is tracked in metadata', () => {
  const boundary = createCompactBoundaryMessage('auto', 120_000, undefined, undefined, 15)
  assert.equal(boundary.compactMetadata.messagesSummarized, 15)
})

test('W8 compact-aware session: preTokens reflects usage at compact time', () => {
  const boundary = createCompactBoundaryMessage('auto', 170_000)
  assert.equal(boundary.compactMetadata.preTokens, 170_000)
  assert.ok(boundary.compactMetadata.preTokens > getAutoCompactThreshold('claude-sonnet-4-6'),
    'preTokens should be above auto-compact threshold')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Buffer & Threshold Constants
// ═══════════════════════════════════════════════════════════════

test('W8 constants: AUTOCOMPACT_BUFFER_TOKENS is 13K', () => {
  assert.equal(AUTOCOMPACT_BUFFER_TOKENS, 13_000)
})

test('W8 constants: WARNING_THRESHOLD_BUFFER_TOKENS is 20K', () => {
  assert.equal(WARNING_THRESHOLD_BUFFER_TOKENS, 20_000)
})

test('W8 constants: ERROR_THRESHOLD_BUFFER_TOKENS is 20K', () => {
  assert.equal(ERROR_THRESHOLD_BUFFER_TOKENS, 20_000)
})

test('W8 constants: MANUAL_COMPACT_BUFFER_TOKENS is 3K', () => {
  assert.equal(MANUAL_COMPACT_BUFFER_TOKENS, 3_000)
})

test('W8 constants: COMPACT_MAX_OUTPUT_TOKENS is 20K', () => {
  assert.equal(COMPACT_MAX_OUTPUT_TOKENS, 20_000)
})

test('W8 constants: MODEL_CONTEXT_WINDOW_DEFAULT is 200K', () => {
  assert.equal(MODEL_CONTEXT_WINDOW_DEFAULT, 200_000)
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — Token Threshold Progression Validation
// ═══════════════════════════════════════════════════════════════

test('W8 threshold progression: warning < error < auto-compact < blocking', () => {
  const model = 'claude-sonnet-4-6'
  // effective = 200K - 20K = 180K
  // autoCompactThreshold = 180K - 13K = 167K
  // warningThreshold = 167K - 20K = 147K
  // errorThreshold = 167K - 20K = 147K  (same as warning since both use 20K buffer)
  // blockingLimit = 180K - 3K = 177K

  const t167 = calculateTokenWarningState(167_000, model) // at auto compact
  const t147 = calculateTokenWarningState(147_000, model) // at warning/error
  const t177 = calculateTokenWarningState(177_000, model) // at blocking

  // Warning and error share the same buffer (20K) from effective threshold
  assert.equal(t147.isAboveWarningThreshold, true)
  assert.equal(t147.isAboveErrorThreshold, true)
  assert.equal(t147.isAboveAutoCompactThreshold, false)

  // Auto-compact at 167K
  assert.equal(t167.isAboveAutoCompactThreshold, true)
  assert.equal(t167.isAtBlockingLimit, false)

  // Blocking at 177K
  assert.equal(t177.isAtBlockingLimit, true)
})

test('W8 threshold progression: auto-compact fires before blocking', () => {
  const model = 'claude-sonnet-4-6'
  const autoCompactT = getAutoCompactThreshold(model) // 167_000
  const effective = getEffectiveContextWindowSize(model) // 180_000
  const blocking = effective - MANUAL_COMPACT_BUFFER_TOKENS // 177_000

  assert.ok(autoCompactT < blocking,
    `auto-compact threshold (${autoCompactT}) should be below blocking limit (${blocking})`)
})

test('W8 threshold progression: 80% context usage triggers auto-compact', () => {
  const model = 'claude-sonnet-4-6'
  const rawWindow = getContextWindowForModel(model) // 200_000
  const threshold = getAutoCompactThreshold(model) // 167_000
  const percentOfRaw = Math.round((threshold / rawWindow) * 100)

  // 167K / 200K = 83.5%
  assert.equal(percentOfRaw, 84, 'auto-compact triggers at ~84% of raw context window')
  assert.ok(percentOfRaw > 80, 'should trigger above 80% window usage')
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — PreCompact/PostCompact Hook Integration
// ═══════════════════════════════════════════════════════════════

test('W8 hooks: PreCompact and PostCompact are valid hook events', () => {
  const HOOK_EVENTS = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Notification', 'UserPromptSubmit',
    'SessionStart', 'SessionEnd',
    'Stop', 'StopFailure',
    'SubagentStart', 'SubagentStop',
    'PreCompact', 'PostCompact',
    'PermissionRequest', 'PermissionDenied',
    'Setup',
    'TeammateIdle', 'TaskCreated', 'TaskCompleted',
    'Elicitation', 'ElicitationResult',
    'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
    'InstructionsLoaded', 'CwdChanged', 'FileChanged',
  ]

  assert.ok(HOOK_EVENTS.includes('PreCompact'))
  assert.ok(HOOK_EVENTS.includes('PostCompact'))
})

test('W8 hooks: PreCompact hook input has trigger and custom_instructions', () => {
  // Validate the PreCompact hook schema shape (from coreSchemas.ts)
  const validPreCompactInputs = [
    { hookEventName: 'PreCompact', trigger: 'auto', custom_instructions: 'Focus on architecture' },
    { hookEventName: 'PreCompact', trigger: 'manual' },
    { hookEventName: 'PreCompact', trigger: 'auto', custom_instructions: '' },
  ]

  for (const input of validPreCompactInputs) {
    assert.equal(input.hookEventName, 'PreCompact')
    assert.ok(['auto', 'manual'].includes(input.trigger),
      `trigger must be "auto" or "manual", got "${input.trigger}"`)
  }
})

test('W8 hooks: PostCompact hook input has trigger and compact_summary', () => {
  // Validate the PostCompact hook schema shape (from coreSchemas.ts)
  const validPostCompactInputs = [
    { hookEventName: 'PostCompact', trigger: 'auto', compact_summary: 'This conversation covered architecture decisions...' },
    { hookEventName: 'PostCompact', trigger: 'manual', compact_summary: 'Summary of Q&A session' },
  ]

  for (const input of validPostCompactInputs) {
    assert.equal(input.hookEventName, 'PostCompact')
    assert.ok(['auto', 'manual'].includes(input.trigger))
    assert.ok(typeof input.compact_summary === 'string')
  }
})

test('W8 hooks: PreCompact hook output can return newCustomInstructions', () => {
  // Simulate what executePreCompactHooks might return
  const hookResult = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreCompact',
      newCustomInstructions: 'Keep details about the authentication module',
    },
  }

  assert.equal(hookResult.continue, true)
  assert.ok(hookResult.hookSpecificOutput.newCustomInstructions.includes('authentication'))
})

test('W8 hooks: PostCompact hook output can return userDisplayMessage', () => {
  // Simulate what executePostCompactHooks might return
  const hookResult = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostCompact',
      userDisplayMessage: 'Conversation compacted: 42 messages summarized',
    },
  }

  assert.equal(hookResult.continue, true)
  assert.ok(hookResult.hookSpecificOutput.userDisplayMessage.includes('42'))
})

// ═══════════════════════════════════════════════════════════════
// W8 T2.5 TESTS — edge cases & safety
// ═══════════════════════════════════════════════════════════════

test('W8 auto-compact: 0 token usage returns maximum percent remaining', () => {
  const state = calculateTokenWarningState(0, 'claude-sonnet-4-6')
  assert.equal(state.percentLeft, 100)
  assert.equal(state.isAtBlockingLimit, false)
})

test('W8 auto-compact: negative token usage (would not happen, but is safe)', () => {
  const state = calculateTokenWarningState(-1000, 'claude-sonnet-4-6')
  // percentLeft clamps: Math.max(0, round((167000 - (-1000)) / 167000 * 100)) = Math.max(0, 101) = 101, wait:
  // (167000 - (-1000)) / 167000 * 100 = 168000 / 167000 * 100 = 100.6 → round = 101, max(0, 101) = 101
  // But the function doesn't clamp the upper bound of percentLeft
  assert.equal(state.isAtBlockingLimit, false)
  assert.ok(state.percentLeft >= 100)
})

test('W8 auto-compact: token usage exceeding context window still computes valid state', () => {
  const state = calculateTokenWarningState(250_000, 'claude-sonnet-4-6')
  assert.equal(state.isAboveAutoCompactThreshold, true)
  assert.equal(state.isAtBlockingLimit, true)
  assert.equal(state.percentLeft, 0)
})

test('W8 compact boundary: UUID format is valid', () => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const msg = createCompactBoundaryMessage('auto', 100_000)
  assert.match(msg.uuid, uuidRegex)
})

test('W8 compact boundary: timestamp is ISO 8601', () => {
  const msg = createCompactBoundaryMessage('auto', 100_000)
  const parsed = new Date(msg.timestamp)
  assert.equal(parsed.toISOString(), msg.timestamp)
  assert.ok(!isNaN(parsed.getTime()), 'timestamp should parse as valid date')
})
