import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const ARRAY_MERGE_KEYS = new Set(['hooks'])

export const SETTINGS_SOURCE_PRIORITY = Object.freeze([
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
])

export const DEFAULT_SETTINGS_DIR = '.zcode'

export const SETTINGS_FILE_NAMES = Object.freeze({
  userSettings: 'settings.json',
  projectSettings: 'settings.json',
  localSettings: 'settings.local.json',
  policySettings: 'managed-settings.json',
})

export function getSettingsSourcePriority(source) {
  return SETTINGS_SOURCE_PRIORITY.indexOf(source)
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function readString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return undefined
  }

  const normalized = [...new Set(values.map(readString).filter(Boolean))]
  return normalized.length > 0 ? normalized : undefined
}

function normalizeStringRecord(record) {
  if (!isPlainObject(record)) {
    return undefined
  }

  const normalized = Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [readString(key), readString(value)])
      .filter(([key, value]) => key && value),
  )

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeOpenAICompatibleSettings(settings) {
  if (!isPlainObject(settings)) {
    return undefined
  }

  const provider = readString(settings.provider)
  const model = readString(settings.model)
  const baseUrl = readString(settings.baseUrl)?.replace(/\/+$/, '')
  const apiKey = readString(settings.apiKey)
  const headers = normalizeStringRecord(settings.headers)
  const timeout = Number.isFinite(settings.timeout) ? settings.timeout : undefined

  const normalized = {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
    ...(timeout ? { timeout } : {}),
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizePermissions(permissions) {
  if (!isPlainObject(permissions)) {
    return undefined
  }

  const normalized = {}
  const ruleKeys = ['allow', 'deny', 'ask']

  for (const key of ruleKeys) {
    const rules = normalizeStringArray(permissions[key])
    if (rules) {
      normalized[key] = rules
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function mergeArrays(left = [], right = []) {
  return [...new Set([...left, ...right])]
}

function mergeValues(left, right, key) {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (ARRAY_MERGE_KEYS.has(key)) {
      return mergeArrays(left, right)
    }

    return [...right]
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    return mergeObjects(left, right)
  }

  return right
}

function mergeObjects(left = {}, right = {}) {
  const merged = { ...left }

  for (const [key, value] of Object.entries(right)) {
    if (!(key in merged)) {
      merged[key] = value
      continue
    }

    merged[key] = mergeValues(merged[key], value, key)
  }

  return merged
}

export function mergeSettingsLayers(layers = []) {
  return [...layers]
    .sort(
      (left, right) =>
        getSettingsSourcePriority(left.source) -
        getSettingsSourcePriority(right.source),
    )
    .reduce(
      (merged, layer) => mergeObjects(merged, layer?.settings ?? {}),
      {},
    )
}

export function normalizeSettings(settings = {}) {
  if (!isPlainObject(settings)) {
    return {}
  }

  const provider = readString(settings.provider)
  const model = readString(settings.model)
  const openaiCompatible = normalizeOpenAICompatibleSettings(
    settings.openaiCompatible,
  )
  const modelOverrides = normalizeStringRecord(settings.modelOverrides)
  const availableModels = normalizeStringArray(settings.availableModels)
  const permissions = normalizePermissions(settings.permissions)
  const hooks = normalizeStringArray(settings.hooks)
  const env = normalizeStringRecord(settings.env)

  const normalized = {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(openaiCompatible ? { openaiCompatible } : {}),
    ...(modelOverrides ? { modelOverrides } : {}),
    ...(availableModels ? { availableModels } : {}),
    ...(permissions ? { permissions } : {}),
    ...(hooks ? { hooks } : {}),
    ...(env ? { env } : {}),
  }

  return normalized
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function getSettingsHomePath(homeDir) {
  const base = typeof homeDir === 'string' && homeDir.trim() !== ''
    ? homeDir.trim()
    : homedir()

  return `${base.replace(/\/+$/, '')}/${DEFAULT_SETTINGS_DIR}`
}

export function getSettingsProjectPath(cwd) {
  const base = typeof cwd === 'string' && cwd.trim() !== ''
    ? cwd.trim()
    : process.cwd()

  return `${base.replace(/\/+$/, '')}/${DEFAULT_SETTINGS_DIR}`
}

export function getSettingsFilePath(source, opts = {}) {
  const fileName = SETTINGS_FILE_NAMES[source]
  if (!fileName) {
    return null
  }

  if (source === 'userSettings') {
    const homePath = getSettingsHomePath(opts.home)
    return `${homePath}/${fileName}`
  }

  const projectPath = getSettingsProjectPath(opts.cwd)
  return `${projectPath}/${fileName}`
}

export function readSettingsFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return { settings: null, errors: [{ message: 'filePath is required' }] }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)

    if (!isPlainObject(parsed)) {
      return {
        settings: null,
        errors: [{ message: 'settings file must contain a JSON object', filePath }],
      }
    }

    return { settings: parsed, errors: [] }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { settings: null, errors: [] }
    }

    return {
      settings: null,
      errors: [{ message: err.message, filePath }],
    }
  }
}

export function writeSettingsFile(filePath, settings) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('filePath is required')
  }

  if (!isPlainObject(settings)) {
    throw new Error('settings must be a plain object')
  }

  const dir = filePath.slice(0, filePath.lastIndexOf('/'))

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

export function loadSettingsLayer(source, opts = {}) {
  const filePath = getSettingsFilePath(source, opts)

  if (!filePath) {
    return { source, settings: {}, errors: [] }
  }

  const { settings, errors } = readSettingsFile(filePath)

  return {
    source,
    settings: settings ?? {},
    errors,
  }
}

/**
 * Reads all 5 settings layers from disk, merges them by priority, and returns
 * normalized settings.
 *
 * flagSettings is passed in directly (it has no filesystem path — it comes
 * from the --settings CLI flag).
 */
export function loadSettingsFromDisk(opts = {}) {
  const errors = []
  const layers = []

  for (const source of SETTINGS_SOURCE_PRIORITY) {
    if (source === 'flagSettings') {
      const flagSettings = opts.flagSettings
      if (flagSettings && isPlainObject(flagSettings)) {
        layers.push({ source: 'flagSettings', settings: flagSettings })
      }
      continue
    }

    const layer = loadSettingsLayer(source, opts)
    layers.push(layer)

    if (layer.errors.length > 0) {
      errors.push(...layer.errors)
    }
  }

  const merged = mergeSettingsLayers(layers)
  const settings = normalizeSettings(merged)

  return { settings, errors }
}

/**
 * Merges updates into an existing settings file for the given source.
 * Throws if the source has no writeable file path (e.g. flagSettings).
 */
export function saveSettingsForSource(source, updates, opts = {}) {
  const filePath = getSettingsFilePath(source, opts)

  if (!filePath) {
    throw new Error(`Cannot write settings for source: ${source}`)
  }

  const { settings: existing, errors } = readSettingsFile(filePath)

  const base = existing ?? {}
  const merged = mergeObjects(base, updates)
  const cleaned = normalizeSettings(merged)

  writeSettingsFile(filePath, cleaned)

  return { settings: cleaned, errors }
}
