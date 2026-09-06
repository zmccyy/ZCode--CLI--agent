/**
 * Print-mode harness wiring — connects the headless `-p` flow to the agent
 * loop: system prompt, progress rendering, confirmation prompt (TTY), and the
 * `--json` envelope.
 */

import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import {
  runAgentLoop,
  createCoreTools,
  DEFAULT_MAX_TURNS,
  DEFAULT_COMPACT_LIMIT_TOKENS,
  DEFAULT_COMPACT_KEEP_MESSAGES,
  resolveCompactConfig as resolveCompactOptions,
} from '../harness/index.ts'
import { collectEnvironmentInfo, formatEnvironmentBlock } from './envInfo.js'
import { collectProjectMemory } from './projectMemory.js'
import { buildDiffPreviewForTool, readOldContentForPreview } from './diffPreview.js'

const TOOL_INPUT_PREVIEW_LENGTH = 120

/**
 * Boundary note for the system prompt: when the workspace boundary is on
 * (the default), the model is told which roots exist so it stops reaching
 * outside and, when needed, asks the user for --add-dir instead.
 */
function describeBoundaryForPrompt(cwd, boundary) {
  if (boundary === false) {
    return 'Workspace boundary: disabled (--no-boundary). File tools can access the whole machine.'
  }
  const roots = [path.resolve(cwd)]
  for (const dir of boundary?.addDirs ?? []) {
    if (typeof dir === 'string' && dir.trim() !== '') roots.push(path.resolve(cwd, dir.trim()))
  }
  return (
    `Workspace boundary: file tools (Read/Glob/Grep/Write/Edit) can only access these ` +
    `root(s): ${roots.join(', ')}. Paths outside resolve to an error; work inside the ` +
    'workspace or ask the user to extend the boundary with --add-dir.'
  )
}

const WORKFLOW_DISCIPLINE = [
  '# How to work',
  '',
  '1. Understand before acting. Read the relevant code with Glob/Grep/Read before changing',
  '   anything. If the request is ambiguous, pick the most reasonable interpretation, state',
  '   the assumption, and proceed — do not stall waiting for clarification you can infer.',
  '2. Plan multi-step work. For any task beyond a couple of steps, state the steps you will',
  '   take, then execute them one at a time, checking each result before moving on.',
  '3. Make minimal, precise changes. Produce the smallest diff that solves the problem.',
  '   Match the surrounding code: naming, formatting, comment density, and idiom. Do not',
  '   reformat unrelated code, do not add speculative error handling or features the user',
  '   did not ask for, and never invent dependencies that are not already installed.',
  '4. Verify before claiming success. After changing code, run the relevant tests, builds,',
  '   or commands with Bash to prove it works. Only claim success when verification actually',
  '   passed; report failures as-is and fix them when you can. Never say you ran something',
  '   you did not run.',
  '5. Recover from failures. When a tool call fails, read the error, adjust the approach,',
  '   and retry differently — never repeat the exact same failing call. After 2–3 failed',
  '   attempts at the same thing, step back, summarize what you learned, and either change',
  '   strategy or report the blocker.',
  '6. Finish cleanly. When the task is complete, stop calling tools and write a concise',
  '   final summary: what changed (files and why), what you verified (commands and results),',
  '   and anything the user must do manually. Lead with the outcome.',
].join('\n')

const PLAN_MODE_DISCIPLINE = [
  '# Plan mode (read-only)',
  '',
  'You are in plan mode. Investigate the codebase with Read/Glob/Grep and read-only Bash',
  'commands only — file modifications and state-changing commands are blocked in this mode.',
  'Produce a concrete implementation plan instead of making changes:',
  '- State the goal and your understanding of the relevant code (files, functions, current behavior).',
  '- List the exact changes you would make, file by file, with enough detail to implement directly.',
  '- Note risks, open questions, and how you would verify the change afterwards.',
].join('\n')

const TOOL_GUIDANCE = [
  '# Tool guidance',
  '',
  '- Prefer the dedicated tools over shell one-liners: use Read/Glob/Grep for inspection,',
  '  not `cat`/`find`/`grep` in Bash — they are faster, safer, and respect the workspace boundary.',
  '- Issue several independent Read/Glob/Grep calls together in one turn instead of one per turn.',
  '- For multi-step tasks, keep a TodoWrite list current: one item per concrete step, exactly',
  '  one in_progress at a time, completed only after its verification passed.',
  '- Edit is the way to change existing files; Read the file first (enforced). Use Write only',
  '  for new files or complete rewrites. old_string in Edit must match exactly and uniquely.',
  '- Bash runs non-interactively via Git Bash on Windows: stdin is not connected, so use',
  '  non-interactive flags (`git commit -m`, `npm install --yes`) and never editors/pagers.',
  '  Output past 30,000 characters is truncated; set a sensible `timeout` for slow commands',
  '  (default 120000 ms, max 600000 ms).',
  '- WebFetch reaches public pages only (no intranet/auth); prefer it for documentation lookups',
  '  over guessing APIs from memory.',
  '- File tools accept absolute paths or paths relative to the working directory; both',
  '  forward slashes and backslashes work.',
].join('\n')

