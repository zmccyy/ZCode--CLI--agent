/**
 * Bounded stuck detector — roadmap P1.5 (architecture/12).
 *
 * A model can burn the whole turn budget retrying the exact same failing
 * call. The detector tracks CONSECUTIVE identical failed calls (same tool +
 * same input). Thresholds are deliberately low and bounded:
 *
 *   - at `nudgeAfter` (default 3) identical failures in a row: a strategy
 *     nudge is appended to the tool result the model sees next;
 *   - at `stopAfter` (default 5): the caller should stop the loop entirely
 *     ('stuck' stop reason) instead of feeding the dead path more turns.
 *
 * Any success or a different call resets the streak — legitimate retries
 * (flaky network) and normal exploration are never penalized.
 */

interface StuckRecordInput {
  name: string
  input: unknown
  isError: boolean
}

export type StuckVerdict =
  | { action: 'none'; streak: number }
  | { action: 'nudge'; streak: number; message: string }
  | { action: 'stop'; streak: number; message: string }

const NUDGE_MESSAGE =
  'This exact call has failed repeatedly with the same input. Do NOT retry it unchanged: ' +
  'change strategy — narrow the request (smaller range, different file), use a different tool, ' +
  'or if the goal is genuinely blocked, stop and tell the user what you need.'

/** Key order-independent serialization so {a,b} and {b,a} match. */
function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`)
  return `{${entries.join(',')}}`
}

export function createStuckDetector({ nudgeAfter = 3, stopAfter = 5 } = {}) {
  const effectiveNudgeAfter = Math.max(1, nudgeAfter)
  const effectiveStopAfter = Math.max(effectiveNudgeAfter, stopAfter)
  let lastKey: string | null = null
  let streak = 0

  return {
    /** Called once per executed tool call; returns the bounded verdict. */
    record({ name, input, isError }: StuckRecordInput): StuckVerdict {
      const key = `${name}:${stableKey(input)}`
      if (!isError) {
        lastKey = null
        streak = 0
        return { action: 'none', streak: 0 }
      }
      streak = key === lastKey ? streak + 1 : 1
      lastKey = key

      if (streak >= effectiveStopAfter) {
        return {
          action: 'stop',
          streak,
          message: `${NUDGE_MESSAGE} (failed ${streak} times — the run will be stopped)`,
        }
      }
      if (streak >= effectiveNudgeAfter) {
        return { action: 'nudge', streak, message: `${NUDGE_MESSAGE} (failed ${streak} times in a row)` }
      }
      return { action: 'none', streak }
    },
  }
}
