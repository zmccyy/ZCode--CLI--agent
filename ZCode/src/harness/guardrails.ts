/**
 * Guardrails — the loop's two hard stop lines: max turns and token budget.
 */

import type { UsageSummary } from './types.ts'

export const DEFAULT_MAX_TURNS = 30

export interface GuardrailCheck {
  stop: boolean
  reason: 'max_turns' | 'budget_exceeded' | null
  message: string | null
}

export function evaluateGuardrails(options: {
  turnsCompleted: number
  maxTurns: number
  usage: UsageSummary
  budgetTokens: number | null
}): GuardrailCheck {
  const { turnsCompleted, maxTurns, usage, budgetTokens } = options

  if (turnsCompleted >= maxTurns) {
    return {
      stop: true,
      reason: 'max_turns',
      message:
        `Guardrail reached: ${turnsCompleted} turns (max ${maxTurns}). ` +
        'The loop stopped before the model finished; progress is reported as-is.',
    }
  }

  if (budgetTokens !== null && usage.totalTokens >= budgetTokens) {
    return {
      stop: true,
      reason: 'budget_exceeded',
      message:
        `Guardrail reached: ${usage.totalTokens} tokens used (budget ${budgetTokens}). ` +
        'The loop stopped before the model finished; progress is reported as-is.',
    }
  }

  return { stop: false, reason: null, message: null }
}
