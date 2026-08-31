/**
 * Print-mode harness wiring — connects the headless `-p` flow to the agent
 * loop: system prompt, progress rendering, confirmation prompt (TTY), and the
 * `--json` envelope.
 */

import { createInterface } from 'node:readline/promises'
import {
  runAgentLoop,
  createCoreTools,
  DEFAULT_MAX_TURNS,
} from '../harness/index.ts'

const TOOL_INPUT_PREVIEW_LENGTH = 120

export function buildAgentSystemPrompt(cwd) {
  return [
    'You are ZCode, a coding agent working directly in the user\'s workspace.',
    '',
    `Current working directory: ${cwd}`,
    '',
    'Rules of engagement:',
    '- Explore before you change: use Glob, Grep, and Read to understand the relevant code.',
    '- Make minimal, precise changes with Edit; create new files with Write.',
    '- Verify your changes with Bash (tests, builds, git). Only claim success when the',
    '  verification actually passed; report failures as-is.',
    '- Tool results are fed back to you each turn. If a call fails, adapt and retry.',
    '- Stop calling tools and write your final answer when the task is complete.',
  ].join('\n')
}

export function resolveGuardrailLimits(env = {}) {
  const maxTurnsEnv = Number.parseInt(env.ZCODE_MAX_TURNS ?? '', 10)
  const budgetEnv = Number.parseInt(env.ZCODE_BUDGET_TOKENS ?? '', 10)

  return {
    maxTurns: Number.isFinite(maxTurnsEnv) && maxTurnsEnv >= 1 ? maxTurnsEnv : DEFAULT_MAX_TURNS,
    budgetTokens: Number.isFinite(budgetEnv) && budgetEnv > 0 ? budgetEnv : null,
  }
}

function formatToolInputPreview(input) {
  let text
  try {
    text = JSON.stringify(input ?? {})
  } catch {
    text = String(input)
  }
  if (text.length > TOOL_INPUT_PREVIEW_LENGTH) {
    text = `${text.slice(0, TOOL_INPUT_PREVIEW_LENGTH)}…`
  }
  return text
}

function truncateForLine(text, maxLength = 160) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat
}

/**
 * Maps loop events to human-readable progress lines on stdout.
 * Returns an onEvent handler; deltas stream live, tool calls render as
 * `● Name({input})` with a result preview line underneath.
 */
export function createProgressRenderer({
  stdout,
  stderr,
  showReasoning = false,
} = {}) {
  const write = (chunk) => {
    if (stdout) stdout.write(chunk)
  }
  const writeErr = (chunk) => {
    if (stderr) stderr.write(chunk)
  }

  return function onEvent(event) {
    switch (event.type) {
      case 'text_delta':
        write(event.text)
        break
      case 'reasoning_delta':
        if (showReasoning) writeErr(`  ∴ ${truncateForLine(event.text, 200)}\n`)
        break
      case 'assistant_message':
        if (event.text) write('\n')
        break
      case 'tool_execution_start':
        write(`\n● ${event.name}(${formatToolInputPreview(event.input)})\n`)
        break
      case 'tool_execution_end':
        write(
          event.isError
            ? `  ✗ ${truncateForLine(event.preview)}\n`
            : `  ✓ ${truncateForLine(event.preview)}\n`,
        )
        break
      case 'permission_denied':
        write(`  ⚠ permission denied: ${truncateForLine(event.reason)}\n`)
        break
      case 'loop_end':
        if (event.stopReason === 'max_turns' || event.stopReason === 'budget_exceeded') {
          write(
            `\n⚠ Stopped by guardrail (${event.stopReason}) after ${event.turns} turn(s) — ` +
              'progress is reported as-is.\n',
          )
        } else if (event.stopReason === 'error') {
          write(`\n✗ Loop stopped on an error after ${event.turns} turn(s).\n`)
        } else {
          write('\n')
        }
        break
      default:
        break
    }
  }
}

/**
 * Interactive y/n confirmation for Agent mode; fails closed when stdin is
 * not a TTY (headless runs should use --yolo or --plan).
 */
export function createInteractiveConfirm({ stdin, stdout } = {}) {
  if (!stdin || stdin.isTTY !== true) {
    return null
  }

  return async function confirm({ toolName, input }) {
    const rl = createInterface({ input: stdin, output: stdout ?? undefined, terminal: true })
    try {
      const preview = formatToolInputPreview(input)
      const answer = await rl.question(`Allow ${toolName}(${preview})? [y/N] `)
      return answer.trim().toLowerCase() === 'y'
    } finally {
      rl.close()
    }
  }
}

/**
 * Runs the full agent loop for print mode and returns the print result
 * (superset of the legacy collectPrintResponse shape).
 */
export async function runHarnessPrint({
  prompt,
  model,
  provider,
  permissionMode,
  confirm,
  cwd,
  maxTurns,
  budgetTokens,
  showReasoning = false,
  onEvent,
  transcript = { enabled: true },
  signal,
  reasoning = undefined,
}) {
  const resolvedModel = model || provider?.listModels?.()?.[0]?.id || null

  const result = await runAgentLoop({
    provider,
    model: resolvedModel,
    system: buildAgentSystemPrompt(cwd),
    tools: createCoreTools(),
    messages: [{ role: 'user', content: prompt }],
    permissionMode,
    confirm,
    maxTurns,
    budgetTokens,
    cwd,
    onEvent,
    transcript,
    signal,
  })

  return {
    sessionId: result.sessionId,
    messageId: null,
    provider: provider?.id ?? 'unknown',
    model: model || resolvedModel,
    text: result.text,
    toolCalls: result.toolCalls.map(call => ({
      id: call.toolCallId,
      name: call.name,
      input: call.input,
      result: call.result,
      isError: call.isError,
      durationMs: call.durationMs,
    })),
    finishReason: result.finishReason ?? 'stop',
    stopReason: result.stopReason,
    turns: result.turns,
    usage: result.usage,
    ...(reasoning ? { reasoning } : {}),
    ...(result.error ? { error: result.error } : {}),
  }
}
