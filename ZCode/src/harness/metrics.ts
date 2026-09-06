/**
 * Run metrics — the observability side-channel of the agent loop.
 *
 * A collector consumes the exact same LoopEvent stream the caller observes
 * (the loop feeds its own emit through it) and aggregates per-turn timings
 * (duration, time-to-first-token), per-tool aggregates (count, total time,
 * errors), provider retries, token usage, and a final RSS sample. Pure
 * aggregation: nothing here prints or decides.
 *
 * Shape is part of the print-mode JSON contract, so fields are additive-only.
 */

import type { LoopEvent, UsageSummary } from './types.ts'

export interface TurnMetrics {
  turn: number
  /** Wall time from turn_start to turn_end. */
  durationMs: number
  /** turn_start → first text/reasoning delta; null when the turn never streamed. */
  ttftMs: number | null
  usage: UsageSummary
}

export interface ToolMetrics {
  name: string
  count: number
  totalDurationMs: number
  errors: number
}

export interface RunMetrics {
  totalDurationMs: number
  turns: TurnMetrics[]
  tools: ToolMetrics[]
  retries: number
  tokens: UsageSummary
  /** Resident set size sampled when the loop ended. */
  rssBytes: number
  stopReason: string
}

export function createRunMetricsCollector() {
  const startedAt = Date.now()
  const turns: TurnMetrics[] = []
  const toolByName = new Map<string, ToolMetrics>()
  const tokens: UsageSummary = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  let retries = 0
  let stopReason = 'unknown'

  let currentTurn: number | null = null
  let turnStartedAt = 0
  let firstDeltaAt: number | null = null

  const addUsage = (usage: UsageSummary | undefined): void => {
    if (!usage) return
    tokens.inputTokens += usage.inputTokens ?? 0
    tokens.outputTokens += usage.outputTokens ?? 0
    tokens.totalTokens += usage.totalTokens ?? 0
  }

  return {
    /** Feed every loop event; never throws. */
    onLoopEvent(event: LoopEvent): void {
      try {
        switch (event.type) {
          case 'turn_start':
            currentTurn = event.turn
            turnStartedAt = Date.now()
            firstDeltaAt = null
            break
          case 'text_delta':
          case 'reasoning_delta':
            if (currentTurn !== null && firstDeltaAt === null) firstDeltaAt = Date.now()
            break
          case 'tool_execution_end': {
            let entry = toolByName.get(event.name)
            if (!entry) {
              entry = { name: event.name, count: 0, totalDurationMs: 0, errors: 0 }
              toolByName.set(event.name, entry)
            }
            entry.count += 1
            entry.totalDurationMs += event.durationMs ?? 0
            if (event.isError) entry.errors += 1
            break
          }
          case 'provider_retry':
            retries += 1
            break
          case 'turn_end':
            if (currentTurn !== null) {
              turns.push({
                turn: event.turn,
                durationMs: Date.now() - turnStartedAt,
                ttftMs: firstDeltaAt === null ? null : firstDeltaAt - turnStartedAt,
                usage: { ...event.usage },
              })
            }
            addUsage(event.usage)
            currentTurn = null
            break
          case 'loop_end':
            stopReason = event.stopReason
            break
          default:
            break
        }
      } catch {
        // Metrics must never break the loop that feeds them.
      }
    },

    /** Final aggregation, called once when the loop returns. */
    snapshot(): RunMetrics {
      return {
        totalDurationMs: Date.now() - startedAt,
        turns: [...turns],
        tools: [...toolByName.values()].sort((a, b) => b.count - a.count),
        retries,
        tokens: { ...tokens },
        rssBytes: process.memoryUsage().rss,
        stopReason,
      }
    },
  }
}
