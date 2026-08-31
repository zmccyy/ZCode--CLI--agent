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
import { resolveRunMode, RUN_MODE_LABELS, getRunModeHelpLines } from '../utils/permissions/runMode.js'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildAgentSystemPrompt,
  createInteractiveConfirm,
  createProgressRenderer,
  resolveGuardrailLimits,
  runHarnessPrint,
} from './harnessPrint.js'

const DEFAULT_COMMANDS = Object.freeze(['help', 'doctor', 'models', 'print'])

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
function estimateCost(usage, model) {
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
 * Extract code blocks from markdown text. Returns an array of { language, code, startLine, endLine }.
 * Matches ```language\n...\n``` fenced blocks.
 */
function extractCodeBlocks(text) {
  if (typeof text !== 'string' || !text) return []
  const blocks = []
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const language = match[1]?.trim() || ''
    const code = match[2]?.replace(/\n$/, '') || ''
    if (!code.trim()) continue
    blocks.push({ language, code })
  }
  return blocks
}

/**
 * Infer a filename from a code block's language and existing project structure.
 * Falls back to a generic name when language-specific detection fails.
 */
function inferFilename(language, cwd = process.cwd()) {
  const extMap = {
    js: 'module.js',
    ts: 'module.ts',
    tsx: 'Component.tsx',
    jsx: 'Component.jsx',
    py: 'script.py',
    rs: 'module.rs',
    go: 'module.go',
    java: 'Main.java',
    rb: 'script.rb',
    php: 'script.php',
    css: 'style.css',
    html: 'index.html',
    json: 'data.json',
    yaml: 'config.yaml',
    yml: 'config.yml',
    toml: 'config.toml',
    md: 'README.md',
    sql: 'query.sql',
    sh: 'script.sh',
    bat: 'script.bat',
    ps1: 'script.ps1',
    dockerfile: 'Dockerfile',
  }
  const lang = language.toLowerCase()
  return extMap[lang] || `output.${lang || 'txt'}`
}

/**
 * Write code blocks to files. Returns an array of written file paths.
 * If a writePath is provided (single file), writes only the first code block.
 */
function writeCodeBlocks(blocks, writePath, cwd = process.cwd()) {
  if (!blocks.length) return []

  const written = []

  if (writePath) {
    // Single file mode: write first block
    const block = blocks[0]
    const targetPath = path.resolve(cwd, writePath)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, block.code + '\n', 'utf8')
    written.push(targetPath)
  } else {
    // Multi-file mode: infer filenames
    for (const block of blocks) {
      const filename = inferFilename(block.language, cwd)
      const targetPath = path.resolve(cwd, filename)
      mkdirSync(path.dirname(targetPath), { recursive: true })

      // Avoid overwriting: append suffix if file exists
      let finalPath = targetPath
      let counter = 1
      while (existsSync(finalPath)) {
        const ext = path.extname(targetPath)
        const base = path.basename(targetPath, ext)
        const dir = path.dirname(targetPath)
        finalPath = path.join(dir, `${base}-${counter}${ext}`)
        counter++
      }

      writeFileSync(finalPath, block.code + '\n', 'utf8')
      written.push(finalPath)
    }
  }

  return written
}

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
  const options = {
    help: false,
    json: false,
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

    if (arg === '--version' || arg === '-v' || arg === '-V') {
      options.version = true
      continue
    }

    if (arg === '--model' || arg === '-m') {
      const next = argv[index + 1]
      const model = readString(next)
      if (!model) {
        throw new Error(`${arg} requires a model id`)
      }
      options.model = model
      index += 1
      continue
    }

    if (arg === '--print' || arg === '-p') {
      const next = argv[index + 1]
      const prompt = readString(next)
      if (!prompt) {
        throw new Error(`${arg} requires a prompt`)
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
        throw new Error(`${arg} requires a positive integer`)
      }
      options.maxTurns = parsed
      index += 1
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    positionals.push(arg)
  }

  options.command = readString(positionals[0])
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
    '  -p, --print <prompt> Run the agent loop headless (tools + guardrails)',
    '',
    'Options:',
    '  -m, --model <id>     Specify the model to use',
    '  --json               Output in JSON format (adds toolCalls/usage/stopReason)',
    '  -w, --write [path]   Write code blocks from response to file(s)',
    ...getRunModeHelpLines(),
    '  --reasoning          Show model thinking/reasoning process',
    '  --max-turns <n>      Agent loop turn limit (default 30, env ZCODE_MAX_TURNS)',
    '',
    'Examples:',
    `  ${commandName} -p "explain this code" --reasoning`,
    `  ${commandName} -p "fix all failing tests" --yolo`,
    `  ${commandName} -p "explore the repo and propose a plan" --plan`,
    `  ${commandName} -p "write a hello world script" --write hello.js`,
    `  ${commandName} doctor --json`,
    '',
    'Notes:',
    '  This public build does not boot the full interactive TUI path.',
    '  The public local entrypoint is intentionally limited to stable modules.',
    `  ${getLaunchCommandTip()}`,
  ].join('\n')
}

