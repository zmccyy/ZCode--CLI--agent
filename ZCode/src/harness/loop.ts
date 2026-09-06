/**
 * Agent loop — the heart of the harness.
 *
 * Think → Act → Observe: stream a model response, execute requested tool
 * calls, feed results back, repeat until the model stops calling tools or a
 * guardrail fires. Provider-agnostic: wire formats are translated per the
 * provider's dialect before every request.
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentLoopResult,
  ChatMessage,
  ConfirmHandler,
  ExecutedToolCall,
  LoopEvent,
  LoopProvider,
  PermissionMode,
  StopReason,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolErrorCode,
  ToolResult,
  ToolSessionState,
  UsageSummary,
} from './types.ts'
import { LOOP_CONTRACT_VERSION } from './types.ts'
import { createToolRegistry, resolveToolContract, type ToolRegistry } from './tools/registry.ts'
import { resolveDialect, translateRequest, toolCallIdFor } from './translate.ts'
import { createTranscriptWriter, type TranscriptWriter } from './transcript.ts'
import { checkPermission } from './permissions.ts'
import { evaluateGuardrails } from './guardrails.ts'
import { emptyUsage, addUsage } from './usage.ts'
import { createWorkspaceBoundary, type WorkspaceBoundary } from './boundary.ts'
import { createRunMetricsCollector } from './metrics.ts'
import { createStuckDetector } from './stuckDetector.ts'
import { resolveBashPolicy, type BashPolicy } from './bashPolicy.ts'
import {
  compactConversation,
  resolveCompactConfig,
  type CompactOptions,
  type ResolvedCompactConfig,
} from './compact.ts'
import { collectReadFilesFromMessages } from './resume.ts'

const DEFAULT_MAX_TURNS = 30
const TOOL_RESULT_PREVIEW_LENGTH = 160
/** Cap on compaction attempts per run so a failing summarizer cannot spin. */
const MAX_COMPACTION_ATTEMPTS = 5
/** Total turn attempts (initial + retries) before a provider failure is terminal. */
const DEFAULT_PROVIDER_ATTEMPTS = 3
const DEFAULT_PROVIDER_BACKOFF_MS = 1000
const MAX_PROVIDER_BACKOFF_MS = 8000

export interface AgentLoopOptions {
  provider: LoopProvider
  model?: string | null
  system: string
  tools: ToolDefinition[]
  messages: ChatMessage[]
  permissionMode: PermissionMode
  /** Agent-mode approval callback; when absent, non-read-only calls are denied. */
  confirm?: ConfirmHandler
  maxTurns?: number
  /** Cumulative token budget across turns; loop stops when exceeded. */
  budgetTokens?: number
  temperature?: number
  maxTokens?: number
  cwd: string
  onEvent?: (event: LoopEvent) => void
  /** Transcript persistence; enabled by default, pass enabled:false to skip. */
  transcript?: { enabled?: boolean; dir?: string }
  signal?: AbortSignal
  /** Wire-dialect override (defaults from provider.kind). */
  dialect?: 'openai' | 'anthropic'
  /**
   * Workspace boundary for the file tools. Secure by default: when omitted,
   * the file tools are locked to `cwd`. Pass `{ addDirs: [...] }` to extend
   * the trusted roots (CLI --add-dir), or `false` to lift the boundary
   * entirely (CLI --no-boundary).
   */
  boundary?: { enabled?: boolean; addDirs?: readonly string[] } | false
  /** Bash command gate (allow/deny/ask). Defaults to the built-in policy. */
  bashPolicy?: BashPolicy
  /**
   * Bounded stuck detector (P1.5): when the SAME tool call fails identically
   * `nudgeAfter` (default 3) times in a row, a strategy nudge is appended to
   * the tool result; at `stopAfter` (default 5) the run stops ('stuck').
   * Pass `false` to disable (documented escape hatch).
   */
  stuckDetector?: { nudgeAfter?: number; stopAfter?: number } | false
  /** Auto context compaction; disabled when limitTokens is 0. */
  compact?: CompactOptions
  /** Seed the loop with a prior session's history (see resume.ts). */
  resume?: {
    sessionId: string
    messages: ChatMessage[]
    /**
     * Directory the prior session ran in. Relative paths in the restored
     * history (e.g. Read calls seeding the Edit precondition) resolve against
     * it, not the current cwd — resuming from another directory must not mark
     * files here as "already read".
     */
    originalCwd?: string | null
  }
  /**
   * Retries for provider requests that fail before any output streamed.
   * `attempts` is the total number of tries per turn (default 3); backoff is
   * exponential from `backoffMs` (default 1000), capped at 8s. A turn that
   * already streamed deltas is never replayed — that would duplicate output.
   */
  providerRetry?: { attempts?: number; backoffMs?: number }
}

