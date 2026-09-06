/**
 * Interactive TUI — a zero-dependency readline REPL over the agent loop.
 *
 * The public layer's design rule is no dependencies and no build step, so
 * this is plain node:readline + ANSI terminal writes (VT sequences are safe
 * on Windows 10+ TTYs; color honors NO_COLOR/FORCE_COLOR and degrades to
 * plain text on pipes): streamed model output, colored one-line tool call
 * rendering, an erasable status line, inline y/n approvals for Agent mode,
 * Esc-to-interrupt, Shift+Tab permission-mode cycling, and slash commands
 * (/help /clear /compact /sessions /cost /model /mode /reasoning /save
 * /exit). Bare `zcode` lands here; `-p` stays headless.
 *
 * Streams are injectable (stdin/stdout/stderr params) so the whole REPL is
 * covered by scripted integration tests without a real TTY; keypress
 * handlers can be exercised by emitting 'keypress' on the injected stream.
 */

import { createInterface } from 'node:readline'
import path from 'node:path'
import { appendFile, readFile } from 'node:fs/promises'
import {
  runAgentLoop,
  createCoreTools,
  compactConversation,
  resolveDialect,
  listSessions,
  resolveSessionPath,
  loadSessionForResume,
  defaultTranscriptDir,
  emptyUsage,
  addUsage,
  executeBash,
} from '../harness/index.ts'
import {
  buildAgentSystemPrompt,
  createProgressRenderer,
  formatToolInputPreview,
} from './harnessPrint.js'
import { collectEnvironmentInfo } from './envInfo.js'
import { collectProjectMemory } from './projectMemory.js'
import { createCompleter } from './completer.js'
import { renderBanner, renderStatusLine, guessContextLimit } from './tuiChrome.js'
import { ERASE_LINE } from './ansi.js'
import { createCliRuntime } from './runtimeContext.js'
import { extractCodeBlocks, writeCodeBlocks } from './codeBlocks.js'
import { buildDiffPreviewForTool, readOldContentForPreview } from './diffPreview.js'
import { createMarkdownStream } from './markdownStream.js'

const BANNER_LINE = '─'.repeat(64)
// Cycle order is a safety gradient: from agent, one Shift+Tab lands on
// read-only plan, and reaching yolo takes a second press past it.
const MODE_CYCLE = ['plan', 'yolo', 'agent']

