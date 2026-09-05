/**
 * Interactive TUI — a zero-dependency readline REPL over the agent loop.
 *
 * The public layer's design rule is no dependencies and no build step, so
 * this is plain node:readline + ANSI-free terminal writes: streamed model
 * output, one-line tool call rendering, inline y/n approvals for Agent mode,
 * and a small set of slash commands (/help /clear /compact /sessions /cost
 * /exit). Bare `zcode` lands here; `-p` stays headless.
 *
 * Streams are injectable (stdin/stdout/stderr params) so the whole REPL is
 * covered by scripted integration tests without a real TTY.
 */

import { createInterface } from 'node:readline'
import path from 'node:path'
import {
  runAgentLoop,
  createCoreTools,
  compactConversation,
  resolveDialect,
  listSessions,
  defaultTranscriptDir,
  emptyUsage,
  addUsage,
} from '../harness/index.ts'
import {
  buildAgentSystemPrompt,
  createProgressRenderer,
  formatToolInputPreview,
} from './harnessPrint.js'

const BANNER_LINE = '─'.repeat(64)

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
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
} = {}) {
  const write = chunk => stdout.write(chunk)
  const writeLine = line => write(`${line}\n`)

  const resolvedModel = model || provider?.listModels?.()?.[0]?.id || null
  const sessionsDir = transcriptDir || defaultTranscriptDir(cwd)

  // ── Line plumbing ──
  // Lines typed while a turn is running are queued for the next prompt (the
  // queue is flushed before an approval question so typed-ahead text can
  // never be mistaken for a y/n answer).
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: stdout?.isTTY === true,
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

  // ── Session state ──
  let history = [...initialMessages]
  const totalUsage = emptyUsage()
  let abortedThisRun = false

  const controller = { current: null }

  const askApproval = async ({ toolName: _toolName, input: _input }) => {
    // A queued line must never be consumed as an approval decision.
    queuedLines.length = 0
    writeLine('')
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
    if (!answer) writeLine('  (declined)')
    return answer
  }

  const confirm =
    permissionMode === 'agent'
      ? request => askApproval(request)
      : undefined

  const runTurn = async prompt => {
    queuedLines.length = 0
    const active = new AbortController()
    controller.current = active
    abortedThisRun = false

    const renderer = createProgressRenderer({ stdout, stderr, showReasoning: false })
    const onEvent = event => {
      if (event.type === 'permission_request') {
        write(`  ? Allow ${event.name}(${formatToolInputPreview(event.input)})? [y/N] `)
      }
      renderer(event)
    }

    let result
    try {
      result = await runAgentLoop({
        provider,
        model: resolvedModel,
        system: buildAgentSystemPrompt(cwd, boundary),
        tools: createCoreTools(),
        messages: [...history, { role: 'user', content: prompt }],
        permissionMode,
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
      writeLine(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
      return
    } finally {
      controller.current = null
    }

    history = result.messages
    addUsage(totalUsage, result.usage)
    if (result.usage) {
      writeLine(
        `\n${BANNER_LINE}\n` +
          `  turn ${result.turns} · in ${formatTokens(result.usage.inputTokens)} / ` +
          `out ${formatTokens(result.usage.outputTokens)} tok · ` +
          `session total in ${formatTokens(totalUsage.inputTokens)} / out ${formatTokens(totalUsage.outputTokens)} tok`,
      )
    }
    if (result.stopReason !== 'end_turn' && result.error) {
      writeLine(`  ✗ ${result.error}`)
    }
    for (const warning of result.warnings ?? []) {
      writeLine(`  ⚠ ${warning}`)
    }
    if (abortedThisRun) {
      writeLine('  ⏹ stopped — partial progress is kept in the conversation.')
    }
  }

  const handleSlash = async raw => {
    const command = raw.trim().split(/\s+/)[0]
    switch (command.toLowerCase()) {
      case '/help':
        writeLine(
          [
            'Slash commands:',
            '  /help      Show this help',
            '  /clear     Start a fresh conversation (history is dropped)',
            '  /compact   Summarize older history now, keep recent messages verbatim',
            '  /sessions  List recent sessions for this workspace',
            '  /cost      Token totals and estimated cost for this interactive session',
            '  /exit      Leave the session (also: /quit, Ctrl+C, Ctrl+D)',
          ].join('\n'),
        )
        return true
      case '/exit':
      case '/quit':
        return false
      case '/clear':
        history = []
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
  writeLine(`${productName} ${version ? `v${version}` : ''} — interactive session`)
  writeLine(`model: ${resolvedModel ?? '(provider default)'} · mode: ${permissionMode} · cwd: ${cwd}`)
  writeLine(`boundary (file tools): ${boundaryLine}`)
  if (resumedFrom) writeLine(`↩ resumed session ${resumedFrom} (${history.length} message(s))`)
  writeLine('Type a task, or /help for commands. Ctrl+D exits.')
  writeLine(BANNER_LINE)

  rl.on('SIGINT', () => {
    // Ctrl+C: abort the running turn, or leave if idle.
    if (controller.current) {
      abortedThisRun = true
      controller.current.abort()
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
    for (;;) {
      write('\nYou > ')
      let line = await takeLine()
      line = line.trim()
      if (line === '') continue
      if (line.startsWith('/')) {
        const keepGoing = await handleSlash(line)
        if (!keepGoing) break
        continue
      }
      await runTurn(line)
    }
  } finally {
    rl.close()
  }

  writeLine(`bye — session usage in ${totalUsage.inputTokens} / out ${totalUsage.outputTokens} tok.`)
  return 0
}
