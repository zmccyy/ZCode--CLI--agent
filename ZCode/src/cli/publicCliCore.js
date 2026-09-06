import {
  createModelRegistryFromEnv as defaultCreateModelRegistryFromEnv,
  createProviderFromEnv as defaultCreateProviderFromEnv,
  resolveProviderMode,
} from '../providers/runtime.js'
import {
  getCliDescription,
  getCommandName,
  getLaunchCommandTip,
  getProductName,
  getVersionBanner,
} from '../config/brandText.js'
import { LOOP_CONTRACT_VERSION } from '../harness/types.ts'
import { discoverMcpTools } from '../harness/mcpTools.ts'
import { resolveRunMode, RUN_MODE_LABELS, getRunModeHelpLines } from '../utils/permissions/runMode.js'
import { loadSettingsFromDisk } from '../config/settingsContract.js'
import { applyProviderSettingsToEnv } from '../config/providerEnvironment.js'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createInteractiveConfirm,
  createProgressRenderer,
  resolveGuardrailLimits,
  resolveCompactFromEnv,
  runHarnessPrint,
} from './harnessPrint.js'
import { runTui } from './tui.js'
import { collectEnvironmentInfo } from './envInfo.js'
import { collectProjectMemory } from './projectMemory.js'
import { wwwMain } from '../../www/server.ts'
import {
  defaultTranscriptDir,
  findLatestSession,
  listSessions,
  loadSessionForResume,
  resolveSessionPath,
  ResumeError,
} from '../harness/index.ts'

const DEFAULT_COMMANDS = Object.freeze(['help', 'doctor', 'models', 'sessions', 'print', 'www'])

/** Command-line usage failure — exits with code 2 (distinct from runtime errors). */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

// ---------------------------------------------------------------------------
// Lightweight cost estimation for print mode
// ---------------------------------------------------------------------------

/** Pricing per 1M tokens: { input, output } in USD. */
const MODEL_PRICING = {
  // DeepSeek
  'deepseek-chat':    { input: 0.14, output: 0.28 },
  'deepseek-reasoner':{ input: 0.55, output: 2.19 },
  'deepseek-v3':      { input: 0.27, output: 1.10 },
  // OpenAI
  'gpt-4o':           { input: 2.50, output: 10.00 },
  'gpt-4o-mini':      { input: 0.15, output: 0.60  },
  'gpt-4-turbo':      { input: 10.00, output: 30.00 },
  'gpt-4':            { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo':    { input: 0.50, output: 1.50 },
  'o1':               { input: 15.00, output: 60.00 },
  'o1-mini':          { input: 3.00, output: 12.00 },
  'o3-mini':          { input: 1.10, output: 4.40 },
  // Anthropic
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku':  { input: 0.80, output: 4.00  },
  'claude-3-opus':     { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'claude-opus-4-1-20250805':  { input: 15.00, output: 75.00 },
  'claude-opus-4-5-20251101':  { input: 5.00, output: 25.00 },
  'claude-opus-4-6':  { input: 5.00, output: 25.00 },
  // Ollama / local (free)
  'llama':             { input: 0, output: 0 },
  'mistral':           { input: 0, output: 0 },
  'codellama':         { input: 0, output: 0 },
  'qwen':              { input: 0, output: 0 },
  'gemma':             { input: 0, output: 0 },
}

/**
 * Match a model string against the pricing table.
 * Returns null if no pricing is known.
 * @param {string} modelId
 * @returns {{ input: number, output: number } | null}
 */
function lookupModelPricing(modelId) {
  if (!modelId) return null
  const key = modelId.toLowerCase()

  // Exact match
  if (MODEL_PRICING[key]) return MODEL_PRICING[key]

  // Prefix match: e.g. "deepseek-chat-v3-0324" → "deepseek-chat"
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (key.includes(prefix)) return pricing
  }

  return null
}

/**
 * Estimate USD cost from token counts and model pricing.
 * @param {{ inputTokens?: number, outputTokens?: number, cacheReadInputTokens?: number, cacheCreationInputTokens?: number }} usage
 * @param {string | null} model
 * @returns {{ cost: number, pricing: { input: number, output: number } } | null}
 */
export function estimateCost(usage, model) {
  const pricing = lookupModelPricing(model)
  if (!pricing) return null

  const input = usage.inputTokens || 0
  const output = usage.outputTokens || 0
  const cost = (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output

  return { cost, pricing }
}

function formatCost(costUSD) {
  if (costUSD === 0) return '$0.00'
  if (costUSD >= 0.01) return `$${costUSD.toFixed(2)}`
  if (costUSD >= 0.0001) return `$${costUSD.toFixed(4)}`
  return `< $0.0001`
}

function getRuntimeSnapshot() {
  return {
    engine: typeof globalThis.Bun?.version === 'string' ? 'bun' : 'node',
    node:
      typeof process?.versions?.node === 'string'
        ? `v${process.versions.node}`
        : null,
    bun:
      typeof globalThis.Bun?.version === 'string' ? globalThis.Bun.version : null,
  }
}

function readString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function writeLine(stream, value = '') {
  stream.write(`${value}\n`)
}

function writeJson(stream, value) {
  writeLine(stream, JSON.stringify(value, null, 2))
}

function stripWrappingQuotes(value) {
  if (value.length < 2) {
    return value
  }

  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }

  return value
}

function parseDotEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const normalized = trimmed.startsWith('export ')
    ? trimmed.slice(7).trim()
    : trimmed
  const separatorIndex = normalized.indexOf('=')
  if (separatorIndex <= 0) {
    return null
  }

  const key = normalized.slice(0, separatorIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null
  }

  const rawValue = normalized.slice(separatorIndex + 1).trim()
  return [key, stripWrappingQuotes(rawValue)]
}

