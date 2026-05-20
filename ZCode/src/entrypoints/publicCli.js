import { readFileSync } from 'node:fs'
import { runCli } from '../cli/publicCliCore.js'

function readPackageVersion() {
  try {
    const packageJsonUrl = new URL('../../package.json', import.meta.url)
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8'))
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const exitCode = await runCli(process.argv.slice(2), {
  version: readPackageVersion(),
})

if (exitCode !== 0) {
  process.exitCode = exitCode
}
