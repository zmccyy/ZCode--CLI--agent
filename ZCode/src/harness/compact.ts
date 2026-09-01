/**
 * Auto context compaction — keep long agent runs inside the context window.
 *
 * Trigger: the provider-reported input tokens of the last request reach the
 * configured limit. Action: summarize the older part of the conversation with
 * one tool-less model request, replace that part with the summary, and keep
 * the most recent messages verbatim. Best-effort: a failed or empty summary
 * never breaks the loop — the run continues uncompacted.
 */

import type { ChatMessage, LoopProvider, UsageSummary, WireDialect } from './types.ts'
import { emptyUsage, addUsage } from './usage.ts'
import { toOpenAIMessages, toAnthropicMessages } from './translate.ts'

export interface CompactOptions {
  enabled?: boolean
  /**
   * Compaction triggers when the last request's input tokens reach this
   * limit. 0 disables compaction. Default: DEFAULT_COMPACT_LIMIT_TOKENS.
   */
  limitTokens?: number
  /** Recent messages kept verbatim after compaction. Default: 6. */
  keepRecentMessages?: number
}

export const DEFAULT_COMPACT_LIMIT_TOKENS = 100_000
export const DEFAULT_COMPACT_KEEP_MESSAGES = 6

const COMPACTION_INSTRUCTION = [
  'Summarize the conversation above for a continuation agent that will pick up',
  'the task with only this summary plus the most recent messages. Capture:',
  '- the user\'s original task and any success criteria,',
  '- files explored and the exact changes made so far (paths, edits, commands),',
  '- verification results (test/build runs and their outcomes),',
  '- what remains to be done and any pitfalls discovered.',
  'Be specific and factual; names, paths, and commands must survive verbatim.',
  'Reply with the summary only.',
].join('\n')

export interface ResolvedCompactConfig {
  enabled: boolean
  limitTokens: number
  keepRecentMessages: number
}

export function resolveCompactConfig(compact?: CompactOptions): ResolvedCompactConfig {
  const limit =
    Number.isFinite(compact?.limitTokens) && (compact?.limitTokens as number) >= 0
      ? Math.floor(compact?.limitTokens as number)
      : DEFAULT_COMPACT_LIMIT_TOKENS
  const keep =
    Number.isFinite(compact?.keepRecentMessages) && (compact?.keepRecentMessages as number) >= 1
      ? Math.floor(compact?.keepRecentMessages as number)
      : DEFAULT_COMPACT_KEEP_MESSAGES

  return {
    enabled: compact?.enabled !== false && limit > 0,
    limitTokens: limit,
    keepRecentMessages: keep,
  }
}

/**
 * Index where the retained tail starts, or -1 when there is nothing to
 * summarize. The tail must never start on a dangling tool result, so the
 * boundary walks back over `tool` messages to include their assistant turn.
 */
export function selectCompactionBoundary(messages: ChatMessage[], keepRecent: number): number {
  if (messages.length < 2) return -1
  let start = Math.max(1, messages.length - Math.max(1, keepRecent))
  while (start > 1 && messages[start]?.role === 'tool') {
    start -= 1
  }
  return start < messages.length ? start : -1
}

export function buildSummaryMessage(summary: string): ChatMessage {
  return {
    role: 'user',
    content: [
      '[Auto-compacted conversation]',
      'The earlier part of this session was summarized to free context space.',
      'Summary of that earlier part:',
      '',
      summary,
      '',
      'Continue the task from here; the recent messages below are verbatim.',
    ].join('\n'),
  }
}

async function summarizeConversation(options: {
  provider: LoopProvider
  dialect: WireDialect
  model?: string | null
  head: ChatMessage[]
  signal?: AbortSignal
}): Promise<{ summary: string; usage: UsageSummary }> {
  const { provider, dialect, model, head, signal } = options
  const withInstruction: ChatMessage[] = [
    ...head,
    { role: 'user', content: COMPACTION_INSTRUCTION },
  ]
  const wire =
    dialect === 'anthropic'
      ? toAnthropicMessages(null, withInstruction)
      : toOpenAIMessages(null, withInstruction)

  // No tools on the summary request: the model must answer with text.
  const streamInput: Record<string, unknown> = { messages: wire }
  if (model) {
    streamInput.model = model
  }

  let summary = ''
  const usage = emptyUsage()
  for await (const chunk of provider.streamChat(streamInput)) {
    if (signal?.aborted) break
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text_delta' && typeof chunk.text === 'string') {
      summary += chunk.text
    } else if (chunk.type === 'response_end') {
      addUsage(usage, chunk.usage ?? null)
    }
  }

  if (summary.trim() === '') {
    throw new Error('compaction summary request returned no text')
  }
  return { summary: summary.trim(), usage }
}

export interface CompactionOutcome {
  messages: ChatMessage[]
  summary: string
  summarizedMessages: number
  keptMessages: number
  usage: UsageSummary
}

/**
 * Runs one compaction pass. Returns null when the history has nothing safely
 * summarizable; throws on provider failure so the caller decides fallback.
 */
export async function compactConversation(options: {
  messages: ChatMessage[]
  provider: LoopProvider
  dialect: WireDialect
  model?: string | null
  keepRecentMessages: number
  signal?: AbortSignal
}): Promise<CompactionOutcome | null> {
  const { messages, provider, dialect, model, keepRecentMessages, signal } = options
  const boundary = selectCompactionBoundary(messages, keepRecentMessages)
  if (boundary <= 0) return null

  const head = messages.slice(0, boundary)
  const tail = messages.slice(boundary)
  const { summary, usage } = await summarizeConversation({
    provider,
    dialect,
    model,
    head,
    signal,
  })

  return {
    messages: [buildSummaryMessage(summary), ...tail],
    summary,
    summarizedMessages: head.length,
    keptMessages: tail.length,
    usage,
  }
}
