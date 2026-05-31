/**
 * Auto-fix script for REPL startup chain.
 * Creates stub files and exports for missing modules iteratively.
 * Usage: node --import tsx/esm --import ./src/polyfills/autoFix.js src/entrypoints/cli.tsx --help
 */

import { spawn } from 'node:child_process'
import { mkdirSync, appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const NODE_MODULES = resolve(ROOT, 'node_modules')

const MAX_ITERATIONS = 200
const COMMAND = 'node'
const ARGS = [
  '--import', 'tsx/esm',
  '--import', './src/polyfills/register.js',
  'src/entrypoints/cli.tsx',
  '--help',
]

function run() {
  return new Promise((resolve, reject) => {
    const proc = spawn(COMMAND, ARGS, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr: stderr + '\n' + stdout })
    })
    proc.on('error', reject)
  })
}

function createFileStub(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '// Auto-generated stub\nexport {}\n')
}

function createPackageStub(pkgName) {
  const pkgDir = resolve(NODE_MODULES, pkgName)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({
    name: pkgName,
    version: '0.0.0-stub',
    type: 'module',
    main: './index.js',
  }) + '\n')
  writeFileSync(resolve(pkgDir, 'index.js'), '// Auto-generated stub\nexport {}\n')
}

function addExportToFile(filePath, exportName) {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, '// Auto-generated stub\n')
  }
  // Determine type based on naming convention
  if (/^[A-Z_]+$/.test(exportName)) {
    // UPPER_CASE constant
    appendFileSync(filePath, `export const ${exportName} = '${exportName}'\n`)
  } else if (/^is[A-Z]/.test(exportName)) {
    // Boolean function
    appendFileSync(filePath, `export function ${exportName}() { return false }\n`)
  } else if (/^get[A-Z]/.test(exportName)) {
    // Getter function
    appendFileSync(filePath, `export function ${exportName}() { return null }\n`)
  } else if (exportName.includes('Tool') && /^[A-Z]/.test(exportName)) {
    // Tool class
    appendFileSync(filePath, `export class ${exportName} {\n  static searchHint = ''\n  static inputSchema = { type: 'object', properties: {} }\n  static isEnabled() { return false }\n  static isConcurrencySafe() { return true }\n  static isReadOnly() { return true }\n  static isOpenWorld() { return false }\n  static async call() { return { content: [], isError: true } }\n  static async description() { return 'Stub' }\n}\n`)
  } else if (exportName === 'default') {
    appendFileSync(filePath, `const __default = {}\nexport default __default\n`)
  } else {
    // Generic: null-returning function
    appendFileSync(filePath, `export function ${exportName}() { return null }\n`)
  }
}

async function main() {
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const { stderr } = await run()

    // Check for success (no ERR_ prefix and no SyntaxError)
    if (!stderr.includes('ERR_MODULE_NOT_FOUND') &&
        !stderr.includes('does not provide an export named') &&
        !stderr.includes('ERR_UNKNOWN_FILE_EXTENSION') &&
        !stderr.includes('ENOENT')) {
      if (stderr.trim()) {
        console.log(`=== ITERATION ${i}: NEW ERROR ===`)
        console.log(stderr.slice(0, 800))
      } else {
        console.log(`=== ITERATION ${i}: SUCCESS (no output) ===`)
      }
      break
    }

    // Parse ENOENT
    const enoentMatch = stderr.match(/ENOENT.*?open '([^']+)'/)
    if (enoentMatch) {
      const filePath = enoentMatch[1]
      console.log(`[${i}] ENOENT: ${filePath}`)
      writeFileSync(filePath, '')
      continue
    }

    // Parse missing export
    const exportMatch = stderr.match(/does not provide an export named '(\w+)'/)
    const importedFromMatch = stderr.match(/imported from (.+?)(?:\n|$)/)
    if (exportMatch && importedFromMatch) {
      const exportName = exportMatch[1]
      let filePath = importedFromMatch[1].trim()
      // Handle relative paths
      if (filePath.startsWith('file:///')) {
        filePath = decodeURIComponent(filePath.slice(8))
        // On Windows, need to decode further
      }
      console.log(`[${i}] Missing export '${exportName}' from ${filePath}`)
      addExportToFile(filePath, exportName)
      continue
    }

    // Parse missing module (E: path)
    const modMatch = stderr.match(/Cannot find module '([^']+)'/)
    if (modMatch) {
      const modulePath = modMatch[1]
      console.log(`[${i}] Missing module: ${modulePath}`)
      if (/^[A-Z]:/.test(modulePath)) {
        createFileStub(modulePath)
      } else {
        createPackageStub(modulePath)
      }
      continue
    }

    // Parse missing package
    const pkgMatch = stderr.match(/Cannot find package '([^']+)'/)
    if (pkgMatch) {
      const pkgName = pkgMatch[1]
      console.log(`[${i}] Missing package: ${pkgName}`)
      createPackageStub(pkgName)
      continue
    }

    console.log(`=== ITERATION ${i}: UNKNOWN ERROR ===`)
    console.log(stderr.slice(0, 800))
    break
  }
}

main().catch(console.error)
