/**
 * Usage accounting helpers shared by the loop and compaction.
 */

import type { UsageSummary } from './types.ts'

export function emptyUsage(): UsageSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

export function addUsage(target: UsageSummary, usage?: Partial<UsageSummary> | null): void {
  if (!usage) return
  const input = typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
    ? usage.inputTokens
    : 0
  const output = typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens)
    ? usage.outputTokens
    : 0
  const total = typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : input + output
  target.inputTokens += input
  target.outputTokens += output
  target.totalTokens += total
}
