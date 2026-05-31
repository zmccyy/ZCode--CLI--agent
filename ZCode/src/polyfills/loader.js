/**
 * Node.js custom loader hook for ZCode REPL compatibility.
 *
 * Handles bun:bundle → polyfill (feature flags always return true in dev).
 * Extension resolution (.js → .ts/.tsx) is delegated to tsx's loader.
 *
 * Usage:
 *   node --import tsx/esm --import ./src/polyfills/register.js <entry>
 */

import { resolve as resolvePath, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const POLYFILL_URL = pathToFileURL(resolvePath(__dirname, 'bun-bundle.js')).href

const TEXT_EXTENSIONS = ['.md', '.txt', '.csv']

/**
 * @param {string} specifier
 * @param {object} context
 * @param {Function} nextResolve
 * @returns {Promise<{url: string, format?: string, shortCircuit?: boolean}>}
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'bun:bundle') {
    return {
      url: POLYFILL_URL,
      format: 'module',
      shortCircuit: true,
    }
  }
  // Handle .md / .txt / .csv imports (Bun supports these natively)
  const parentURL = context.parentURL
  if (parentURL && TEXT_EXTENSIONS.some(ext => specifier.endsWith(ext))) {
    try {
      const resolved = new URL(specifier, parentURL)
      return {
        url: resolved.href,
        format: 'module',
        shortCircuit: true,
      }
    } catch {
      // fall through to nextResolve
    }
  }
  return nextResolve(specifier, context)
}

/**
 * @param {string} url
 * @param {object} context
 * @param {Function} nextLoad
 * @returns {Promise<{source: string, format: string, shortCircuit?: boolean}>}
 */
export async function load(url, context, nextLoad) {
  const filePath = url.startsWith('file://') ? fileURLToPath(url) : url
  if (TEXT_EXTENSIONS.some(ext => filePath.endsWith(ext))) {
    const content = readFileSync(filePath, 'utf-8')
    return {
      source: `export default ${JSON.stringify(content)}`,
      format: 'module',
      shortCircuit: true,
    }
  }

  // Delegate to next loader (tsx) for TS→JS transformation
  const nextResult = await nextLoad(url, context)

  // Inject per-module require polyfill for files that use require()
  if (
    nextResult.format === 'module' &&
    typeof nextResult.source === 'string' &&
    nextResult.source.includes('require(')
  ) {
    const injected = `import{createRequire as __cr__}from'node:module';var require=__cr__(${JSON.stringify(url)});` + nextResult.source
    return {
      source: injected,
      format: 'module',
      shortCircuit: true,
    }
  }

  return nextResult
}