/**
 * Code-block helpers moved to ./codeBlocks.js so the TUI can reuse them
 * without importing this module (which imports the TUI). writeCodeBlocks is
 * re-exported for the security regression tests that import it from here.
 */
import { extractCodeBlocks, inferFilename, writeCodeBlocks } from './codeBlocks.js'

export { writeCodeBlocks }

export function loadDotEnvFile({
  cwd = process.cwd(),
  env = process.env,
  fileName = '.env',
} = {}) {
  const filePath = path.join(cwd, fileName)
  if (!existsSync(filePath)) {
    return {
      loaded: false,
      path: filePath,
      keys: [],
    }
  }

  const source = readFileSync(filePath, 'utf8')
  const keys = []

  for (const line of source.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line)
    if (!parsed) {
      continue
    }

    const [key, value] = parsed
    keys.push(key)

    if (env[key] === undefined) {
      env[key] = value
    }
  }

  return {
    loaded: true,
    path: filePath,
    keys,
  }
}

function parseArgv(argv = []) {
  const options = {    help: false,
    json: false,
    streamJson: false,
    version: false,
    model: null,
    printPrompt: null,
    command: null,
    write: false,
    writePath: null,
    plan: false,
    yolo: false,
    reasoning: false,
    maxTurns: null,
    continueLatest: false,
    resumeRef: null,
    addDirs: [],
    noBoundary: false,
    wwwArgs: [],
  }
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg === '--stream-json') {
      options.streamJson = true
      continue
    }

    if (arg === '--version' || arg === '-v' || arg === '-V') {
      options.version = true
      continue
    }

    if (arg === '--model' || arg === '-m') {
      const next = argv[index + 1]
      const model = readString(next)
      if (!model) {
        throw new UsageError(`${arg} requires a model id`)
      }
      options.model = model
      index += 1
      continue
    }

    if (arg === '--print' || arg === '-p') {
      const next = argv[index + 1]
      const prompt = readString(next)
      if (!prompt) {
        throw new UsageError(`${arg} requires a prompt`)
      }
      options.printPrompt = prompt
      index += 1
      continue
    }

    if (arg === '--write' || arg === '-w') {
      const next = argv[index + 1]
      const writePath = readString(next)
      if (!writePath) {
        options.write = true
      } else {
        options.write = true
        options.writePath = writePath
        index += 1
      }
      continue
    }

    if (arg === '--plan') {
      options.plan = true
      continue
    }

    if (arg === '--yolo') {
      options.yolo = true
      continue
    }

    if (arg === '--reasoning') {
      options.reasoning = true
      continue
    }

    if (arg === '--max-turns') {
      const next = argv[index + 1]
      const parsed = Number.parseInt(next, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new UsageError(`${arg} requires a positive integer`)
      }
      options.maxTurns = parsed
      index += 1
      continue
    }

    if (arg === '--continue') {
      options.continueLatest = true
      continue
    }

    if (arg === '--resume') {
      const next = argv[index + 1]
      const ref = readString(next)
      if (!ref) {
        throw new UsageError(`${arg} requires a session id or transcript path`)
      }
      options.resumeRef = ref
      index += 1
      continue
    }

    if (arg === '--add-dir') {
      const next = argv[index + 1]
      const dir = readString(next)
      if (!dir) {
        throw new UsageError(`${arg} requires a directory path`)
      }
      options.addDirs.push(dir)
      index += 1
      continue
    }

    if (arg === '--no-boundary') {
      options.noBoundary = true
      continue
    }

    if (arg === 'www') {
      // The www command owns its own flags (--port/--no-open): everything
      // after `www` passes through to wwwMain verbatim.
      options.command = 'www'
      options.wwwArgs = argv.slice(index + 1)
      break
    }

    if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`)
    }

    positionals.push(arg)
  }

  if (options.continueLatest && options.resumeRef) {
    throw new UsageError('--continue and --resume are mutually exclusive')
  }

  // Plan mode promises ZERO write side effects — including the CLI's own
  // post-processing that persists Markdown code blocks. The combination is
  // rejected up front instead of silently breaking the promise.
  if (options.plan && options.write) {
    throw new UsageError('--plan and --write cannot be combined: plan mode never writes files')
  }

  // `www` (or any future pass-through command) sets `command` itself.
  options.command = options.command ?? readString(positionals[0])
  return options
}

function toCommandList() {
  return [...DEFAULT_COMMANDS]
}

function getDefaultModel(provider) {
  if (typeof provider?.listModels !== 'function') {
    return null
  }

  return readString(provider.listModels()?.[0]?.id)
}

function isPrintCapableProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    return false
  }

  if (
    provider.kind === 'openai-compatible' ||
    readString(provider.id)?.startsWith('openai-compatible:')
  ) {
    return true
  }

  // The harness loop speaks the Anthropic dialect too.
  if (provider.kind === 'anthropic' || readString(provider.id)?.startsWith('anthropic:')) {
    return true
  }

  return provider.supportsPrint === true
}

export function renderHelp({ version = '0.0.0' } = {}) {
  const commandName = getCommandName()

  return [
    `${getProductName()} CLI Agent`,
    getCliDescription(),
    '',
    `Version: ${getVersionBanner(version)}`,
    '',
    'Usage:',
    `  npm start -- [command] [options]`,
    `  ${commandName} [command] [options]`,
    '',
    'Commands:',
    '  help                 Show this help message',
    '  doctor               Inspect the local runtime and provider wiring',
    '  models               List the models exposed by the active provider',
    '  sessions             List recent sessions for this workspace',
    '  www [options]        Serve the local promo site (--port <n>, --no-open)',
    '  -p, --print <prompt> Run the agent loop headless (tools + guardrails)',
    '',
    'Options:',
    '  -m, --model <id>     Specify the model to use',
    '  --json               Output in JSON format (adds toolCalls/usage/stopReason)',
    '  --stream-json        With -p: emit each loop event as one JSON line, ending',
    '                       with a "type":"result" line (machine-readable streams)',
    '  -w, --write [path]   Write code blocks from response to file(s)',
    ...getRunModeHelpLines(),
    '  --reasoning          Show model thinking/reasoning process',
    '  --max-turns <n>      Agent loop turn limit (default 30, env ZCODE_MAX_TURNS)',
    '  --continue           Continue the most recent session for this workspace',
    '  --resume <id|path>   Resume a specific session transcript',
    '  --add-dir <dir>      Trust an extra directory for file tools (repeatable)',
    '  --no-boundary        Lift the workspace boundary (file tools reach everywhere)',
    '',
    'Examples:',
    `  ${commandName} -p "explain this code" --reasoning`,
    `  ${commandName} -p "fix all failing tests" --yolo`,
    `  ${commandName} -p "explore the repo and propose a plan" --plan`,
    `  ${commandName} -p "write a hello world script" --write hello.js`,
    `  ${commandName} -p "keep going" --continue`,
    `  ${commandName} sessions`,
    `  ${commandName} doctor --json`,
    '',
    'Notes:',
    '  Bare `zcode` starts an interactive session (TTY); `-p` runs headless.',
    '  File tools are confined to the workspace boundary by default',
    '  (--add-dir extends it, --no-boundary lifts it). Bash is gated by an',
    '  allow/deny policy, not by the boundary — see the docs for the trust model.',
    `  ${getLaunchCommandTip()}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Doctor environment checks (Windows-first, all probes best-effort)
