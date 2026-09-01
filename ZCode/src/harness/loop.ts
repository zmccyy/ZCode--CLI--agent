/**
 * Agent loop — the heart of the harness.
 *
 * Think → Act → Observe: stream a model response, execute requested tool
 * calls, feed results back, repeat until the model stops calling tools or a
 * guardrail fires. Provider-agnostic: wire formats are translated per the
 * provider's dialect before every request.
 */

import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
  ToolSessionState,
  UsageSummary,
} from './types.ts'
import { createToolRegistry, type ToolRegistry } from './tools/registry.ts'
import { resolveDialect, translateRequest, toolCallIdFor } from './translate.ts'
import { createTranscriptWriter, type TranscriptWriter } from './transcript.ts'
import { checkPermission } from './permissions.ts'
import { evaluateGuardrails } from './guardrails.ts'
import { emptyUsage, addUsage } from './usage.ts'
import {
  compactConversation,
  resolveCompactConfig,
  type CompactOptions,
  type ResolvedCompactConfig,
} from './compact.ts'

const DEFAULT_MAX_TURNS = 30
const TOOL_RESULT_PREVIEW_LENGTH = 160
/** Cap on compaction attempts per run so a failing summarizer cannot spin. */
const MAX_COMPACTION_ATTEMPTS = 5

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
  /** Auto context compaction; disabled when limitTokens is 0. */
  compact?: CompactOptions
  /** Seed the loop with a prior session's history (see resume.ts). */
  resume?: { sessionId: string; messages: ChatMessage[] }
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

  const emit = (event: LoopEvent): void => {
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

  const toolContext: ToolContext = { cwd: options.cwd, state, signal: options.signal }

  let stopReason: StopReason = 'end_turn'
  let lastFinishReason: string | null = null
  let finalText = ''
  let errorMessage: string | null = null
  let turns = 0

  transcript.append({
    type: 'session_start',
    sessionId,
    cwd: options.cwd,
    model: options.model ?? null,
    permissionMode: options.permissionMode,
    provider: options.provider.id,
    dialect,
    ...(options.resume ? { resumedFrom: options.resume.sessionId } : {}),
  })
  if (options.resume) {
    messages.unshift(...options.resume.messages)
    transcript.append({
      type: 'resumed',
      fromSessionId: options.resume.sessionId,
      messages: options.resume.messages.length,
    })
    for (const message of options.resume.messages) {
      rebuildReadFilesFromMessage(message, options.cwd, state)
      // Copy the restored history into the new transcript so the session file
      // is self-contained and can itself be resumed later.
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

    let outcome: TurnOutcome
    try {
      outcome = await consumeTurn(options.provider, streamInput, emit, options.signal)
    } catch (error) {
      if (abortRequested()) {
        stopReason = 'aborted'
      } else {
        stopReason = 'error'
        errorMessage = describeError(error)
        transcript.append({ type: 'error', message: errorMessage })
      }
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
        emit,
        transcript,
      })
      executedCalls.push(executed.executed)

      const toolMessage: ChatMessage = {
        role: 'tool',
        toolCallId,
        toolName: call.name,
        content: executed.executed.result,
        isError: executed.executed.isError,
      }
      messages.push(toolMessage)
      transcript.append({ type: 'message', message: toolMessage, turn })
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
  } catch {
    // Transcript persistence issues must not mask the loop result.
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
  }
}

/**
 * Seeds `state.readFiles` from a resumed session's messages so Edit/Write
 * keep their read-before-edit precondition across sessions: every Read the
 * prior session executed (visible as assistant tool calls) marks that file.
 */
function rebuildReadFilesFromMessage(
  message: ChatMessage,
  cwd: string,
  state: ToolSessionState,
): void {
  if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) return
  for (const call of message.toolCalls) {
    if (call.name !== 'Read') continue
    const filePath =
      call.input && typeof call.input === 'object' && 'file_path' in call.input
        ? (call.input as Record<string, unknown>).file_path
        : null
    if (typeof filePath !== 'string' || filePath.trim() === '') continue
    state.readFiles.add(
      path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath),
    )
  }
}

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

  return outcome
}

async function executeToolCall(context: {
  call: ToolCall
  toolCallId: string
  registry: ToolRegistry
  toolContext: ToolContext
  permissionMode: PermissionMode
  confirm?: ConfirmHandler
  emit: (event: LoopEvent) => void
  transcript: TranscriptWriter
}): Promise<{ executed: ExecutedToolCall }> {
  const { call, toolCallId, registry, toolContext, permissionMode, confirm, emit, transcript } =
    context

  const startedAt = Date.now()
  const finalize = (result: string, isError: boolean): ExecutedToolCall => ({
    toolCallId,
    name: call.name,
    input: call.input,
    result,
    isError,
    durationMs: Date.now() - startedAt,
  })

  const tool = registry.get(call.name)
  if (!tool) {
    const available = registry
      .list()
      .map(registered => registered.name)
      .join(', ')
    const result = `Error: unknown tool "${call.name}". Available tools: ${available}`
    emit({ type: 'tool_execution_end', toolCallId, name: call.name, isError: true, durationMs: 0, preview: result })
    return { executed: finalize(result, true) }
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
    return { executed: finalize(result, true) }
  }

  // ── Execute ──
  emit({ type: 'tool_execution_start', toolCallId, name: call.name, input: call.input })
  transcript.append({ type: 'tool_execution_start', toolCallId, name: call.name, input: call.input })

  let resultText: string
  let isError = false
  try {
    const output = await tool.execute(call.input, toolContext)
    resultText = output.content
    isError = output.isError === true
  } catch (error) {
    resultText = `Error: tool "${call.name}" failed: ${describeError(error)}`
    isError = true
  }

  const executed = finalize(resultText, isError)
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
