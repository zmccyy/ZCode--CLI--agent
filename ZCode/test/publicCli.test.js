import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const repoDir = resolveFromHere(import.meta.url, '..')
const packageJsonPath = resolveFromHere(import.meta.url, '..', 'package.json')
const readmePath = resolveFromHere(import.meta.url, '..', 'README.md')
const publicCliCorePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'cli',
  'publicCliCore.js',
)

function getBunCommand() {
  return process.platform === 'win32' ? 'bun.cmd' : 'bun'
}

function runBun(args, options = {}) {
  if (process.platform === 'win32') {
    const commandLine = ['bun', ...args].join(' ')
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      encoding: 'utf8',
      ...options,
    })
  }

  return spawnSync(getBunCommand(), args, {
    encoding: 'utf8',
    ...options,
  })
}

function createMemoryWriter() {
  let buffer = ''

  return {
    write(chunk) {
      buffer += String(chunk)
    },
    read() {
      return buffer
    },
  }
}

function createMockProvider() {
  return {
    id: 'openai-compatible:deepseek',
    kind: 'openai-compatible',
    provider: 'deepseek',
    listModels() {
      return [
        {
          id: 'deepseek-chat',
          displayName: 'deepseek-chat',
          provider: 'deepseek',
          capabilities: {
            streaming: true,
            toolCalling: true,
            supportsJsonSchema: true,
          },
        },
      ]
    },
    async *streamChat(input = {}) {
      yield {
        type: 'response_start',
        messageId: 'msg_test_1',
        model: input.model || 'deepseek-chat',
      }
      yield {
        type: 'text_delta',
        text: 'hello from provider',
      }
      yield {
        type: 'response_end',
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
      }
    },
  }
}

function createTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('renderHelp describes the minimal local-startable CLI surface', async () => {
  const { renderHelp } = await loadModule(
    `${publicCliCorePath}?help=${Date.now()}`,
  )

  const help = renderHelp({ version: '0.1.0' })

  assert.match(help, /ZCode CLI Agent/)
  assert.match(help, /doctor/)
  assert.match(help, /models/)
  assert.match(help, /-p, --print <prompt>/)
  assert.match(help, /public build/i)
})

test('createDoctorReport reports a startable default Anthropic-backed local CLI', async () => {
  const { createDoctorReport } = await loadModule(
    `${publicCliCorePath}?doctor=${Date.now()}`,
  )

  const report = createDoctorReport({
    cwd: 'D:\\workspace\\zcode',
    env: {},
    version: '0.1.0',
    runtime: {
      engine: 'bun',
      node: 'v22.16.0',
      bun: '1.3.14',
    },
  })

  assert.equal(report.startable, true)
  assert.equal(report.provider.mode, 'firstParty')
  assert.equal(report.provider.id, 'anthropic:firstParty')
  assert.equal(report.provider.printReady, false)
  assert.equal(Array.isArray(report.commands), true)
  assert.equal(report.commands.includes('doctor'), true)
})

test('runCli can execute a minimal print flow with an injected provider', async () => {
  const { runCli } = await loadModule(`${publicCliCorePath}?print=${Date.now()}`)

  const stdout = createMemoryWriter()
  const stderr = createMemoryWriter()
  const mockProvider = createMockProvider()

  const exitCode = await runCli(['-p', 'say hello', '--json'], {
    cwd: repoDir,
    env: {
      ZCODE_PROVIDER: 'openai-compatible',
    },
    stderr,
    stdout,
    version: '0.1.0',
    createProviderFromEnv: () => mockProvider,
    createModelRegistryFromEnv: () => ({
      list: () => mockProvider.listModels(),
    }),
  })

  assert.equal(exitCode, 0)
  assert.equal(stderr.read(), '')

  const payload = JSON.parse(stdout.read())
  assert.equal(payload.provider, 'openai-compatible:deepseek')
  assert.equal(payload.model, 'deepseek-chat')
  assert.equal(payload.text, 'hello from provider')
  assert.equal(payload.finishReason, 'stop')
})

