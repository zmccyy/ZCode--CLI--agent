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
import { existsSync, readFileSync } from 'node:fs'
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
    `  bun run start [command] [options]`,
    `  ${commandName} [command] [options]`,
    '',
    'Commands:',
    '  help                 Show this help message',
    '  doctor               Inspect the local runtime and provider wiring',
    '  models               List the models exposed by the active provider',
    '  -p, --print <prompt> Run a minimal non-interactive prompt',
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
    }
  }

  return {
    messageId,
    provider: provider.id,
    model: responseModel,
    text,
    toolCalls,
    finishReason: finishReason || 'stop',
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
      const result = await collectPrintResponse({
        prompt: options.printPrompt,
        model: options.model,
        provider: createProviderFromEnv(env),
      })

      if (options.json) {
        writeJson(stdout, result)
      } else {
        writeLine(stdout, result.text || JSON.stringify(result.toolCalls, null, 2))
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