// ---------------------------------------------------------------------------

function probeTranscriptDirWritable(cwd) {
  try {
    const dir = defaultTranscriptDir(cwd)
    mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.doctor-probe-${process.pid}`)
    writeFileSync(probe, 'probe', 'utf8')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function probeApiKeyConfigured(env) {
  // Presence only — never the value.
  return {
    openaiCompatible: Boolean((env.ZCODE_OPENAI_API_KEY ?? '').trim()),
    anthropic: Boolean((env.ANTHROPIC_API_KEY ?? '').trim()),
  }
}

/**
 * Safe summary of merged settings for doctor: never includes raw API keys.
 */
export function summarizeSettingsForDoctor(settings) {
  if (!settings || typeof settings !== 'object') return null
  return {
    keys: Object.keys(settings),
    provider: settings.provider ?? null,
    model: settings.model ?? null,
    openaiCompatibleBaseUrl: settings.openaiCompatible?.baseUrl ?? null,
    openaiCompatibleApiKeyConfigured: Boolean(settings.openaiCompatible?.apiKey),
  }
}

/**
 * Async doctor report: shell/git/OS probes come from collectEnvironmentInfo
 * (short-timeout execFile probes that degrade gracefully). Adds a transcript
 * writability probe and API-key presence (never values).
 */
export async function createDoctorReport({
  cwd = process.cwd(),
  env = process.env,
  version = '0.0.0',
  runtime = getRuntimeSnapshot(),
  createProviderFromEnv = defaultCreateProviderFromEnv,
  createModelRegistryFromEnv = defaultCreateModelRegistryFromEnv,
  settingsSummary = null,
} = {}) {
  const provider = createProviderFromEnv(env)
  const registry = createModelRegistryFromEnv(env)
  const models =
    typeof registry?.list === 'function'
      ? registry.list().map(model => ({
          id: model.id,
          provider: model.provider,
          displayName: model.displayName,
        }))
      : []

  const [envInfo, memory] = await Promise.all([
    collectEnvironmentInfo(cwd, { env }).catch(() => null),
    collectProjectMemory(cwd).catch(() => null),
  ])

  return {
    productName: getProductName(),
    version,
    cwd,
    startable: true,
    runtime,
    provider: {
      mode: resolveProviderMode(env),
      id: provider.id,
      kind: provider.kind,
      printReady: isPrintCapableProvider(provider),
      defaultModel: getDefaultModel(provider),
      modelCount: models.length,
    },
    environment: {
      platform: envInfo?.platform ?? process.platform,
      os: envInfo ? `${envInfo.osType} ${envInfo.osRelease}` : os.type(),
      terminal: process.stdout?.isTTY ? 'tty' : 'pipe',
      shell: envInfo?.shell ?? 'unavailable',
      gitAvailable: Boolean(envInfo?.git),
      nodeVersion: process.version,
      transcriptDirWritable: probeTranscriptDirWritable(cwd),
      apiKeyConfigured: probeApiKeyConfigured(env),
      projectMemoryFiles: memory?.files.length ?? 0,
    },
    effectiveSettings: settingsSummary,
    commands: toCommandList(),
    notes: [
      'Bare `zcode` starts the interactive TUI on a TTY; `-p` runs headless.',
      'Bash tool uses Git Bash by default; set ZCODE_SHELL=powershell to switch dialects.',
    ],
    models,
  }
}


function renderDoctorText(report) {
  const environment = report.environment ?? {}
  const apiKeys = environment.apiKeyConfigured ?? {}
  return [
    `${report.productName} local doctor`,
    `cwd: ${report.cwd}`,
    `runtime: ${report.runtime.engine}${report.runtime.bun ? ` ${report.runtime.bun}` : ''}${report.runtime.node ? `, node ${report.runtime.node}` : ''}`,
    `platform: ${environment.platform ?? 'unknown'} (${environment.os ?? 'unknown'}) · terminal: ${environment.terminal ?? 'unknown'}`,
    `shell: ${environment.shell ?? 'unknown'} · git: ${environment.gitAvailable ? 'available' : 'unavailable'}`,
    `transcript dir writable: ${environment.transcriptDirWritable ? 'yes' : 'no'}`,
    `project memory files: ${environment.projectMemoryFiles ?? 0} (AGENTS.md/ZCODE.md)`,
    `api key configured: openai-compatible ${apiKeys.openaiCompatible ? 'yes' : 'no'} · anthropic ${apiKeys.anthropic ? 'yes' : 'no'}`,
    `effective settings: ${report.effectiveSettings?.keys?.length ? report.effectiveSettings.keys.join(', ') : '(none)'}`,
    `provider: ${report.provider.id} (${report.provider.mode})`,
    `print ready: ${report.provider.printReady ? 'yes' : 'no'}`,
    `models: ${report.provider.modelCount}`,
    '',
    ...report.notes,
  ].join('\n')
}

function renderModelsText(models) {
  if (!models.length) {
    return 'No models are currently exposed by the active provider.'
  }

  return models
    .map(model => `${model.id} [${model.provider}]`)
    .join('\n')
}

function renderSep(label = '') {
  const cols = typeof process.stdout?.columns === 'number' ? process.stdout.columns : 80
  const sepWidth = Math.max(0, cols - label.length - 4)
  const left = '─'.repeat(Math.floor(sepWidth / 2))
  const right = '─'.repeat(Math.ceil(sepWidth / 2))
  return label ? `${left} ${label} ${right}` : '─'.repeat(cols)
}

function renderPrintResult(result, { json, write, writePath, showReasoning, cwd, textStreamed = false }) {
  const lines = []

  if (json) return JSON.stringify(result, null, 2)

  // Header
  lines.push(renderSep(`${result.model}`))

  // Reasoning section
  if (showReasoning && result.reasoning) {
    lines.push('')
    lines.push('∴ Thinking')
    lines.push(renderSep())
    lines.push(result.reasoning)
    lines.push(renderSep())
    lines.push('')
  }

  // Main text — skipped when the progress renderer already streamed it live.
  if (result.text && !textStreamed) {
    lines.push(result.text)
  }

  // Tool calls
  if (result.toolCalls && result.toolCalls.length > 0) {
    lines.push('')
    lines.push(renderSep('Tool Calls'))
    for (const tc of result.toolCalls) {
      lines.push(`  ${tc.name || 'unknown'}(${JSON.stringify(tc.arguments || tc.input || {})})`)
    }
  }

  // Code block extraction
  if (result.text) {
    const blocks = extractCodeBlocks(result.text)
    if (blocks.length > 0) {
      lines.push('')
      lines.push(renderSep(`${blocks.length} code block${blocks.length > 1 ? 's' : ''}`))
      if (write) {
        // Write to files
        try {
          const written = writeCodeBlocks(blocks, writePath, cwd)
          for (const wp of written) {
            lines.push(`  ✓ Written: ${wp}`)
          }
        } catch (err) {
          lines.push(`  ✗ Error: ${err.message}`)
        }
      } else {
        // Preview mode: show filenames
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i]
          const filename = writePath || inferFilename(block.language, cwd)
          lines.push(`  [${i + 1}] ${block.language || 'text'} → ${filename} (${block.code.split('\n').length} lines)`)
        }
        lines.push(`  Run with --write to create file${blocks.length > 1 ? 's' : ''}`)
      }
    }
  }

  // Usage footer with token counts + cost
  if (result.usage) {
    const parts = [
      `${formatTokens(result.usage.inputTokens)} in`,
      `${formatTokens(result.usage.outputTokens)} out`,
    ]
    if (result.usage.totalTokens) {
      parts.push(`${formatTokens(result.usage.totalTokens)} total`)
    }
    if (result.usage.cacheReadInputTokens > 0) {
      parts.push(`${formatTokens(result.usage.cacheReadInputTokens)} cache read`)
    }
    // Cost
    const costInfo = estimateCost(result.usage, result.model)
    if (costInfo) {
      parts.push(`cost ${formatCost(costInfo.cost)}`)
    }
    lines.push('')
    lines.push(renderSep(parts.join(' · ')))
  } else {
    lines.push('')
    lines.push(renderSep())
  }

  return lines.join('\n')
}

function formatTokens(n) {
  if (n == null) return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    version = '0.0.0',
    createProviderFromEnv = defaultCreateProviderFromEnv,
    createModelRegistryFromEnv = defaultCreateModelRegistryFromEnv,
  } = {},
) {
  try {
    loadDotEnvFile({ cwd, env })

    // ── Settings wiring (P1.4): user → project → local → flag → policy ──
    // File layers fill provider/model/env defaults; applyProviderSettingsToEnv
    // applies the provider section with the repo's designed precedence (its
    // host-managed guard flag is honored). Invalid files warn but never block.
    const { settings: diskSettings, errors: settingsErrors } = loadSettingsFromDisk({ cwd })
    for (const error of settingsErrors) {
      writeLine(stderr, `WARNING: settings: ${error.message}`)
    }
    if (diskSettings.env) {
      // settings.env fills gaps only: real environment and .env always win.
      for (const [key, value] of Object.entries(diskSettings.env)) {
        if (!(key in env)) env[key] = value
      }
    }
    applyProviderSettingsToEnv(diskSettings, env)

    // ── MCP stdio servers (P1.3) — default off: nothing spawns without
    // config. Discovery is lazy + memoized so help/doctor/models/www never
    // start a server; failures degrade to stderr warnings, never to a failed
    // session. The caller of each agent path must dispose the session so no
    // server process outlives the run.
    let mcpSessionPromise = null
    const getMcpSession = () => {
      if (mcpSessionPromise === null) {
        mcpSessionPromise = discoverMcpTools({ servers: diskSettings.mcpServers, cwd })
          .then(session => {
            for (const warning of session.warnings) {
              writeLine(stderr, `WARNING: mcp: ${warning}`)
            }
            return session
          })
          .catch(error => {
            writeLine(stderr, `WARNING: mcp: discovery failed: ${error instanceof Error ? error.message : String(error)}`)
            return { tools: [], warnings: [], dispose() {} }
          })
      }
      return mcpSessionPromise
    }

    const options = parseArgv(argv)
    // CLI -m wins; settings.model is the fallback default.
    const effectiveModel = options.model ?? diskSettings.model ?? undefined
    const { runMode, error: runModeError } = resolveRunMode({
      plan: options.plan,
      yolo: options.yolo,
    })

    if (runModeError) {
      writeLine(stderr, `WARNING: ${runModeError}`)
    }

    if (options.version) {
      writeLine(stdout, getVersionBanner(version))
      return 0
    }

    const bareInvocation = !options.command && !options.printPrompt

    // Bare `zcode` on a real terminal → interactive TUI. Piped stdin (CI,
    // scripts) keeps the historic help output; headless callers use -p.
    if (bareInvocation && !options.help && stdin?.isTTY === true) {
      const provider = createProviderFromEnv(env)
      if (!isPrintCapableProvider(provider)) {
        writeLine(stderr, 'No provider configured — run `zcode doctor` and set ZCODE_PROVIDER / ZCODE_OPENAI_* first.')
        return 1
      }

      const guardrailLimits = resolveGuardrailLimits(env)
      const transcriptDir = readString(env.ZCODE_TRANSCRIPT_DIR) || defaultTranscriptDir(cwd)

      // --continue / --resume without -p seed the interactive conversation.
      let initialMessages = []
      let resumedFrom = null
      if (options.continueLatest || options.resumeRef) {
        const resumePath = options.continueLatest
          ? (await findLatestSession(transcriptDir))?.path ?? null
          : await resolveSessionPath(transcriptDir, options.resumeRef)
        if (!resumePath) {
          writeLine(stderr, `No sessions recorded in ${transcriptDir} yet — nothing to --continue.`)
          return 1
        }
        const snapshot = await loadSessionForResume(resumePath)
        initialMessages = snapshot.messages
        resumedFrom = snapshot.sessionId
      }

      // MCP servers (P1.3): discover once, keep them alive for the whole
      // interactive session, and shut them down when the TUI ends.
      const mcpSession = await getMcpSession()
      try {
        return await runTui({
          stdin,
          stdout,
          stderr,
          provider,
          cwd,
          env,
          permissionMode: runMode === 'plan' ? 'plan' : runMode === 'yolo' ? 'yolo' : 'agent',
          model: effectiveModel,
          boundary: options.noBoundary ? false : { enabled: true, addDirs: options.addDirs },
          maxTurns: options.maxTurns ?? guardrailLimits.maxTurns,
          budgetTokens: guardrailLimits.budgetTokens,
          compact: resolveCompactFromEnv(env),
          transcript: { enabled: true, dir: readString(env.ZCODE_TRANSCRIPT_DIR) || undefined },
          version,
          initialMessages,
          resumedFrom,
          transcriptDir,
          estimateCost,
          mcpTools: mcpSession.tools,
        })
      } finally {
        mcpSession.dispose()
      }
    }

    if (options.help || bareInvocation) {
      writeLine(stdout, renderHelp({ version }))
      return 0
    }

    if (options.command === 'help') {
      writeLine(stdout, renderHelp({ version }))
      return 0
    }

    if (options.command === 'www') {
      // Serves the local promo site; blocks until Ctrl+C (wwwMain handles
      // its own port fallback and browser opening).
      await wwwMain(options.wwwArgs ?? [])
      return 0
    }

    if (options.command === 'doctor') {
      const report = await createDoctorReport({
        cwd,
        env,
        version,
        createProviderFromEnv,
        createModelRegistryFromEnv,
        settingsSummary: summarizeSettingsForDoctor(diskSettings),
      })

      if (options.json) {
        writeJson(stdout, report)
      } else {
        writeLine(stdout, renderDoctorText(report))
      }

      return 0
    }

    if (options.command === 'models') {
      const registry = createModelRegistryFromEnv(env)
      const models = typeof registry?.list === 'function' ? registry.list() : []

      if (options.json) {
        writeJson(stdout, models)
      } else {
        writeLine(stdout, renderModelsText(models))
      }

      return 0
    }

    if (options.command === 'sessions') {
      const dir = readString(env.ZCODE_TRANSCRIPT_DIR) || defaultTranscriptDir(cwd)
      const sessions = await listSessions(dir)

      if (options.json) {
        writeJson(
          stdout,
          sessions.map(session => ({
            sessionId: session.sessionId,
            path: session.path,
            modifiedAt: new Date(session.mtimeMs).toISOString(),
            sizeBytes: session.sizeBytes,
          })),
        )
      } else if (sessions.length === 0) {
        writeLine(stdout, `No sessions recorded in ${dir}`)
      } else {
        for (const session of sessions) {
          const modified = new Date(session.mtimeMs).toISOString().replace('T', ' ').slice(0, 19)
          const sizeKb = session.sizeBytes >= 1024 ? `${(session.sizeBytes / 1024).toFixed(1)} kB` : `${session.sizeBytes} B`
          writeLine(stdout, `${session.sessionId}  ${modified}  ${sizeKb}`)
        }
        writeLine(stdout, '')
        writeLine(stdout, `Resume with: ${getCommandName()} -p "<prompt>" --continue`)
      }

      return 0
    }

    if (options.printPrompt) {
      const provider = createProviderFromEnv(env)

      if (!isPrintCapableProvider(provider)) {
        throw new Error(
          `Provider ${provider.id} is not ready for local print mode. Configure ZCODE_PROVIDER=openai-compatible and the ZCODE_OPENAI_* variables first.`,
        )
      }

      const streamJson = options.streamJson === true
      if (!options.json && !streamJson) {
        if (runMode === 'plan') {
          writeLine(stdout, `── ${RUN_MODE_LABELS.plan} MODE ──`)
        } else if (runMode === 'yolo') {
          writeLine(stdout, `── ${RUN_MODE_LABELS.yolo} MODE ──`)
        }
      }

      const guardrailLimits = resolveGuardrailLimits(env)
      const maxTurns = options.maxTurns ?? guardrailLimits.maxTurns

      // Session resume: --continue picks the most recent transcript for this
      // workspace; --resume takes a session id or transcript path.
      const transcriptDir = readString(env.ZCODE_TRANSCRIPT_DIR) || defaultTranscriptDir(cwd)
      let resumeSnapshot = null
      if (options.continueLatest || options.resumeRef) {
        const resumePath = options.continueLatest
          ? (await findLatestSession(transcriptDir))?.path ?? null
          : await resolveSessionPath(transcriptDir, options.resumeRef)
        if (!resumePath) {
          throw new ResumeError(
            `No sessions recorded in ${transcriptDir} yet — nothing to --continue.`,
          )
        }
        resumeSnapshot = await loadSessionForResume(resumePath)
        if (!options.json && !options.streamJson) {
          writeLine(
            stdout,
            `↩ Resuming session ${resumeSnapshot.sessionId} (${resumeSnapshot.messages.length} message(s))`,
          )
        }
      }

      let reasoning = ''
      // JSON / stream-json modes must keep stdout machine-readable: no human
      // progress lines. stream-json emits every loop event as one compact
      // JSON line, ending with a "type":"result" line.
      const progressRenderer = options.json || streamJson
        ? () => {}
        : createProgressRenderer({
            stdout,
            stderr,
            showReasoning: options.reasoning,
          })
      const onEvent = event => {
        if (streamJson) {
          writeLine(stdout, JSON.stringify(event))
        }
        if (options.reasoning && event.type === 'reasoning_delta') {
          reasoning += event.text
        }
        progressRenderer(event)
      }

      const permissionMode = runMode === 'plan' ? 'plan' : runMode === 'yolo' ? 'yolo' : 'agent'
      const confirm = createInteractiveConfirm({
        stdin: stdin ?? process.stdin,
        stdout,
        cwd,
        boundary: options.noBoundary ? false : { enabled: true, addDirs: options.addDirs },
      })

      // MCP servers (P1.3): discover with the session, release after the run
      // so no server process outlives the print path.
      const mcpSession = await getMcpSession()
      let result
      try {
        result = await runHarnessPrint({
          prompt: options.printPrompt,
          model: effectiveModel,
          provider,
          permissionMode,
          confirm,
          cwd,
          env,
          maxTurns,
          budgetTokens: guardrailLimits.budgetTokens,
          onEvent,
          transcript: {
            enabled: true,
            dir: readString(env.ZCODE_TRANSCRIPT_DIR) || undefined,
          },
          reasoning: reasoning || undefined,
          compact: resolveCompactFromEnv(env),
          boundary: options.noBoundary ? false : { enabled: true, addDirs: options.addDirs },
          ...(resumeSnapshot ? { resume: resumeSnapshot } : {}),
          mcpTools: mcpSession.tools,
        })
      } finally {
        mcpSession.dispose()
      }

      // Non-fatal problems (e.g. transcript persistence) must reach the user;
      // stderr keeps stdout machine-readable in --json mode.
      for (const warning of result.warnings ?? []) {
        writeLine(stderr, `WARNING: ${warning}`)
      }

      if (options.json || streamJson) {
        // JSON envelope: backward-compatible superset of the print result.
        const blocks = result.text ? extractCodeBlocks(result.text) : []
        const costInfo = result.usage ? estimateCost(result.usage, result.model) : null
        const output = {
          ...result,
          runMode,
          // P1.1: contract version of this envelope's event/result surface.
          contractVersion: LOOP_CONTRACT_VERSION,
          ...(costInfo
            ? {
                cost: {
                  usd: Math.round(costInfo.cost * 1_000_000) / 1_000_000,
                  pricing: costInfo.pricing,
                },
              }
            : {}),
          codeBlocks:
            blocks.length > 0
              ? blocks.map(b => ({
                  language: b.language,
                  lines: b.code.split('\n').length,
                }))
              : undefined,
        }

        if (options.write && blocks.length > 0) {
          try {
            output.written = writeCodeBlocks(blocks, options.writePath, cwd)
          } catch (err) {
            output.writeError = err.message
          }
        }

        if (streamJson) {
          // NDJSON discipline: every stdout line is exactly one JSON value,
          // so the terminal envelope is compact and typed.
          writeLine(stdout, JSON.stringify({ type: 'result', ...output }))
        } else {
          writeJson(stdout, output)
        }
      } else {
        writeLine(stdout, renderPrintResult(result, {
          json: false,
          write: options.write,
          writePath: options.writePath,
          showReasoning: options.reasoning,
          cwd,
          textStreamed: true,
        }))
      }

      // Exit code honesty for CI (contracts/23): end_turn succeeded;
      // cancellation is distinct from failure; guardrail stops mean the task
      // did not complete.
      switch (result.stopReason) {
        case 'end_turn':
          return 0
        case 'aborted':
          return 130
        case 'max_turns':
        case 'budget_exceeded':
          return 3
        default:
          return 1
      }
    }

    throw new UsageError(`Unknown command: ${options.command}`)
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : 'Unknown CLI failure',
    )
    return error instanceof UsageError ? 2 : 1
  }
}