export function createDoctorReport({
  cwd = process.cwd(),
  env = process.env,
  version = '0.0.0',
  runtime = getRuntimeSnapshot(),
  createProviderFromEnv = defaultCreateProviderFromEnv,
  createModelRegistryFromEnv = defaultCreateModelRegistryFromEnv,
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
    commands: toCommandList(),
    notes: [
      'Legacy interactive startup is not wired in this public build.',
      'Use doctor, models, or --print to validate the local public entrypoint.',
    ],
    models,
  }
}


function renderDoctorText(report) {
  return [
    `${report.productName} local doctor`,
    `cwd: ${report.cwd}`,
    `runtime: ${report.runtime.engine}${report.runtime.bun ? ` ${report.runtime.bun}` : ''}${report.runtime.node ? `, node ${report.runtime.node}` : ''}`,
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
    const options = parseArgv(argv)
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

    if (options.help || (!options.command && !options.printPrompt)) {
      writeLine(stdout, renderHelp({ version }))
      return 0
    }

    if (options.command === 'help') {
      writeLine(stdout, renderHelp({ version }))
      return 0
    }

    if (options.command === 'doctor') {
      const report = createDoctorReport({
        cwd,
        env,
        version,
        createProviderFromEnv,
        createModelRegistryFromEnv,
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

    if (options.printPrompt) {
      const provider = createProviderFromEnv(env)

      if (!isPrintCapableProvider(provider)) {
        throw new Error(
          `Provider ${provider.id} is not ready for local print mode. Configure ZCODE_PROVIDER=openai-compatible and the ZCODE_OPENAI_* variables first.`,
        )
      }

      if (!options.json) {
        if (runMode === 'plan') {
          writeLine(stdout, `── ${RUN_MODE_LABELS.plan} MODE ──`)
        } else if (runMode === 'yolo') {
          writeLine(stdout, `── ${RUN_MODE_LABELS.yolo} MODE ──`)
        }
      }

      const guardrailLimits = resolveGuardrailLimits(env)
      const maxTurns = options.maxTurns ?? guardrailLimits.maxTurns

      let reasoning = ''
      // JSON mode must keep stdout machine-readable: no human progress lines.
      const progressRenderer = options.json
        ? () => {}
        : createProgressRenderer({
            stdout,
            stderr,
            showReasoning: options.reasoning,
          })
      const onEvent = event => {
        if (options.reasoning && event.type === 'reasoning_delta') {
          reasoning += event.text
        }
        progressRenderer(event)
      }

      const permissionMode = runMode === 'plan' ? 'plan' : runMode === 'yolo' ? 'yolo' : 'agent'
      const confirm = createInteractiveConfirm({ stdin: stdin ?? process.stdin, stdout })

      const result = await runHarnessPrint({
        prompt: options.printPrompt,
        model: options.model,
        provider,
        permissionMode,
        confirm,
        cwd,
        maxTurns,
        budgetTokens: guardrailLimits.budgetTokens,
        showReasoning: options.reasoning,
        onEvent,
        transcript: {
          enabled: true,
          dir: readString(env.ZCODE_TRANSCRIPT_DIR) || undefined,
        },
        reasoning: reasoning || undefined,
      })

      if (options.json) {
        // JSON envelope: backward-compatible superset of the print result.
        const blocks = result.text ? extractCodeBlocks(result.text) : []
        const costInfo = result.usage ? estimateCost(result.usage, result.model) : null
        const output = {
          ...result,
          runMode,
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

        writeJson(stdout, output)
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

      // Exit code honesty for CI: end_turn succeeded; guardrail stops and
      // errors mean the task did not complete.
      return result.stopReason === 'end_turn' ? 0 : 1
    }

    throw new Error(`Unknown command: ${options.command}`)
  } catch (error) {
    writeLine(
      stderr,
      error instanceof Error ? error.message : 'Unknown CLI failure',
    )
    return 1
  }
}
