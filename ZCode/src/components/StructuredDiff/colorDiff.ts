import { createRequire } from 'node:module'
import type { SyntaxTheme } from '../../native-ts/color-diff/index.js'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

const requireFromHere = createRequire(import.meta.url)

type ColorDiffModule = typeof import('../../native-ts/color-diff/index.js')

let cachedColorDiffModule: ColorDiffModule | null | undefined

export type ColorModuleUnavailableReason = 'env'

function loadColorDiffModule(): ColorDiffModule | null {
  if (cachedColorDiffModule !== undefined) {
    return cachedColorDiffModule
  }

  try {
    cachedColorDiffModule = requireFromHere('color-diff-napi') as ColorDiffModule
    return cachedColorDiffModule
  } catch {
    try {
      cachedColorDiffModule = requireFromHere(
        '../../native-ts/color-diff/index.js',
      ) as ColorDiffModule
      return cachedColorDiffModule
    } catch {
      cachedColorDiffModule = null
      return null
    }
  }
}

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

export function expectColorDiff(): ColorDiffModule['ColorDiff'] | null {
  return getColorModuleUnavailableReason() === null
    ? (loadColorDiffModule()?.ColorDiff ?? null)
    : null
}

export function expectColorFile(): ColorDiffModule['ColorFile'] | null {
  return getColorModuleUnavailableReason() === null
    ? (loadColorDiffModule()?.ColorFile ?? null)
    : null
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModuleUnavailableReason() === null
    ? (loadColorDiffModule()?.getSyntaxTheme(themeName) ?? null)
    : null
}
