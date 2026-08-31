/**
 * Permission gate — Plan / Agent / YOLO.
 *
 * Plan: read-only tools run freely; anything else is denied with guidance.
 * Agent: read-only tools run freely; write tools require the confirm callback.
 * YOLO: everything runs without prompting.
 *
 * Fail-closed: Agent mode without an approver denies.
 */

import type { ConfirmHandler, PermissionMode } from './types.ts'

export const PERMISSION_MODES: readonly PermissionMode[] = Object.freeze([
  'plan',
  'agent',
  'yolo',
])

export interface PermissionDecision {
  allowed: boolean
  reason: string
}

export function describeMode(mode: PermissionMode): string {
  switch (mode) {
    case 'plan':
      return 'Plan mode: read-only exploration, no writes or commands'
    case 'agent':
      return 'Agent mode: ask before every non-read-only tool call'
    case 'yolo':
      return 'YOLO mode: auto-approve all tool calls'
  }
}

export async function checkPermission(options: {
  mode: PermissionMode
  toolName: string
  readOnly: boolean
  input: unknown
  confirm?: ConfirmHandler
}): Promise<PermissionDecision> {
  const { mode, toolName, readOnly, input, confirm } = options

  if (mode === 'yolo') {
    return { allowed: true, reason: 'YOLO mode auto-approves all tool calls' }
  }

  if (readOnly) {
    return { allowed: true, reason: 'read-only tool' }
  }

  if (mode === 'plan') {
    return {
      allowed: false,
      reason:
        `Plan mode is read-only: "${toolName}" requires write access. ` +
        'Explore and plan instead, or present the change for approval.',
    }
  }

  if (typeof confirm === 'function') {
    let approved: boolean
    try {
      approved = await confirm({ toolName, input, reason: 'not read-only' })
    } catch (error) {
      return {
        allowed: false,
        reason: `Permission check failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return approved
      ? { allowed: true, reason: 'approved by user' }
      : { allowed: false, reason: 'The user declined this tool call.' }
  }

  return {
    allowed: false,
    reason:
      `Agent mode requires explicit approval for "${toolName}", but no approver is available ` +
      'in this non-interactive session. Re-run with --yolo to auto-approve, or use Plan mode.',
  }
}