const COMMUNICATION_GUIDANCE = [
  '# Communication',
  '',
  '- Progress notes between tool calls are fine, but keep them short; the final message is',
  '  what the user reads and must be self-contained.',
  '- Answer in the language the user wrote in.',
  '- Be factual: state what you did, what you verified, and what remains. No filler, no',
  '  restating the task back, no unverified "should work" claims.',
].join('\n')

/**
 * Builds the agent system prompt. `options.envInfo` (from
 * collectEnvironmentInfo) is rendered into an <environment> block; when
 * absent the prompt degrades to cwd-only facts. `options.permissionMode`
 * switches the discipline block (plan mode is read-only and outputs a plan).
 * `options.memory` (rendered text from collectProjectMemory) appends the
 * project's AGENTS.md/ZCODE.md instructions.
 */
export function buildAgentSystemPrompt(cwd, boundary, options = {}) {
  const { envInfo = null, permissionMode = 'agent', model = null, memory = '' } = options
  const identity =
    'You are ZCode, an interactive CLI coding agent working directly in the user\'s workspace ' +
    'from their terminal. You turn requests into verified, working changes.'

  // Environment facts come from the shared renderer (envInfo.js) so the
  // prompt, the doctor, and the TUI status line can never drift apart.
  const envLines = envInfo
    ? formatEnvironmentBlock(envInfo).split('\n')
    : [`cwd: ${cwd}`]
  if (model) envLines.push(`model: ${model}`)
  envLines.push(
    `permission mode: ${permissionMode}` +
      (permissionMode === 'plan'
        ? ' (read-only: produce a plan, do not modify anything)'
        : permissionMode === 'yolo'
          ? ' (actions run without per-call approval)'
          : ' (writes and commands require user approval)'),
  )

  const discipline = permissionMode === 'plan' ? PLAN_MODE_DISCIPLINE : WORKFLOW_DISCIPLINE

  const sections = [
    identity,
    '',
    '<environment>',
    ...envLines,
    describeBoundaryForPrompt(cwd, boundary),
    '</environment>',
    '',
    discipline,
    '',
    TOOL_GUIDANCE,
    '',
    COMMUNICATION_GUIDANCE,
  ]
  if (typeof memory === 'string' && memory.trim() !== '') {
    sections.push('', memory)
  }
  return sections.join('\n')
}

export function resolveGuardrailLimits(env = {}) {
  const maxTurnsEnv = Number.parseInt(env.ZCODE_MAX_TURNS ?? '', 10)
  const budgetEnv = Number.parseInt(env.ZCODE_BUDGET_TOKENS ?? '', 10)

  return {
    maxTurns: Number.isFinite(maxTurnsEnv) && maxTurnsEnv >= 1 ? maxTurnsEnv : DEFAULT_MAX_TURNS,
    budgetTokens: Number.isFinite(budgetEnv) && budgetEnv > 0 ? budgetEnv : null,
  }
}

/**
 * Auto-compaction config from the environment:
 * - ZCODE_COMPACT_TOKENS: input-token threshold that triggers compaction
 *   (default 100000; 0 disables).
 * - ZCODE_COMPACT_KEEP_MESSAGES: recent messages kept verbatim (default 6).
 */
export function resolveCompactFromEnv(env = {}) {
  const limitEnv = Number.parseInt(env.ZCODE_COMPACT_TOKENS ?? '', 10)
  const keepEnv = Number.parseInt(env.ZCODE_COMPACT_KEEP_MESSAGES ?? '', 10)

  return resolveCompactOptions({
    limitTokens:
      Number.isFinite(limitEnv) && limitEnv >= 0 ? limitEnv : DEFAULT_COMPACT_LIMIT_TOKENS,
    keepRecentMessages:
      Number.isFinite(keepEnv) && keepEnv >= 1 ? keepEnv : DEFAULT_COMPACT_KEEP_MESSAGES,
  })
}

