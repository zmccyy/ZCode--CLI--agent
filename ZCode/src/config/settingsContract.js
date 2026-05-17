const ARRAY_REPLACE_KEYS = new Set(['hooks'])

export const SETTINGS_SOURCE_PRIORITY = Object.freeze([
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
])

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

function mergeArrays(left = [], right = []) {
  return [...new Set([...left, ...right])]
}

function mergeValues(left, right, key) {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (ARRAY_REPLACE_KEYS.has(key)) {
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
  const openaiCompatible = normalizeOpenAICompatibleSettings(
    settings.openaiCompatible,
  )
  const modelOverrides = normalizeStringRecord(settings.modelOverrides)
  const availableModels = normalizeStringArray(settings.availableModels)

  return {
    ...(provider ? { provider } : {}),
    ...(openaiCompatible ? { openaiCompatible } : {}),
    ...(modelOverrides ? { modelOverrides } : {}),
    ...(availableModels ? { availableModels } : {}),
  }
}
