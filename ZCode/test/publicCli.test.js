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

function runNode(args, options = {}) {
  return spawnSync('node', args, {
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
  // The harness agent loop speaks the Anthropic dialect, so print mode is ready.
  assert.equal(report.provider.printReady, true)
  assert.equal(Array.isArray(report.commands), true)
  assert.equal(report.commands.includes('doctor'), true)
})

test('runCli can execute a minimal print flow with an injected provider', async () => {
  const { runCli } = await loadModule(`${publicCliCorePath}?print=${Date.now()}`)

  const stdout = createMemoryWriter()
  const stderr = createMemoryWriter()
  const mockProvider = createMockProvider()
  const transcriptDir = createTempDir('zcode-print-transcript-')

  const exitCode = await runCli(['-p', 'say hello', '--json'], {
    cwd: repoDir,
    env: {
      ZCODE_PROVIDER: 'openai-compatible',
      ZCODE_TRANSCRIPT_DIR: transcriptDir,
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
  // The harness envelope extends the legacy fields.
  assert.equal(payload.stopReason, 'end_turn')
  assert.equal(payload.runMode, 'agent')
  assert.deepEqual(payload.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14 })
  assert.equal(payload.toolCalls.length, 0)

  rmSync(transcriptDir, { recursive: true, force: true })
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
      ZCODE_OPENAI_API_KEY: 'test',
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
    assert.equal(env.ZCODE_OPENAI_API_KEY, 'test')
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
      assert.equal(req.headers.authorization, 'Bearer test')

      let body = ''
      for await (const chunk of req) {
        body += String(chunk)
      }

      const parsed = JSON.parse(body)
      assert.equal(parsed.model, 'deepseek-chat')
      // The harness print flow sends the agent system prompt + user prompt
      // plus the core tool definitions.
      assert.equal(parsed.messages.length, 2)
      assert.equal(parsed.messages[0].role, 'system')
      assert.match(parsed.messages[0].content, /coding agent/)
      assert.deepEqual(parsed.messages[1], {
        role: 'user',
        content: 'hello from cli',
      })
      assert.equal(Array.isArray(parsed.tools), true)
      assert.deepEqual(
        parsed.tools.map(tool => tool.function.name),
        ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
      )

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
        'ZCODE_OPENAI_API_KEY=test',
        `ZCODE_TRANSCRIPT_DIR=${path.join(tempDir, 'transcripts')}`,
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

test('npm start -- --help launches the public CLI entrypoint via Node.js', () => {
  const result = runNode(['src/entrypoints/publicCli.js', '--help'], {
    cwd: repoDir,
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /ZCode CLI Agent/)
  assert.match(result.stdout, /doctor/)
})

test('node public CLI doctor --json works on the stable public surface', () => {
  const result = runNode(['src/entrypoints/publicCli.js', 'doctor', '--json'], {
    cwd: repoDir,
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.startable, true)
  assert.equal(payload.provider.id, 'anthropic:firstParty')
  assert.equal(Array.isArray(payload.models), true)
  assert.ok(payload.models.length > 0)
})

test('node public CLI models --json lists provider models without a TS loader', () => {
  const result = runNode(['src/entrypoints/publicCli.js', 'models', '--json'], {
    cwd: repoDir,
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')

  const payload = JSON.parse(result.stdout)
  assert.equal(Array.isArray(payload), true)
  assert.ok(payload.length > 0)
  assert.ok(payload.some(model => model.provider === 'firstParty'))
})

test('public help documents the public CLI surface without leaking internal entrypoints', async () => {
  const { renderHelp } = await loadModule(
    `${publicCliCorePath}?node-scope=${Date.now()}`,
  )

  const help = renderHelp({ version: '0.1.0' })

  assert.match(help, /ZCode CLI Agent/)
  assert.match(help, /Bare `zcode` starts an interactive session/)
  assert.doesNotMatch(help, /cli\.tsx/i)
})






test('README documents local startup, .env usage, and print mode', () => {
  const readme = readFileSync(readmePath, 'utf8')

  assert.match(readme, /bun run start --help/)
  assert.match(readme, /npm start.*--help/)
  assert.match(readme, /ZCODE_PROVIDER=openai-compatible/)
  assert.match(readme, /zcode -p ".*" --json|npm start -- -p ".*" --json/)
  assert.match(readme, /\.env/)
})