// Spinner frames: Braille looks best in Windows Terminal (WT_SESSION is its
// own env var); legacy conhost fonts often lack Braille glyphs, so it falls
// back to plain ASCII.
const SPINNER_FRAMES_UTF = Object.freeze(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'])
const SPINNER_FRAMES_ASCII = Object.freeze(['|', '/', '-', '\\'])
const SPINNER_INTERVAL_MS = 120
// Soft verb rotation (Claude-Code-style): the work word changes every few
// seconds so a long turn feels alive without extra noise.
const SPINNER_VERBS = Object.freeze([
  'thinking',
  'exploring',
  'forging',
  'polishing',
  'weaving',
  'crafting',
  'distilling',
  'considering',
])

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Runs the interactive session until the user exits (/exit, /quit, Ctrl+C at
 * the prompt, or stdin EOF). Resolves with an exit code.
 */
export async function runTui({
  stdin,
  stdout,
  stderr,
  provider,
  cwd,
  /** Effective CLI environment (settings/.env merged by runCli); falls back
   * to process.env for direct callers. Probes and color detection must read
   * this, not the host process's environment. */
  env = process.env,
  permissionMode = 'agent',
  model = null,
  boundary,
  maxTurns,
  budgetTokens,
  compact,
  transcript = { enabled: true },
  version = '',
  initialMessages = [],
  resumedFrom = null,
  transcriptDir = null,
  productName = 'ZCode',
  /** (usage, model) => { cost, pricing } | null; injected to avoid a cycle. */
  estimateCost = null,
  /** MCP stdio tools (P1.3) from discoverMcpTools; merged after the core set
   * so they ride the same registry, permission, and transcript path. */
  mcpTools = [],
} = {}) {
  const write = chunk => stdout.write(chunk)
  const writeLine = line => write(`${line}\n`)
  // One runtime object owns the effective env and every terminal-capability
  // decision (color, Unicode glyphs, spinner frames) — nothing below falls
  // back to process.env on its own.
  const runtime = createCliRuntime({ cwd, env, stdout, stderr })
  const styler = runtime.styler

  const sessionsDir = transcriptDir || defaultTranscriptDir(cwd)

  // ── Session state ──
  let history = [...initialMessages]
  const totalUsage = emptyUsage()
  let abortedThisRun = false
  let currentPermissionMode = permissionMode
  let resolvedModel = model || provider?.listModels?.()?.[0]?.id || null
  let showReasoning = false
  let lastAssistantText = ''
  let lastMemory = { files: [], text: '' }
  /** Full results of the last completed turn's tool calls (Ctrl+O expands). */
  let lastToolCalls = null
  /** Sessions listed by the last bare `/resume`, so `/resume <n>` resolves. */
  let resumeMenu = []
  /** Prompts submitted this session (deduped consecutively) for /history. */
  const promptHistory = []

  const controller = { current: null }

  // ── Line plumbing ──
  // Lines typed while a turn is running are queued for the next prompt (the
  // queue is flushed before an approval question so typed-ahead text can
  // never be mistaken for a y/n answer).
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: stdout?.isTTY === true,
    completer: createCompleter({ cwd }),
    historySize: 200,
  })
  const queuedLines = []
  let lineWaiter = null
  rl.on('line', line => {
    if (lineWaiter) {
      const waiter = lineWaiter
      lineWaiter = null
      waiter.resolve(line)
    } else {
      queuedLines.push(line)
    }
  })

  const takeLine = () => {
    if (queuedLines.length > 0) return Promise.resolve(queuedLines.shift())
    return new Promise(resolve => {
      lineWaiter = { resolve }
    })
  }

  // Renders the red/green diff preview shown before an Edit/Write approval.
  // Best-effort: any failure falls back to the plain input preview line. The
  // Write target's old content is only read inside the workspace boundary —
  // out-of-bounds paths get a placeholder note, never their contents.
  const renderApprovalDiff = async ({ toolName, input }) => {
    if (toolName !== 'Edit' && toolName !== 'Write') return
    let oldContent = null
    let blocked = false
    if (toolName === 'Write') {
      const read = await readOldContentForPreview({ toolName, input, cwd, boundary })
      oldContent = read.oldContent
      blocked = read.blocked
    }
    const preview = buildDiffPreviewForTool(toolName, input, { oldContent })
    if (!preview || !preview.parts) {
      if (blocked) writeLine(`  ${styler.dim('(file outside the workspace boundary — existing content not shown)')}`)
      return
    }
    if (blocked) preview.note = preview.note ? `${preview.note} (file outside the workspace boundary — existing content not shown)` : '(file outside the workspace boundary — existing content not shown)'

    writeLine(
      `  ${styler.bold(`${toolName} → ${preview.file}`)} ${styler.dim(`(${preview.kind} · +${preview.stats.added} −${preview.stats.removed})`)}`,
    )
    if (preview.note) writeLine(`  ${styler.dim(preview.note)}`)
    for (const part of preview.parts) {
      if (part.type === 'fold') {
        writeLine(`  ${styler.dim(part.text)}`)
      } else if (part.type === 'add') {
        writeLine(`  ${styler.green(`+ ${part.text}`)}`)
      } else if (part.type === 'del') {
        writeLine(`  ${styler.red(`- ${part.text}`)}`)
      } else {
        writeLine(`  ${styler.dim(`  ${part.text}`)}`)
      }
    }
  }

  const askApproval = async ({ toolName, input }) => {
    // A queued line must never be consumed as an approval decision.
    queuedLines.length = 0
    writeLine('')
    await renderApprovalDiff({ toolName, input }).catch(() => {})
    const answer = await Promise.race([
      takeLine().then(line => line.trim().toLowerCase() === 'y'),
      new Promise(resolve => {
        const active = controller.current
        if (active?.signal.aborted) {
          resolve(false)
          return
        }
        active?.signal.addEventListener('abort', () => resolve(false), { once: true })
      }),
    ])
    if (!answer) writeLine(`  ${styler.dim('(declined)')}`)
    return answer
  }

  // Confirm is passed unconditionally; the permission gate only invokes it in
  // agent mode, so switching modes mid-session needs no rewiring here.
  const confirm = request => askApproval(request)

  // ── Terminal chrome ──
  // Window title reflects the running task so users can spot a long turn from
  // another window; a completion bell only fires for long turns (≥10s) — the
  // "notify me when it's done" case — so short turns never get noisy.
  const setTitle = title => {
    if (stdout?.isTTY === true) write(`\u001b]2;${title}\u0007`)
  }
  const ringCompletionBell = elapsedMs => {
    if (stdout?.isTTY === true && elapsedMs >= 10_000) write('\u0007')
  }

  // ── Ctrl+O: expand the last tool call's full output ──
  // The live renderer truncates tool lines to 160 chars; the loop's executed
  // calls keep the complete result, so a review pass can reveal it.
  const TOOL_OUTPUT_DISPLAY_CAP = 8000
  const expandLastTool = () => {
    const call = Array.isArray(lastToolCalls) ? lastToolCalls[lastToolCalls.length - 1] : null
    if (!call) {
      writeLine('No tool output to expand yet — run a turn that uses tools first.')
      return
    }
    writeLine(
      `\n${styler.bold(`▸ ${call.name}`)} ${styler.dim(`(${formatToolInputPreview(call.input)})`)}`,
    )
    const text = typeof call.result === 'string' ? call.result : String(call.result ?? '')
    const body =
      text.length > TOOL_OUTPUT_DISPLAY_CAP
        ? `${text.slice(0, TOOL_OUTPUT_DISPLAY_CAP)}\n… (+${text.length - TOOL_OUTPUT_DISPLAY_CAP} chars not shown)`
        : text
    for (const line of body.split('\n')) writeLine(`  ${line}`)
    if (call.isError) writeLine(`  ${styler.red('(this tool call reported an error)')}`)
  }

  // ── Esc Esc: rewind the last user message back into the editor ──
  // In-memory only: the transcript keeps the full exchange, and resuming that
  // session file restores what was rewound here. Claude-Code-style affordance
  // for "I want to rephrase that" without losing the rest of the workspace.
  const rewindLastMessage = () => {
    if (controller.current) return
    let index = -1
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.role === 'user') {
        index = i
        break
      }
    }
    if (index === -1) {
      writeLine('Nothing to rewind — no user message in this conversation yet.')
      return
    }
    const content = typeof history[index].content === 'string' ? history[index].content : ''
    history = history.slice(0, index)
    writeLine(
      `↩ rewound — the last message is back in the editor` +
        ` (${history.length} message${history.length === 1 ? '' : 's'} kept).`,
    )
    if (content && stdout?.isTTY === true && typeof rl.write === 'function') {
      rl.write(content)
    } else if (content) {
      writeLine(`  ${styler.dim(`(restored prompt: ${content.slice(0, 80)}${content.length > 80 ? '…' : ''})`)}`)
    }
  }

  // ── Keyboard: Esc interrupts the running turn, Shift+Tab cycles modes,
  // Ctrl+O expands the last tool result, Esc Esc rewinds the last message ──
  // In production readline already attaches keypress emission to the input
  // stream; scripted tests emit 'keypress' on the injected stream directly.
  let lastEscapeAt = 0
  if (stdin && typeof stdin.on === 'function') {
    stdin.on('keypress', (_str, key) => {
      if (!key) return
      const isEscape = key.name === 'escape'
      const isBacktab =
        key.name === 'backtab' || (key.name === 'tab' && key.shift === true)
      if (isEscape && controller.current) {
        abortedThisRun = true
        controller.current.abort()
        write('\n')
        return
      }
      if (isBacktab && !controller.current) {
        const index = MODE_CYCLE.indexOf(currentPermissionMode)
        currentPermissionMode = MODE_CYCLE[(index + 1) % MODE_CYCLE.length]
        const note =
          `mode: ${styler.bold(currentPermissionMode)}` +
          (currentPermissionMode === 'yolo'
            ? styler.yellow(' — actions run without approval')
            : currentPermissionMode === 'plan'
              ? ' — read-only planning'
              : ' — writes require approval')
        writeLine(note)
        return
      }
      if (key.ctrl && key.name === 'o' && !controller.current) {
        expandLastTool()
        return
      }
      // Double-Escape when idle rewinds the last user message back into the
      // editor (Claude-Code-style). A single Esc stays inert while idle.
      if (isEscape && !controller.current) {
        const now = Date.now()
        if (now - lastEscapeAt <= 800) {
          lastEscapeAt = 0
          rewindLastMessage()
        } else {
          lastEscapeAt = now
        }
      }
    })
  }

  // ── `!` shell mode ──
  // Runs the command directly through the harness's Bash executor (same
  // output decoding, timeout, and process-tree kill as the model's Bash tool)
  // and feeds command+output into the conversation as the next user turn —
  // the user typed it, so it runs without an approval round-trip.
  const runShellCommand = async command => {
    writeLine(`  ${styler.dim(`$ ${command}`)}`)
    let result
    try {
      result = await executeBash(
        { command },
        { cwd, state: { readFiles: new Set() }, boundary },
      )
    } catch (error) {
      writeLine(`  ${styler.red(`✗ ${error instanceof Error ? error.message : String(error)}`)}`)
      return
    }
    const text = typeof result?.content === 'string' ? result.content : String(result?.content ?? '')
    for (const line of text.split('\n')) writeLine(`  ${line}`)
    if (result?.isError === true) {
      writeLine(`  ${styler.red('(command failed — output still joins the context)')}`)
    }
    // Claude-Code semantics: the output joins the context and the model
    // responds to it immediately.
    await runTurn(`!shell ${command}\n\n${text}`)
  }

  // ── `#` memory mode ──
  // Appends a durable note to the project memory file (AGENTS.md preferred,
  // ZCODE.md fallback, created when neither exists) and refreshes the injected
  // memory so the very next turn already sees it.
  const appendMemoryNote = async text => {
    const agentsPath = path.join(cwd, 'AGENTS.md')
    const zcodePath = path.join(cwd, 'ZCODE.md')
    let target = agentsPath
    let creating = true
    try {
      await readFile(agentsPath, 'utf-8')
      creating = false
    } catch {
      try {
        await readFile(zcodePath, 'utf-8')
        target = zcodePath
        creating = false
      } catch {
        // Neither exists: create AGENTS.md with a header.
      }
    }
    try {
      let existing = ''
      if (!creating) existing = await readFile(target, 'utf-8')
      const prefix = creating
        ? '# Project memory\n\n'
        : existing.endsWith('\n') || existing === ''
          ? ''
          : '\n'
      await appendFile(target, `${prefix}- ${text}\n`, 'utf-8')
      lastMemory = await collectProjectMemory(cwd)
      writeLine(
        `✓ noted in ${path.basename(target)} — injected into the system prompt from the next turn.`,
      )
    } catch (error) {
      writeLine(`✗ could not write project memory: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Streaming markdown: when colors are on, text deltas flow through the
  // line-buffered parser and render styled (bold / inline code / fences).
  // Without color the deltas pass straight through.
  const mdStream = runtime.colorEnabled
    ? createMarkdownStream({
        onLine: lineEvent => {
          if (lineEvent.kind === 'fence-open') {
            const label = lineEvent.lang || 'code'
            writeLine(styler.dim(`┌─ ${label} ${'─'.repeat(Math.max(4, 40 - label.length))}`))
            return
          }
          if (lineEvent.kind === 'fence-close') {
            writeLine(styler.dim('└────────────────'))
            return
          }
          const rendered = lineEvent.segments
            .map(segment => {
              if (segment.style === 'bold') return styler.bold(segment.text)
              if (segment.style === 'code') return styler.cyan(segment.text)
              return segment.text
            })
            .join('')
          const prefix = lineEvent.fence ? `${styler.dim('│')} ` : ''
          writeLine(prefix + rendered)
        },
      })
    : null

  const runTurn = async prompt => {
    queuedLines.length = 0
    const active = new AbortController()
    controller.current = active
    abortedThisRun = false
    setTitle(`● ${String(prompt ?? '').slice(0, 60)} — ZCode`)

    // Status line: an animated spinner with elapsed seconds, shown on a TTY.
    // It starts BEFORE the env/memory probes so slow git repos still get
    // feedback, and its label switches once the turn actually starts. The
    // first visible event erases it (and stops the refresh interval) so it
    // never fights streamed output.
    const turnStartedAt = Date.now()
    let statusActive = false
    let statusTimer = null
    let spinnerFrame = 0
    let statusLabel = 'reading workspace state'
    let renderStatus = () => {}
    const spinnerFrames = runtime.spinnerFramesUnicode ? SPINNER_FRAMES_UTF : SPINNER_FRAMES_ASCII
    if (stdout?.isTTY === true) {
      renderStatus = () => {
        const elapsedSeconds = Math.floor((Date.now() - turnStartedAt) / 1000)
        const frame = spinnerFrames[spinnerFrame % spinnerFrames.length]
        spinnerFrame += 1
        // Phase 1 (env/memory probes) keeps the plain label; once the turn is
        // actually working, a soft verb rotates every ~3 seconds.
        const verb = SPINNER_VERBS[Math.floor(elapsedSeconds / 3) % SPINNER_VERBS.length]
        const label = statusLabel === 'working' ? `${verb}…` : statusLabel
        write(
          ERASE_LINE +
            styler.dim(
              `${frame} ${label} · ${elapsedSeconds}s · ${currentPermissionMode} mode · esc to interrupt`,
            ),
        )
      }
      renderStatus()
      statusActive = true
      statusTimer = setInterval(renderStatus, SPINNER_INTERVAL_MS)
    }
    const clearStatus = () => {
      if (statusActive) {
        if (statusTimer !== null) {
          clearInterval(statusTimer)
          statusTimer = null
        }
        write(ERASE_LINE)
        statusActive = false
      }
    }

    // Refresh environment facts each turn so the model always sees current
    // git/OS state; the collector never rejects. Project memory (AGENTS.md /
    // ZCODE.md) is collected alongside and kept for the /memory command.
    const [envInfo, memory] = await Promise.all([
      collectEnvironmentInfo(cwd, { env }),
      collectProjectMemory(cwd),
    ])
    lastMemory = memory
    statusLabel = 'working'
    // Re-render immediately so a fast first event doesn't leave the stale
    // "reading workspace state" label on screen for a whole interval tick.
    if (statusActive) renderStatus()
    const renderer = createProgressRenderer({
      stdout,
      stderr,
      showReasoning,
      styler,
    })

    // TodoWrite events carry the full new list in `input.todos` (raw input);
  // render it as a colored checklist instead of the truncated JSON preview.
  const renderTodoChecklist = todos => {
    writeLine(
      `\n${styler.cyan('●')} ${styler.bold('TodoWrite')} ${styler.dim(`(${todos.length} step${todos.length === 1 ? '' : 's'})`)}`,
    )
    for (const todo of todos) {
      const content = typeof todo?.content === 'string' ? todo.content : String(todo?.content ?? '')
      if (todo?.status === 'completed') {
        writeLine(`  ${styler.green('☒')} ${styler.dim(content)}`)
      } else if (todo?.status === 'in_progress') {
        writeLine(`  ${styler.cyan('◐')} ${styler.bold(content)}`)
      } else {
        writeLine(`  ${styler.dim('☐')} ${content}`)
      }
    }
  }

  const summarizeTodoPreview = preview => {
    // The end-event preview is the flattened result content; its leading
    // "Todo list updated: … (N total)." sentence is the summary line.
    const match = /^Todo list updated:[^.]*\([^)]*\)\./.exec(preview ?? '')
    return match ? match[0] : null
  }

  const onEvent = event => {
      if (event.type === 'permission_request') {
        clearStatus()
        write(
          `  ? ${styler.bold(`Allow ${event.name}`)} ${styler.dim(`(${formatToolInputPreview(event.input)})`)} ` +
            `${styler.bold('[y/N]')} `,
        )
        return
      }
      if (event.type === 'tool_execution_start' && event.name === 'TodoWrite') {
        clearStatus()
        const todos = event.input && Array.isArray(event.input.todos) ? event.input.todos : null
        if (todos && todos.length > 0) {
          renderTodoChecklist(todos)
          return
        }
      }
      if (event.type === 'tool_execution_end' && event.name === 'TodoWrite' && !event.isError) {
        clearStatus()
        const summary = summarizeTodoPreview(event.preview)
        writeLine(`  ${summary ? styler.green(`✓ ${summary}`) : styler.green('✓ todo list updated')}`)
        return
      }
      if (event.type !== 'session_start' && event.type !== 'turn_start') {
        clearStatus()
      }
      if (event.type === 'text_delta' && mdStream) {
        mdStream.delta(event.text)
        return
      }
      if (event.type === 'assistant_message' && mdStream) {
        // End of one assistant message: emit any buffered partial line.
        mdStream.flush()
        if (event.text) write('\n')
        return
      }
      renderer(event)
    }

    let result
    try {
      result = await runAgentLoop({
        provider,
        model: resolvedModel,
        system: buildAgentSystemPrompt(cwd, boundary, {
          envInfo,
          permissionMode: currentPermissionMode,
          model: resolvedModel,
          memory: memory.text,
        }),
        tools: createCoreTools().concat(mcpTools),
        messages: [...history, { role: 'user', content: prompt }],
        permissionMode: currentPermissionMode,
        confirm,
        maxTurns,
        budgetTokens,
        cwd,
        onEvent,
        transcript,
        signal: active.signal,
        compact,
        boundary,
      })
    } catch (error) {
      clearStatus()
      writeLine(`\n${styler.red(`✗ ${error instanceof Error ? error.message : String(error)}`)}`)
      return
    } finally {
      controller.current = null
      // Abort/error paths stop deltas mid-line: flush the parser's buffer.
      if (mdStream) mdStream.flush()
      setTitle(`ZCode — ${path.basename(cwd)}`)
      // Esc users are already at the keyboard; the bell is for the switched-
      // away long-turn case only.
      if (!abortedThisRun) ringCompletionBell(Date.now() - turnStartedAt)
    }
    clearStatus()

    history = result.messages
    addUsage(totalUsage, result.usage)
    if (result.text) lastAssistantText = result.text
    // Full tool results for the Ctrl+O review pass (the live line renderer
    // truncates to 160 chars; these keep everything).
    lastToolCalls = result.toolCalls
    // Context footprint for the status bar: the provider-reported input of
    // the last turn (the full history the model saw). When a provider omits
    // usage, fall back to a chars/4 estimate over the conversation — coarse,
    // but the bar is already labelled an estimate.
    const contextFootprintTokens =
      result.usage && Number.isFinite(result.usage.inputTokens)
        ? result.usage.inputTokens
        : Math.ceil(JSON.stringify(history ?? []).length / 4)
    // P1.2 observability: surface the loop's run metrics inline — TTFT of the
    // last turn and the run's tool-call totals, next to the wall time.
    const metrics = result.metrics
    const lastTurnMetrics = metrics?.turns?.[metrics.turns.length - 1] ?? null
    const toolCallCount = metrics?.tools?.reduce((sum, tool) => sum + tool.count, 0) ?? 0
    // Turn summary: chrome dims, numbers speak — dim labels, normal values,
    // thin separators. The status line and teaching hint follow.
    const summary = [
      `${styler.dim('turn')} ${result.turns}`,
      `${styler.dim('time')} ${formatDuration(Date.now() - turnStartedAt)}`,
      ...(lastTurnMetrics?.ttftMs != null
        ? [`${styler.dim('ttft')} ${formatDuration(lastTurnMetrics.ttftMs)}`]
        : []),
      ...(toolCallCount > 0
        ? [`${styler.dim('tools')} ${toolCallCount}`]
        : []),
      result.usage
        ? `${styler.dim('in')} ${formatTokens(result.usage.inputTokens)} ${styler.dim('· out')} ${formatTokens(result.usage.outputTokens)} ${styler.dim('· session')} ${formatTokens(totalUsage.inputTokens)}/${formatTokens(totalUsage.outputTokens)}`
        : `${styler.dim('(provider did not report usage)')}`,
    ].join(` ${styler.dim('·')} `)
    writeLine(`\n${styler.dim(BANNER_LINE)}\n  ${summary}`)
    if (result.stopReason !== 'end_turn' && result.error) {
      writeLine(`  ${styler.red(`✗ ${result.error}`)}`)
    }
    for (const warning of result.warnings ?? []) {
      writeLine(`  ${styler.yellow(`⚠ ${warning}`)}`)
    }
    if (abortedThisRun) {
      writeLine(`  ${styler.dim('⏹ stopped — partial progress is kept in the conversation.')}`)
    }
    if (queuedLines.length > 0) {
      writeLine(`  ${styler.dim(`${queuedLines.length} line(s) typed during the run — sending next.`)}`)
    }
    // Claude-Code-style status line: model | dir git:(branch*) | Context bar.
    // The limit is a model-family guess, so the bar is explicitly labelled
    // an estimate.
    const statusLine = renderStatusLine({
      model: resolvedModel,
      cwd,
      git: envInfo?.git ?? null,
      usedTokens: contextFootprintTokens,
      contextLimit: guessContextLimit(resolvedModel),
      estimated: true,
      unicode: runtime.unicode,
    })
    writeLine(`  ${styler.dim(statusLine)}`)
    // Teach the review affordance once tools have actually run.
    if (toolCallCount > 0) {
      writeLine(`  ${styler.dim('↳ ctrl+o expands the last tool result')}`)
    }
    if (result.stopReason !== 'end_turn' && result.error) {
      writeLine(`  ${styler.red(`✗ ${result.error}`)}`)
    }
    for (const warning of result.warnings ?? []) {
      writeLine(`  ${styler.yellow(`⚠ ${warning}`)}`)
    }
    if (abortedThisRun) {
      writeLine(`  ${styler.dim('⏹ stopped — partial progress is kept in the conversation.')}`)
    }
    if (queuedLines.length > 0) {
      writeLine(`  ${styler.dim(`${queuedLines.length} line(s) typed during the run — sending next.`)}`)
    }
  }

  const setPermissionMode = next => {
    if (!MODE_CYCLE.includes(next)) {
      writeLine(`Unknown mode: ${next} — use plan, agent, or yolo.`)
      return
    }
    currentPermissionMode = next
    writeLine(
      `mode: ${styler.bold(next)}` +
        (next === 'yolo'
          ? styler.yellow(' — actions run without approval')
          : next === 'plan'
            ? ' — read-only planning'
            : ' — writes require approval'),
    )
  }

  const handleSlash = async raw => {
    const command = raw.trim().split(/\s+/)[0]
    const rest = raw.trim().slice(command.length).trim()
    switch (command.toLowerCase()) {
      case '/help':
        writeLine(
          [
            'Slash commands:',
            '  /help      Show this help',
            '  /clear     Start a fresh conversation (history is dropped)',
            '  /compact   Summarize older history now, keep recent messages verbatim',
            '  /sessions  List recent sessions for this workspace',
            '  /resume [n|id]  Load a recorded session into this conversation and keep chatting',
            '  /history [n]  List this session\'s prompts; re-run one by number',
            '  /cost      Token totals and estimated cost for this interactive session',
            '  /model [id]  List models, or switch to <id> for the rest of the session',
            `  /mode [m]  Show or set the permission mode (${MODE_CYCLE.join(' / ')})`,
            '  /reasoning Toggle display of reasoning streams (when the model provides them)',
            '  /save [path]  Save code blocks from the last reply (inferred names, or one file)',
            '  /memory    Show the AGENTS.md/ZCODE.md project memory injected into the prompt',
            '  /exit      Leave the session (also: /quit, Ctrl+C, Ctrl+D)',
            'Keys: Esc interrupts a running turn · Shift+Tab cycles plan/agent/yolo · a trailing',
            '      backslash continues your input on the next line.',
            '      Ctrl+O expands the last tool call’s full output.',
            '      Esc Esc rewinds: your last message goes back into the editor for a rephrase.',
            '! <command>  Runs a shell command right now (your keystroke, so no approval gate);',
            '             the output joins the conversation and the model responds to it.',
            '# <note>  Saves a durable note to project memory (AGENTS.md); the very next turn',
            '             already sees it. /memory shows what is loaded.',
          ].join('\n'),
        )
        return true
      case '/exit':
      case '/quit':
        return false
      case '/clear':
        history = []
        lastAssistantText = ''
        writeLine('Conversation cleared.')
        return true
      case '/compact': {
        if (history.length === 0) {
          writeLine('Nothing to compact yet.')
          return true
        }
        write('⟳ Compacting…')
        try {
          const compaction = await compactConversation({
            messages: history,
            provider,
            dialect: resolveDialect(provider),
            model: resolvedModel,
            keepRecentMessages: compact?.keepRecentMessages,
          })
          if (compaction) {
            history = compaction.messages
            addUsage(totalUsage, compaction.usage)
            writeLine(
              ` done — summarized ${compaction.summarizedMessages} older message(s), kept ${compaction.keptMessages}.`,
            )
          } else {
            writeLine(' nothing safely summarizable; history unchanged.')
          }
        } catch (error) {
          writeLine(` failed (${error instanceof Error ? error.message : String(error)}).`)
        }
        return true
      }
      case '/sessions': {
        const sessions = await listSessions(sessionsDir)
        if (sessions.length === 0) {
          writeLine(`No sessions recorded in ${sessionsDir}.`)
          return true
        }
        writeLine(`Recent sessions in ${sessionsDir} (newest first):`)
        for (const session of sessions.slice(0, 5)) {
          const modified = new Date(session.mtimeMs).toISOString().replace('T', ' ').slice(0, 16)
          writeLine(`  ${session.sessionId}  ${modified}  ${session.sizeBytes} B`)
        }
        writeLine('Resume later with: zcode -p "<prompt>" --continue (or --resume <id>).')
        return true
      }
      case '/resume': {
        // In-session resume: replace the live conversation with a recorded
        // session's history and keep chatting on top of it.
        const arg = rest.trim()
        if (arg === '') {
          const sessions = await listSessions(sessionsDir)
          if (sessions.length === 0) {
            writeLine(`No sessions recorded in ${sessionsDir} yet.`)
            return true
          }
          resumeMenu = sessions.slice(0, 5)
          writeLine('Recent sessions (newest first) — pick one with /resume <n> or /resume <id>:')
          resumeMenu.forEach((session, index) => {
            const modified = new Date(session.mtimeMs).toISOString().replace('T', ' ').slice(0, 16)
            writeLine(`  ${index + 1}  ${session.sessionId}  ${modified}  ${session.sizeBytes} B`)
          })
          return true
        }
        const listed = /^\d+$/.test(arg) ? resumeMenu[Number(arg) - 1] : null
        let targetPath = listed?.path ?? null
        if (!targetPath) {
          try {
            targetPath = await resolveSessionPath(sessionsDir, arg)
          } catch {
            targetPath = null
          }
        }
        if (!targetPath) {
          writeLine(`No session matches "${arg}" — run /resume to list recent ones.`)
          return true
        }
        try {
          const snapshot = await loadSessionForResume(targetPath)
          history = snapshot.messages
          const lastAssistant = [...history].reverse().find(m => m.role === 'assistant' && m.text)
          lastAssistantText = lastAssistant?.text ?? ''
          lastToolCalls = null
          resumeMenu = []
          writeLine(
            `↩ resumed ${snapshot.sessionId} — ${history.length} message(s) in context` +
              `${snapshot.skippedLines > 0 ? ` (${snapshot.skippedLines} unparseable line(s) skipped)` : ''}.` +
              ' The next reply builds on this history.',
          )
        } catch (error) {
          writeLine(`✗ resume failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        return true
      }
      case '/history': {
        // Prompt log for this session: recall and re-run a previous task
        // without scrolling back through the transcript.
        if (promptHistory.length === 0) {
          writeLine('No prompts submitted yet in this session.')
          return true
        }
        const pick = rest.trim()
        if (/^\d+$/.test(pick)) {
          const n = Number(pick)
          const prompt = promptHistory[promptHistory.length - n]
          if (prompt === undefined) {
            writeLine(`No such entry: ${n} — /history lists 1..${promptHistory.length} (1 = most recent).`)
            return true
          }
          writeLine(`↻ re-running prompt ${n} ${styler.dim(`(${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''})`)}`)
          if (promptHistory[promptHistory.length - 1] !== prompt) promptHistory.push(prompt)
          await runTurn(prompt)
          return true
        }
        writeLine('Prompts this session (newest first) — re-run one with /history <n>:')
        promptHistory
          .slice(-10)
          .reverse()
          .forEach((prompt, index) => {
            writeLine(`  ${index + 1}  ${prompt.length > 90 ? `${prompt.slice(0, 90)}…` : prompt}`)
          })
        return true
      }
      case '/cost': {
        const cost = estimateCost ? estimateCost(totalUsage, resolvedModel) : null
        writeLine(
          `Session usage: in ${totalUsage.inputTokens} / out ${totalUsage.outputTokens} / total ${totalUsage.totalTokens} tok`,
        )
        if (cost) {
          writeLine(
            `  estimated cost: $${cost.cost.toFixed(6)} ` +
              `(pricing: in $${cost.pricing.input}/Mtok, out $${cost.pricing.output}/Mtok)`,
          )
        } else {
          writeLine('  (no pricing table entry for this model — token totals only)')
        }
        return true
      }
      case '/model': {
        if (rest === '') {
          const models = provider?.listModels?.() ?? []
          if (models.length === 0) {
            writeLine('Provider exposes no model list; use -m/--model at startup instead.')
            return true
          }
          writeLine(`Models for ${provider?.id ?? 'provider'} (current: ${resolvedModel ?? '(default)'}):`)
          for (const entry of models) {
            const marker = entry.id === resolvedModel ? styler.green(' ←') : ''
            writeLine(`  ${entry.id}${marker}`)
          }
          writeLine('Switch with: /model <id>')
          return true
        }
        const models = provider?.listModels?.() ?? []
        const found = models.find(entry => entry.id === rest)
        if (!found) {
          writeLine(`Unknown model: ${rest} — run /model to list available ids.`)
          return true
        }
        resolvedModel = found.id
        writeLine(`model: ${styler.bold(resolvedModel)} (applies from the next message)`)
        return true
      }
      case '/mode': {
        if (rest === '') {
          writeLine(`mode: ${styler.bold(currentPermissionMode)} — Shift+Tab cycles plan/agent/yolo, or /mode <m>`)
          return true
        }
        setPermissionMode(rest.toLowerCase())
        return true
      }
      case '/reasoning': {
        showReasoning = !showReasoning
        writeLine(`reasoning display: ${showReasoning ? 'on' : 'off'} (applies to the next turn)`)
        return true
      }
      case '/save': {
        const blocks = extractCodeBlocks(lastAssistantText)
        if (blocks.length === 0) {
          writeLine('No code blocks in the last reply yet.')
          return true
        }
        try {
          const written = writeCodeBlocks(blocks, rest === '' ? null : rest, cwd)
          for (const file of written) writeLine(`  saved: ${file}`)
        } catch (error) {
          writeLine(`✗ ${error instanceof Error ? error.message : String(error)}`)
        }
        return true
      }
      case '/memory': {
        const files = lastMemory.files ?? []
        if (files.length === 0) {
          writeLine(
            'No project memory loaded. Add an AGENTS.md (or ZCODE.md) in the workspace ' +
              '(or ~/.zcode/ZCODE.md globally); it is injected into the system prompt.',
          )
          return true
        }
        writeLine(`Project memory (${files.length} file(s)) injected into the system prompt:`)
        for (const file of files) {
          writeLine(`  ${file.path} ${styler.dim(`[${file.scope}${file.truncated ? ' · truncated' : ''}]`)}`)
          const preview = file.source.split('\n').slice(0, 5).join('\n')
          for (const line of preview.split('\n')) {
            writeLine(`    ${styler.dim(`| ${line}`)}`)
          }
          if (file.source.split('\n').length > 5) writeLine(`    ${styler.dim('| …')}`)
        }
        return true
      }
      default:
        writeLine(`Unknown command: ${command} — try /help`)
        return true
    }
  }

  // ── Banner ──
  const boundaryLine =
    boundary === false
      ? 'disabled (--no-boundary): file tools can access the whole machine'
      : (() => {
          const roots = [path.resolve(cwd)]
          for (const dir of boundary?.addDirs ?? []) {
            if (typeof dir === 'string' && dir.trim() !== '') {
              roots.push(path.resolve(cwd, dir.trim()))
            }
          }
          return roots.join(', ')
        })()
  const bannerRows = renderBanner({
    productName,
    version,
    model: resolvedModel,
    mode: currentPermissionMode,
    cwd,
    unicode: runtime.unicode,
  })
  const logoWidth = Math.max(...bannerRows.map(row => row.logo.length)) + 2
  for (const row of bannerRows) {
    const logo = styler.cyan(row.logo.padEnd(logoWidth, ' '))
    // Aligned dim label column; the product line (empty label) is the only
    // bold row — chrome dims, the name speaks.
    const label = row.label === '' ? '' : `${styler.dim(row.label.padEnd(6))} `
    const value =
      row.label === ''
        ? `${styler.bold(row.value)}`
        : row.value
    writeLine(`${logo}${label}${value}`.trimEnd())
  }
  writeLine(styler.dim(`boundary (file tools): ${boundaryLine}`))
  if (resumedFrom) writeLine(`↩ resumed session ${resumedFrom} (${history.length} message(s))`)
  writeLine(
    styler.dim(
      'Type a task, or /help for commands. Esc interrupts · Shift+Tab switches mode · Ctrl+D exits.',
    ),
  )
  writeLine(styler.dim(BANNER_LINE))

  rl.on('SIGINT', () => {
    // Ctrl+C: abort the running turn, or leave if idle.
    if (controller.current) {
      abortedThisRun = true
      controller.current.abort()
      write('\n')
      return
    }
    rl.close()
  })
  rl.on('close', () => {
    if (lineWaiter) {
      const waiter = lineWaiter
      lineWaiter = null
      waiter.resolve('/exit')
    }
  })

  try {
    const promptGlyph = runtime.unicode ? styler.cyan('❯') : styler.cyan('>')
    for (;;) {
      write(`\n${promptGlyph} `)
      let line = await takeLine()
      // A trailing backslash continues input on the next line (multi-line
      // prompts without leaving the line-based REPL).
      let continuation = false
      while (typeof line === 'string' && line.trimEnd().endsWith('\\')) {
        line = line.trimEnd().slice(0, -1) + '\n'
        line += await takeLine()
        continuation = true
      }
      line = line.trim()
      if (line === '') continue
      if (!continuation && line.startsWith('!')) {
        const command = line.slice(1).trim()
        if (command === '') {
          writeLine('! runs a shell command directly and feeds its output to the model: !npm test')
          continue
        }
        await runShellCommand(command)
        continue
      }
      if (!continuation && line.startsWith('#')) {
        const note = line.slice(1).trim()
        if (note === '') {
          writeLine('# saves a durable note to project memory (AGENTS.md): # always run tests before committing')
          continue
        }
        await appendMemoryNote(note)
        continue
      }
      if (!continuation && line.startsWith('/')) {
        const keepGoing = await handleSlash(line)
        if (!keepGoing) break
        continue
      }
      if (promptHistory[promptHistory.length - 1] !== line) promptHistory.push(line)
      await runTurn(line)
    }
  } finally {
    rl.close()
  }

  writeLine(`bye — session usage in ${totalUsage.inputTokens} / out ${totalUsage.outputTokens} tok.`)
  return 0
}