export interface RunningLoop {
  sessionId: string
  result: Promise<AgentLoopResult>
}

function truncatePreview(text: string, maxLength = TOOL_RESULT_PREVIEW_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface TurnOutcome {
  text: string
  reasoning: string
  toolCalls: ToolCall[]
  finishReason: string | null
  usage: UsageSummary
  /** Input tokens the provider reported for this request (compaction trigger). */
  inputTokens: number
  messageId: string | null
  model: string | null
  /** The request saw a provider-reported response_end (complete turn). */
  sawResponseEnd: boolean
  /** The run was aborted while (or before) this turn streamed. */
  aborted: boolean
}

/**
 * A delay that resolves early when the signal aborts — a retry backoff must
 * never outlive the cancellation it belongs to.
 */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxTurns =
    Number.isFinite(options.maxTurns) && (options.maxTurns as number) >= 1
      ? Math.floor(options.maxTurns as number)
      : DEFAULT_MAX_TURNS
  const budgetTokens =
    Number.isFinite(options.budgetTokens) && (options.budgetTokens as number) > 0
      ? Math.floor(options.budgetTokens as number)
      : null
  const retryAttempts = options.providerRetry?.attempts
  const providerAttempts =
    typeof retryAttempts === 'number' && Number.isFinite(retryAttempts) && retryAttempts >= 1
      ? Math.floor(retryAttempts)
      : DEFAULT_PROVIDER_ATTEMPTS
  const retryBackoff = options.providerRetry?.backoffMs
  const providerBackoffMs =
    typeof retryBackoff === 'number' && Number.isFinite(retryBackoff) && retryBackoff >= 0
      ? retryBackoff
      : DEFAULT_PROVIDER_BACKOFF_MS

  const registry: ToolRegistry = createToolRegistry(options.tools)
  const dialect = options.dialect ?? resolveDialect(options.provider)
  const messages: ChatMessage[] = [...options.messages]
  const state: ToolSessionState = { readFiles: new Set() }
  const executedCalls: ExecutedToolCall[] = []
  const usage = emptyUsage()
  const compact: ResolvedCompactConfig = resolveCompactConfig(options.compact)
  let compactions = 0
  let compactionAttempts = 0
  let compactionExhausted = false
  /** Input tokens of the latest main request, per the provider's report. */
  let lastInputTokens = 0

  const metricsCollector = createRunMetricsCollector()
  // P1.5: bounded stuck detector. `stuckDetector: false` is the escape hatch
  // (mirrors the --no-boundary philosophy: explicit, documented opt-out).
  const stuckDetector =
    options.stuckDetector === false ? null : createStuckDetector(options.stuckDetector ?? {})
  // P1.1: a provider that declares its contract version must speak one the
  // harness understands — fail loudly at start, never mid-run.
  if (
    options.provider.contractVersion !== undefined &&
    options.provider.contractVersion !== LOOP_CONTRACT_VERSION
  ) {
    throw new Error(
      `provider "${options.provider.id}" declares contract version ` +
        `${options.provider.contractVersion}, but this harness speaks version ${LOOP_CONTRACT_VERSION}`,
    )
  }
  const emit = (event: LoopEvent): void => {
    metricsCollector.onLoopEvent(event)
    try {
      options.onEvent?.(event)
    } catch {
      // Observer errors must never break the loop itself.
    }
  }

  const sessionId = randomUUID()

  const transcript: TranscriptWriter = createTranscriptWriter({
    cwd: options.cwd,
    enabled: options.transcript?.enabled !== false,
    dir: options.transcript?.dir,
    sessionId,
  })

  const boundaryOption = options.boundary
  const boundary: WorkspaceBoundary =
    boundaryOption === false
      ? { enabled: false, roots: [] }
      : createWorkspaceBoundary({
          cwd: options.cwd,
          addDirs: boundaryOption?.addDirs,
          enabled: boundaryOption?.enabled,
        })
  const bashPolicy = options.bashPolicy ?? resolveBashPolicy()

  const toolContext: ToolContext = { cwd: options.cwd, state, signal: options.signal, boundary }

  let stopReason: StopReason = 'end_turn'
  let lastFinishReason: string | null = null
  let finalText = ''
  let errorMessage: string | null = null
  let turns = 0
  /** Non-fatal problems surfaced with the result (D2: persistence is visible). */
  const warnings: string[] = []

  transcript.append({
    type: 'session_start',
    sessionId,
    cwd: options.cwd,
    model: options.model ?? null,
    permissionMode: options.permissionMode,
    provider: options.provider.id,
    dialect,
    boundary: boundary.enabled ? boundary.roots : 'disabled',
    contractVersion: LOOP_CONTRACT_VERSION,
    ...(options.resume ? { resumedFrom: options.resume.sessionId } : {}),
  })
  if (options.resume) {
    messages.unshift(...options.resume.messages)
    transcript.append({
      type: 'resumed',
      fromSessionId: options.resume.sessionId,
      messages: options.resume.messages.length,
    })
    const resumeCwd = options.resume.originalCwd ?? options.cwd
    // Seed the read-before-edit precondition from execution FACTS only: a
    // file counts as read when its Read call has a matching, non-error tool
    // result in the restored history (see collectReadFilesFromMessages).
    for (const file of collectReadFilesFromMessages(options.resume.messages, resumeCwd)) {
      state.readFiles.add(file)
    }
    // Copy the restored history into the new transcript so the session file
    // is self-contained and can itself be resumed later.
    for (const message of options.resume.messages) {
      transcript.append({ type: 'message', message, turn: 0, restored: true })
    }
  }
  // Record the seed messages (the opening user prompt) so the transcript is a
  // complete conversation and resume does not lose the original task.
  for (const message of options.messages) {
    transcript.append({ type: 'message', message, turn: 0 })
  }
  emit({
    type: 'session_start',
    sessionId,
    cwd: options.cwd,
    model: options.model ?? null,
    permissionMode: options.permissionMode,
  })

  const abortRequested = (): boolean => options.signal?.aborted === true

  loop: for (;;) {
    if (abortRequested()) {
      stopReason = 'aborted'
      break
    }

    const guardrail = evaluateGuardrails({
      turnsCompleted: turns,
      maxTurns,
      usage,
      budgetTokens,
    })
    if (guardrail.stop) {
      stopReason = guardrail.reason as StopReason
      transcript.append({ type: 'guardrail', reason: guardrail.reason, message: guardrail.message })
      break
    }

    const turn = turns + 1
    emit({ type: 'turn_start', turn })
    transcript.append({ type: 'turn_start', turn })

    // ── Auto context compaction ──
    // Trigger on the provider-reported input tokens of the previous request.
    // Best-effort: on failure the run continues with the history unchanged.
    if (
      compact.enabled &&
      !compactionExhausted &&
      lastInputTokens >= compact.limitTokens &&
      compactionAttempts < MAX_COMPACTION_ATTEMPTS
    ) {
      compactionAttempts += 1
      try {
        const compaction = await compactConversation({
          messages,
          provider: options.provider,
          dialect,
          model: options.model,
          keepRecentMessages: compact.keepRecentMessages,
          signal: options.signal,
        })
        if (compaction) {
          messages.splice(0, messages.length, ...compaction.messages)
          addUsage(usage, compaction.usage)
          compactions += 1
          lastInputTokens = 0
          transcript.append({
            type: 'context_compact',
            ok: true,
            summarizedMessages: compaction.summarizedMessages,
            keptMessages: compaction.keptMessages,
            summary: compaction.summary,
          })
          emit({
            type: 'context_compact',
            ok: true,
            summarizedMessages: compaction.summarizedMessages,
            keptMessages: compaction.keptMessages,
            message: null,
          })
        } else {
          // Nothing safely summarizable left; retrying every turn is pointless.
          compactionExhausted = true
        }
      } catch (error) {
        const message = describeError(error)
        transcript.append({
          type: 'context_compact',
          ok: false,
          summarizedMessages: 0,
          keptMessages: 0,
          message,
        })
        emit({
          type: 'context_compact',
          ok: false,
          summarizedMessages: 0,
          keptMessages: 0,
          message,
        })
      }
    }

    const request = translateRequest({
      dialect,
      system: options.system,
      messages,
      tools: registry.list(),
    })

    const streamInput: Record<string, unknown> = {
      messages: request.messages,
      tools: request.tools,
      // Cancellation must reach the HTTP request itself: without this, an
      // aborted run keeps waiting on a stream that will never advance.
      signal: options.signal,
      // The loop is the single owner of turn-level retries: it knows when
      // deltas have already streamed (no-replay invariant) and applies its
      // own backoff. Provider-internal retries would multiply the worst-case
      // request count (attempts × retries) — disabled for loop requests.
      maxRetries: 0,
    }
    if (dialect === 'anthropic') {
      streamInput.system = request.system ?? undefined
    }
    if (options.model) {
      streamInput.model = options.model
    }
    if (Number.isFinite(options.temperature)) {
      streamInput.temperature = options.temperature
    }
    if (Number.isFinite(options.maxTokens)) {
      streamInput.maxTokens = options.maxTokens
    }

    let outcome: TurnOutcome | null = null
    let turnDeltas = 0
    for (let attempt = 0; ; attempt += 1) {
      turnDeltas = 0
      const countingEmit = (event: LoopEvent): void => {
        if (event.type === 'text_delta' || event.type === 'reasoning_delta') turnDeltas += 1
        emit(event)
      }
      try {
        outcome = await consumeTurn(options.provider, streamInput, countingEmit, options.signal)
        if (abortRequested()) {
          stopReason = 'aborted'
          break
        }
        break
      } catch (error) {
        if (abortRequested()) {
          stopReason = 'aborted'
          break
        }
        // Protocol errors are terminal: replaying a malformed stream cannot
        // make it well-formed. Deltas already streamed forbid a replay too.
        const nonRetryable =
          error instanceof Error &&
          (error.name === 'ProtocolError' || error.message.startsWith('protocol_error:'))
        if (nonRetryable || turnDeltas > 0 || attempt + 1 >= providerAttempts) {
          stopReason = 'error'
          errorMessage = describeError(error)
          transcript.append({ type: 'error', message: errorMessage })
          break
        }
        const message = describeError(error)
        transcript.append({ type: 'provider_retry', attempt: attempt + 1, message })
        emit({ type: 'provider_retry', attempt: attempt + 1, message })
        const delay = Math.min(providerBackoffMs * 2 ** attempt, MAX_PROVIDER_BACKOFF_MS)
        await abortableDelay(delay, options.signal)
        if (abortRequested()) {
          stopReason = 'aborted'
          break
        }
      }
    }
    if (!outcome) break
    // The turn was cancelled mid-stream (partial outcome): never record it as
    // an assistant message — a truncated turn is not conversation history, and
    // a partial tool-call list would violate call/result pairing.
    if (outcome.aborted || abortRequested()) {
      stopReason = 'aborted'
      break
    }

    addUsage(usage, outcome.usage)
    lastInputTokens = outcome.inputTokens
    lastFinishReason = outcome.finishReason
    turns = turn

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      text: outcome.text === '' ? null : outcome.text,
      toolCalls: outcome.toolCalls,
    }
    messages.push(assistantMessage)
    transcript.append({ type: 'message', message: assistantMessage, turn })
    emit({
      type: 'assistant_message',
      text: assistantMessage.text,
      toolCalls: outcome.toolCalls,
    })
    transcript.append({
      type: 'usage',
      turn,
      usage: outcome.usage,
      finishReason: outcome.finishReason,
    })

    if (outcome.toolCalls.length === 0) {
      finalText = outcome.text
      stopReason = 'end_turn'
      transcript.append({ type: 'turn_end', turn, usage: outcome.usage })
      emit({ type: 'turn_end', turn, usage })
      break
    }

    for (const [index, call] of outcome.toolCalls.entries()) {
      if (abortRequested()) {
        stopReason = 'aborted'
        break loop
      }

      const toolCallId = toolCallIdFor(call, index)
      const executed = await executeToolCall({
        call,
        toolCallId,
        registry,
        toolContext,
        permissionMode: options.permissionMode,
        confirm: options.confirm,
        bashPolicy,
        emit,
        transcript,
      })
      executedCalls.push(executed.executed)

      // Stuck detector (P1.5): the same failing call repeating past its
      // thresholds gets a strategy nudge in the result the model sees, and
      // past the hard limit stops the run instead of burning the budget.
      let toolContent = executed.executed.result
      let stuckStop = false
      if (stuckDetector) {
        const verdict = stuckDetector.record({
          name: call.name,
          input: call.input,
          isError: executed.executed.isError,
        })
        if (verdict.action === 'nudge' || verdict.action === 'stop') {
          toolContent += `\n\n[stuck detector] ${verdict.message}`
        }
        if (verdict.action === 'stop') {
          stuckStop = true
          stopReason = 'stuck'
          errorMessage =
            `Stuck detector: the same failing call repeated ${verdict.streak} time(s) — ` +
            'stopping to protect the turn budget.'
        }
      }

      const toolMessage: ChatMessage = {
        role: 'tool',
        toolCallId,
        toolName: call.name,
        content: toolContent,
        isError: executed.executed.isError,
      }
      messages.push(toolMessage)
      transcript.append({ type: 'message', message: toolMessage, turn })
      if (stuckStop) break loop
    }

    transcript.append({ type: 'turn_end', turn, usage: outcome.usage })
    emit({ type: 'turn_end', turn, usage })
  }

  transcript.append({
    type: 'result',
    stopReason,
    turns,
    usage,
    error: errorMessage,
  })
  emit({ type: 'loop_end', stopReason, turns, usage })
  try {
    await transcript.flush()
  } catch (error) {
    // Persistence issues must not mask the loop result — but they must be
    // VISIBLE: the caller surfaces them as result warnings.
    warnings.push(
      `transcript write failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return {
    sessionId,
    stopReason,
    text: finalText,
    messages,
    toolCalls: executedCalls,
    usage,
    turns,
    compactions,
    finishReason: lastFinishReason,
    error: errorMessage,
    warnings,
    metrics: metricsCollector.snapshot(),
  }
}

/**
 * (Superseded by collectReadFilesFromMessages in resume.ts, which seeds from
 * successful execution facts rather than call intents.)
 */

async function consumeTurn(
  provider: LoopProvider,
  streamInput: Record<string, unknown>,
  emit: (event: LoopEvent) => void,
  signal?: AbortSignal,
): Promise<TurnOutcome> {
  const outcome: TurnOutcome = {
    text: '',
    reasoning: '',
    toolCalls: [],
    finishReason: null,
    usage: emptyUsage(),
    inputTokens: 0,
    messageId: null,
    model: null,
    sawResponseEnd: false,
    aborted: false,
  }

  for await (const chunk of provider.streamChat(streamInput)) {
    if (signal?.aborted) {
      break
    }
    if (!chunk || typeof chunk !== 'object') continue

    switch (chunk.type) {
      case 'response_start': {
        outcome.messageId = chunk.messageId ?? null
        outcome.model = chunk.model ?? null
        break
      }
      case 'text_delta': {
        if (typeof chunk.text === 'string') {
          outcome.text += chunk.text
          emit({ type: 'text_delta', text: chunk.text })
        }
        break
      }
      case 'reasoning_delta': {
        if (typeof chunk.text === 'string') {
          outcome.reasoning += chunk.text
          emit({ type: 'reasoning_delta', text: chunk.text })
        }
        break
      }
      case 'tool_call': {
        if (chunk.toolCall && typeof chunk.toolCall.name === 'string') {
          outcome.toolCalls.push({
            id: chunk.toolCall.id ?? null,
            name: chunk.toolCall.name,
            input: chunk.toolCall.input ?? {},
          })
        }
        break
      }
      case 'response_end': {
        outcome.finishReason = chunk.finishReason ?? null
        outcome.sawResponseEnd = true
        addUsage(outcome.usage, chunk.usage ?? null)
        if (chunk.usage && Number.isFinite(chunk.usage.inputTokens)) {
          outcome.inputTokens = chunk.usage.inputTokens
        }
        break
      }
      default:
        break
    }
  }

  // Cancellation is not an error: the partial outcome is flagged so the
  // caller records `aborted` instead of an (incomplete) assistant turn.
  if (signal?.aborted) {
    outcome.aborted = true
    return outcome
  }

  // A stream that ends without the provider's terminal event is a protocol
  // violation, not a successful empty turn: recording it as `end_turn` would
  // corrupt the transcript with a dangling assistant message.
  if (!outcome.sawResponseEnd) {
    const error: Error & { name: 'ProtocolError' } = Object.assign(
      new Error(
        `protocol_error: provider stream ended without response_end ` +
          `(text chars: ${outcome.text.length}, toolCalls: ${outcome.toolCalls.length})`,
      ),
      { name: 'ProtocolError' as const },
    )
    throw error
  }

  return outcome
}

async function executeToolCall(context: {
  call: ToolCall
  toolCallId: string
  registry: ToolRegistry
  toolContext: ToolContext
  permissionMode: PermissionMode
  confirm?: ConfirmHandler
  bashPolicy: BashPolicy
  emit: (event: LoopEvent) => void
  transcript: TranscriptWriter
}): Promise<{ executed: ExecutedToolCall }> {
  const { call, toolCallId, registry, toolContext, permissionMode, confirm, bashPolicy, emit, transcript } =
    context

  const startedAt = Date.now()
  const finalize = (result: string, isError: boolean, code?: ToolErrorCode): ExecutedToolCall => ({
    toolCallId,
    name: call.name,
    input: call.input,
    result,
    isError,
    durationMs: Date.now() - startedAt,
    ...(code !== undefined ? { code } : {}),
  })

  const tool = registry.get(call.name)
  if (!tool) {
    const available = registry
      .list()
      .map(registered => registered.name)
      .join(', ')
    const result = `Error: unknown tool "${call.name}". Available tools: ${available}`
    emit({ type: 'tool_execution_end', toolCallId, name: call.name, isError: true, durationMs: 0, preview: result })
    return { executed: finalize(result, true, 'not_found') }
  }

  // ── Permission gate ──
  if (permissionMode === 'agent' && !tool.readOnly && typeof confirm === 'function') {
    emit({ type: 'permission_request', toolCallId, name: call.name, input: call.input })
  }

  const decision = await checkPermission({
    mode: permissionMode,
    toolName: call.name,
    readOnly: tool.readOnly,
    input: call.input,
    confirm,
    bashPolicy,
  })

  if (!decision.allowed) {
    transcript.append({
      type: 'permission_denied',
      toolCallId,
      name: call.name,
      input: call.input,
      reason: decision.reason,
    })
    emit({
      type: 'permission_denied',
      toolCallId,
      name: call.name,
      input: call.input,
      reason: decision.reason,
    })
    const result = `Error: permission denied. ${decision.reason}`
    emit({
      type: 'tool_execution_end',
      toolCallId,
      name: call.name,
      isError: true,
      durationMs: 0,
      preview: truncatePreview(result),
    })
    return { executed: finalize(result, true, 'policy_denied') }
  }

  // ── Execute ──
  emit({ type: 'tool_execution_start', toolCallId, name: call.name, input: call.input })
  transcript.append({ type: 'tool_execution_start', toolCallId, name: call.name, input: call.input })

  let resultText: string
  let isError: boolean
  let code: ToolErrorCode | undefined

  // Contract enforcement (contracts/22 v2 / P1.1): a cancellable tool with a
  // declared deadline gets a loop-level timeout — the per-call signal is the
  // outer signal linked with the deadline, so the tool's own cancellation
  // handling winds it down. Non-cancellable tools are never raced (they
  // cannot honor abort; racing would leave a zombie execution).
  const contract = resolveToolContract(tool)
  const runWithContract = async (): Promise<ToolResult> => {
    if (!contract.cancellable || contract.timeoutMs === null) {
      return tool.execute(call.input, toolContext)
    }
    const perCall = new AbortController()
    const onOuterAbort = () => perCall.abort(toolContext.signal?.reason)
    if (toolContext.signal) {
      if (toolContext.signal.aborted) perCall.abort(toolContext.signal.reason)
      else toolContext.signal.addEventListener('abort', onOuterAbort, { once: true })
    }
    const timeoutError = Object.assign(
      new Error(`tool "${call.name}" exceeded its ${contract.timeoutMs}ms deadline`),
      { name: 'ToolTimeoutError' },
    )
    const timer = setTimeout(() => perCall.abort(timeoutError), contract.timeoutMs)
    const abortedPromise = new Promise<never>((_, reject) => {
      perCall.signal.addEventListener('abort', () => reject(perCall.signal.reason ?? timeoutError), {
        once: true,
      })
    })
    try {
      return await Promise.race([
        tool.execute(call.input, { ...toolContext, signal: perCall.signal }),
        abortedPromise,
      ])
    } finally {
      clearTimeout(timer)
      toolContext.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  try {
    const output = await runWithContract()
    resultText = output.content
    isError = output.isError === true
    code = output.code
  } catch (error) {
    resultText = `Error: tool "${call.name}" failed: ${describeError(error)}`
    isError = true
    const errorName = error instanceof Error ? error.name : ''
    if (errorName === 'ToolTimeoutError') {
      code = 'timeout'
    } else if (errorName === 'AbortError' || toolContext.signal?.aborted) {
      code = 'aborted'
    } else {
      code = 'failed'
    }
  }

  // Output budget (P1.1): declared byte caps are enforced by the loop so a
  // tool cannot flood the context, even if its own cap regresses.
  if (contract.outputLimitBytes !== null && Buffer.byteLength(resultText, 'utf8') > contract.outputLimitBytes) {
    let cut = contract.outputLimitBytes
    while (cut > 0 && (resultText.charCodeAt(cut) & 0xfc00) === 0xdc00) cut -= 1
    resultText = `${resultText.slice(0, cut)}\n[output truncated at ${contract.outputLimitBytes} bytes (tool contract)]`
  }

  const executed = finalize(resultText, isError, code)
  transcript.append({
    type: 'tool_execution_end',
    toolCallId,
    name: call.name,
    isError,
    durationMs: executed.durationMs,
    resultLength: resultText.length,
  })
  emit({
    type: 'tool_execution_end',
    toolCallId,
    name: call.name,
    isError,
    durationMs: executed.durationMs,
    preview: truncatePreview(resultText),
  })

  return { executed }
}
