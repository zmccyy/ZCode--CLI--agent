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
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_COMMANDS = Object.freeze(['help', 'doctor', 'models', 'print'])

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
    '  -p, --print <prompt> Run a minimal non-interactive prompt',
    '',
    'Options:',
    '  -m, --model <id>     Specify the model to use',
    '  --json               Output in JSON format',
    '  -w, --write [path]   Write code blocks from response to file(s)',
    '  --plan               Plan mode: suggest changes without executing writes',
    '  --yolo               YOLO mode: auto-approve all operations',
    '  --reasoning          Show model thinking/reasoning process',
    '',
    'Examples:',
    `  ${commandName} -p "explain this code" --reasoning`,
    `  ${commandName} -p "write a hello world script" --write hello.js`,
    `  ${commandName} -p "generate config" --write`,
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

async function collectPrintResponse({
  prompt,
  model,
  provider,
  collectReasoning = false,
}) {
  if (!isPrintCapableProvider(provider)) {
    throw new Error(
      `Provider ${provider.id} is not ready for local print mode. Configure ZCODE_PROVIDER=openai-compatible and the ZCODE_OPENAI_* variables first.`,
    )
  }

  const resolvedModel = model || getDefaultModel(provider)
  let responseModel = resolvedModel
  let messageId = null
  let finishReason = null
  let text = ''
  let reasoning = ''
  let usage = null
  const toolCalls = []

  for await (const chunk of provider.streamChat({
    model: resolvedModel || undefined,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })) {
    if (!chunk || typeof chunk !== 'object') {
      continue
    }

    if (chunk.type === 'response_start') {
      responseModel = readString(chunk.model) || responseModel
      messageId = readString(chunk.messageId) || messageId
      continue
    }

    if (chunk.type === 'reasoning_delta' && collectReasoning && typeof chunk.text === 'string') {
      reasoning += chunk.text
      continue
    }

    if (chunk.type === 'text_delta' && typeof chunk.text === 'string') {
      text += chunk.text
      continue
    }

    if (chunk.type === 'tool_call' && chunk.toolCall) {
      toolCalls.push(chunk.toolCall)
      continue
    }

    if (chunk.type === 'response_end') {
      finishReason = readString(chunk.finishReason) || finishReason || 'stop'
      if (chunk.usage && typeof chunk.usage === 'object') {
        usage = {
          inputTokens: chunk.usage.input_tokens || chunk.usage.inputTokens || 0,
          outputTokens: chunk.usage.output_tokens || chunk.usage.outputTokens || 0,
          totalTokens:
            (chunk.usage.input_tokens || chunk.usage.inputTokens || 0) +
            (chunk.usage.output_tokens || chunk.usage.outputTokens || 0),
        }
      }
      continue
    }
  }

  return {
    messageId,
    provider: provider.id,
    model: responseModel,
    text,
    toolCalls,
    finishReason: finishReason || 'stop',
    reasoning: reasoning || undefined,
    usage: usage || undefined,
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

function renderPrintResult(result, { json, write, writePath, showReasoning, cwd }) {
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

  // Main text
  if (result.text) {
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

  // Usage footer
  if (result.usage) {
    lines.push('')
    lines.push(renderSep(`${formatTokens(result.usage.inputTokens)} in / ${formatTokens(result.usage.outputTokens)} out`))
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
    version = '0.0.0',
    createProviderFromEnv = defaultCreateProviderFromEnv,
    createModelRegistryFromEnv = defaultCreateModelRegistryFromEnv,
  } = {},
) {
  try {
    loadDotEnvFile({ cwd, env })
    const options = parseArgv(argv)

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
      if (options.plan) {
        writeLine(stdout, `── PLAN MODE ──`)
        writeLine(stdout, `Prompt: ${options.printPrompt}`)
        writeLine(stdout, `Model:  ${options.model || 'auto'}`)
        writeLine(stdout, '')
        writeLine(stdout, 'In plan mode, suggestions would be shown without executing changes.')
        writeLine(stdout, 'Remove --plan to execute.')
        return 0
      }

      const result = await collectPrintResponse({
        prompt: options.printPrompt,
        model: options.model,
        provider: createProviderFromEnv(env),
        collectReasoning: options.reasoning,
      })

      if (options.json) {
        // JSON mode: include all metadata
        const blocks = result.text ? extractCodeBlocks(result.text) : []
        const output = {
          ...result,
          codeBlocks: blocks.length > 0 ? blocks.map(b => ({
            language: b.language,
            lines: b.code.split('\n').length,
          })) : undefined,
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
        // Text mode: structured output
        writeLine(stdout, renderPrintResult(result, {
          json: false,
          write: options.write,
          writePath: options.writePath,
          showReasoning: options.reasoning,
          cwd,
        }))
      }

      return 0
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
