/**
 * Usage accounting helpers shared by the loop and compaction.
 */

import type { UsageSummary } from './types.ts'

export function emptyUsage(): UsageSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

export function addUsage(target: UsageSummary, usage?: Partial<UsageSummary> | null): void {
  if (!usage) return
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0
  const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0
  target.inputTokens += input
  target.outputTokens += output
  target.totalTokens += Number.isFinite(usage.totalTokens) ? usage.totalTokens : input + output
}
