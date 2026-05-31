/**
 * Node.js globals polyfill for Bun-specific APIs used by ZCode.
 *
 * Bun provides these as built-in globals or macros. Node.js needs them shimmed.
 * This file is loaded via --import before any application code.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

// ── require polyfill ── Bun supports require() in ESM; Node.js needs createRequire
// Using the project src directory as base so relative requires resolve correctly
const _globalRequire = createRequire(import.meta.url + '/../..')
// eslint-disable-next-line custom-rules/no-top-level-side-effects
if (typeof globalThis.require === 'undefined') {
  globalThis.require = _globalRequire
}

// ── MACRO.VERSION ── Baked at build time by Bun bundler
const requireFromRoot = createRequire(import.meta.url + '/../../..')
try {
  const pkg = requireFromRoot('./package.json')
  globalThis.MACRO = { VERSION: pkg.version || '0.1.0' }
} catch {
  globalThis.MACRO = { VERSION: '0.1.0' }
}

// ── Bun.embeddedFiles ── Used by bundledMode.ts isInBundledMode()
// In Node.js dev mode, there are no embedded files.
if (typeof globalThis.Bun === 'undefined') {
  globalThis.Bun = {
    embeddedFiles: [],
    env: process.env,
    which: (cmd) => {
      // Stub: Bun.which resolves executables
      return null
    },
    write: (path, data) => {
      // Stub: Bun.write for streaming
      return Promise.reject(new Error('Bun.write not available in Node.js'))
    },
    file: (path) => {
      // Stub: Bun.file
      return {
        exists: () => Promise.resolve(false),
        text: () => Promise.reject(new Error('Bun.file not available in Node.js')),
        json: () => Promise.reject(new Error('Bun.file not available in Node.js')),
        stream: () => { throw new Error('Bun.file not available in Node.js') },
      }
    },
    shell: (cmd) => {
      // Stub: Bun.shell
      throw new Error('Bun.shell not available in Node.js — use shellUtils.runShell')
    },
    password: (_opts) => {
      // Stub: Bun.password
      return Promise.reject(new Error('Bun.password not available in Node.js'))
    },
    sha: (_input) => {
      // Stub: Bun.SHA
      throw new Error('Bun.SHA not available in Node.js')
    },
  }
}
