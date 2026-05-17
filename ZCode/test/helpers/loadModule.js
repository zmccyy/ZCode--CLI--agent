import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function dirnameFromMetaUrl(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl))
}

export function resolveFromHere(metaUrl, ...segments) {
  return path.resolve(dirnameFromMetaUrl(metaUrl), ...segments)
}

export async function loadModule(absolutePath) {
  const queryIndex = absolutePath.indexOf('?')
  const hasQuery = queryIndex !== -1
  const basePath = hasQuery ? absolutePath.slice(0, queryIndex) : absolutePath
  const query = hasQuery ? absolutePath.slice(queryIndex) : ''

  return import(`${pathToFileURL(basePath).href}${query}`)
}