export function formatToolInputPreview(input) {
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
 * `● Name({input})` with a result preview line underneath. Pass a styler
 * (createStyler from ./ansi.js) to colorize tool activity; without one the
 * output stays plain.
 */
export function createProgressRenderer({
  stdout,
  stderr,
  showReasoning = false,
  styler = null,
} = {}) {
  const s = styler ?? { dim: t => t, red: t => t, green: t => t, yellow: t => t, cyan: t => t }
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
        write(`\n${s.cyan(`● ${event.name}`)}(${formatToolInputPreview(event.input)})\n`)
        break
      case 'tool_execution_end':
        write(
          event.isError
            ? `  ${s.red(`✗ ${truncateForLine(event.preview)}`)}\n`
            : `  ${s.green(`✓ ${truncateForLine(event.preview)}`)}\n`,
        )
        break
      case 'context_compact':
        if (event.ok) {
          write(
            `\n${s.dim(
              `⟳ Compacted ${event.summarizedMessages} older message(s), kept ` +
                `${event.keptMessages} recent.`,
            )}\n`,
          )
        } else {
          write(`\n${s.yellow(`⚠ Compaction failed (${truncateForLine(event.message)}) — continuing uncompacted.`)}\n`)
        }
        break
      case 'provider_retry':
        write(
          `\n${s.yellow(
            `⟳ Provider request failed (attempt ${event.attempt}), retrying: ` +
              `${truncateForLine(event.message)}`,
          )}\n`,
        )
        break
      case 'permission_denied':
        write(`  ${s.yellow(`⚠ permission denied: ${truncateForLine(event.reason)}`)}\n`)
        break
      case 'loop_end':
        if (event.stopReason === 'max_turns' || event.stopReason === 'budget_exceeded') {
          write(
            `\n${s.yellow(
              `⚠ Stopped by guardrail (${event.stopReason}) after ${event.turns} turn(s) — ` +
                'progress is reported as-is.',
            )}\n`,
          )
        } else if (event.stopReason === 'error') {
          write(`\n${s.red(`✗ Loop stopped on an error after ${event.turns} turn(s).`)}\n`)
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
 * not a TTY (headless runs should use --yolo or --plan). Edit/Write calls
 * render a red/green diff preview before the prompt (best-effort).
 */
export function createInteractiveConfirm({ stdin, stdout, cwd = process.cwd(), boundary } = {}) {
  if (!stdin || stdin.isTTY !== true) {
    return null
  }

  return async function confirm({ toolName, input }) {
    let oldContent = null
    let blocked = false
    if (toolName === 'Write') {
      const read = await readOldContentForPreview({ toolName, input, cwd, boundary })
      oldContent = read.oldContent
      blocked = read.blocked
    }
    const preview = buildDiffPreviewForTool(toolName, input, { oldContent })
    if (preview && preview.parts) {
      if (blocked) {
        preview.note = preview.note
          ? `${preview.note} (file outside the workspace boundary — existing content not shown)`
          : '(file outside the workspace boundary — existing content not shown)'
      }
      const line = text => stdout.write(`${text}\n`)
      line(`  ${toolName} → ${preview.file} (${preview.kind} · +${preview.stats.added} −${preview.stats.removed})`)
      if (preview.note) line(`  ${preview.note}`)
      for (const part of preview.parts) {
        if (part.type === 'fold') line(`  ${part.text}`)
        else if (part.type === 'add') line(`  + ${part.text}`)
        else if (part.type === 'del') line(`  - ${part.text}`)
        else line(`    ${part.text}`)
      }
    }
    const rl = createInterface({ input: stdin, output: stdout ?? undefined, terminal: true })
    try {
      const text = formatToolInputPreview(input)
      const answer = await rl.question(`Allow ${toolName}(${text})? [y/N] `)
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
  /** Effective CLI environment merged by runCli; env probes must read this
   * rather than the host process's environment. */
  env = process.env,
  maxTurns,
  budgetTokens,
  onEvent,
  transcript = { enabled: true },
  signal,
  reasoning = undefined,
  compact = undefined,
  boundary = undefined,
  resume = null,
}) {
  const resolvedModel = model || provider?.listModels?.()?.[0]?.id || null

  // Fresh environment facts per run: git state / OS / date go into the system
  // prompt. A failed probe never blocks the run (collector never rejects).
  const [envInfo, memory] = await Promise.all([
    collectEnvironmentInfo(cwd, { env }),
    collectProjectMemory(cwd).then(result => result.text),
  ])

  // Resume: the loop prepends the prior session's messages itself; a fresh
  // session starts from the prompt alone.
  const messages = [{ role: 'user', content: prompt }]
  const history = resume?.messages ?? []

  const result = await runAgentLoop({
    provider,
    model: resolvedModel,
    system: buildAgentSystemPrompt(cwd, boundary, {
      envInfo,
      permissionMode,
      model: resolvedModel,
      memory,
    }),
    tools: createCoreTools(),
    messages,
    permissionMode,
    confirm,
    maxTurns,
    budgetTokens,
    cwd,
    onEvent,
    transcript,
    signal,
    compact,
    boundary,
    ...(resume
      ? {
          resume: {
            sessionId: resume.sessionId,
            messages: history,
            // Relative paths in the restored history belong to the directory
            // the prior session ran in, not the current one.
            originalCwd: resume.cwd ?? null,
          },
        }
      : {}),
  })

  return {
    sessionId: result.sessionId,
    ...(resume ? { resumedFrom: resume.sessionId } : {}),
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
    compactions: result.compactions,
    usage: result.usage,
    // P1.2 observability: pass the loop's run metrics through to the JSON
    // envelope (the envelope spreads this object).
    ...(result.metrics ? { metrics: result.metrics } : {}),
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(result.error ? { error: result.error } : {}),
  }
}
