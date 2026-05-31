import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * Non-nullable mapped type over BetaUsage.
 *
 * Makes all nullable fields required and non-null. Excludes
 * output_tokens_details, which is intentionally kept off the type so the
 * string is eliminated from external builds by dead code elimination.
 */
export type NonNullableUsage = {
  [K in keyof Omit<BetaUsage, 'output_tokens_details'>]: NonNullable<BetaUsage[K]>
}
