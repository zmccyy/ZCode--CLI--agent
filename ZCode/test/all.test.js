import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirnameFromMetaUrl } from './helpers/loadModule.js'

const testDir = dirnameFromMetaUrl(import.meta.url)
const thisFile = path.resolve(testDir, 'all.test.js')

async function importTests(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      await importTests(fullPath)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (!entry.name.endsWith('.test.js')) {
      continue
    }

    if (path.resolve(fullPath) === thisFile) {
      continue
    }

    await import(pathToFileURL(fullPath).href)
  }
}

await importTests(testDir)