test('loadDotEnvFile reads local .env values without overriding existing env keys', async () => {
  const { loadDotEnvFile } = await loadModule(`${publicCliCorePath}?dotenv=${Date.now()}`)
  const tempDir = createTempDir('zcode-dotenv-')
  const envPath = path.join(tempDir, '.env')

  try {
    writeFileSync(
      envPath,
      [
        '# local test file',
        'ZCODE_PROVIDER=openai-compatible',
        'ZCODE_OPENAI_PROVIDER=deepseek',
        'ZCODE_OPENAI_MODEL="deepseek-chat"',
        'ZCODE_OPENAI_API_KEY=from-dotenv',
      ].join('\n'),
      'utf8',
    )

    const env = {
      ZCODE_OPENAI_API_KEY: 'from-process',
    }

    const result = loadDotEnvFile({
      cwd: tempDir,
      env,
    })

    assert.equal(result.loaded, true)
    assert.equal(result.path, envPath)
    assert.equal(env.ZCODE_PROVIDER, 'openai-compatible')
    assert.equal(env.ZCODE_OPENAI_PROVIDER, 'deepseek')
    assert.equal(env.ZCODE_OPENAI_MODEL, 'deepseek-chat')
    assert.equal(env.ZCODE_OPENAI_API_KEY, 'from-process')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('runCli can execute --print --json through the real openai-compatible provider stack', async () => {
  const { runCli } = await loadModule(
    `${publicCliCorePath}?real-print=${Date.now()}`,
  )
  const tempDir = createTempDir('zcode-print-')
  let server

  try {
    server = http.createServer(async (req, res) => {
      assert.equal(req.method, 'POST')
      assert.equal(req.url, '/v1/chat/completions')
      assert.equal(req.headers.authorization, 'Bearer test-key')

      let body = ''
      for await (const chunk of req) {
        body += String(chunk)
      }

      const parsed = JSON.parse(body)
      assert.equal(parsed.model, 'deepseek-chat')
      assert.deepEqual(parsed.messages, [
        {
          role: 'user',
          content: 'hello from cli',
        },
      ])

      res.writeHead(200, {
        'content-type': 'text/event-stream',
      })
      res.end(
        [
          'data: {"id":"chatcmpl_cli_1","model":"deepseek-chat","choices":[{"delta":{"content":"hello "}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      )
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : null
    assert.equal(typeof port, 'number')

    writeFileSync(
      path.join(tempDir, '.env'),
      [
        'ZCODE_PROVIDER=openai-compatible',
        'ZCODE_OPENAI_PROVIDER=deepseek',
        'ZCODE_OPENAI_MODEL=deepseek-chat',
        `ZCODE_OPENAI_BASE_URL=http://127.0.0.1:${port}/v1`,
        'ZCODE_OPENAI_API_KEY=test-key',
      ].join('\n'),
      'utf8',
    )

    const stdout = createMemoryWriter()
    const stderr = createMemoryWriter()
    const env = {}

    const exitCode = await runCli(['-p', 'hello from cli', '--json'], {
      cwd: tempDir,
      env,
      stdout,
      stderr,
      version: '0.1.0',
    })

    assert.equal(exitCode, 0, stderr.read())
    assert.equal(stderr.read(), '')

    const payload = JSON.parse(stdout.read())
    assert.equal(payload.provider, 'openai-compatible:deepseek')
    assert.equal(payload.model, 'deepseek-chat')
    assert.equal(payload.text, 'hello world')
    assert.equal(payload.finishReason, 'stop')
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve))
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('package scripts expose a public start command for Bun', () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  assert.equal(typeof packageJson.scripts?.start, 'string')
  assert.equal(typeof packageJson.scripts?.dev, 'string')
  assert.equal(typeof packageJson.scripts?.doctor, 'string')
  assert.equal(typeof packageJson.scripts?.models, 'string')
})

test('bun run start --help launches the public CLI entrypoint', () => {
  const result = runBun(['run', 'start', '--help'], {
    cwd: repoDir,
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ZCode CLI Agent/)
  assert.match(result.stdout, /doctor/)
})

test('README documents local startup, .env usage, and print mode', () => {
  const readme = readFileSync(readmePath, 'utf8')

  assert.match(readme, /bun run start --help/)
  assert.match(readme, /ZCODE_PROVIDER=openai-compatible/)
  assert.match(readme, /zcode -p ".*" --json|bun run start -p ".*" --json/)
  assert.match(readme, /\.env/)
})
