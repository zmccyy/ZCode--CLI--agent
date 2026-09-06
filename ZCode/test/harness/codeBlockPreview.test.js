import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runCli } from '../../src/cli/publicCliCore.js'
import { createFakeLlmServer } from '../helpers/fakeLlmServer.js'

function createCollector() {
  const chunks = []
  return {
    stream: {
      write(chunk) {
        chunks.push(String(chunk))
      },
    },
    text: () => chunks.join(''),
  }
}

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

// Regression: the code-block PREVIEW branch (response contains fences, no
// --write flag) used inferFilename without importing it after the helpers
// moved to codeBlocks.js — real-model acceptance surfaced
// "inferFilename is not defined" on stdout.
test('print mode: code-block preview renders filenames without import errors', async () => {
  const server = createFakeLlmServer({
    dialect: 'openai',
    apiKey: 'test',
    script: [
      {
        text: 'Here is an example:\n\n```js\nconsole.log("hi")\n```\n',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ],
  })
  await server.listen()
  const workspace = await createTempDir('zcode-preview-')

  try {
    const out = createCollector()
    const err = createCollector()
    const exitCode = await runCli(['-p', 'give an example', '--yolo'], {
      cwd: workspace,
      env: {},
      stdout: out.stream,
      stderr: err.stream,
      stdin: null,
      version: 'test',
      createProviderFromEnv: () => ({
        id: 'fake:openai-compatible',
        kind: 'openai-compatible',
        isPrintCapable: true,
        listModels: () => [{ id: 'fake-model' }],
        streamChat: async function* () {
          yield { type: 'response_start', messageId: 'm1', model: 'fake-model', provider: 'fake' }
          yield { type: 'text_delta', text: '```js\nconsole.log("hi")\n```' }
          yield {
            type: 'response_end',
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }
        },
      }),
      createModelRegistryFromEnv: () => ({ list: () => [] }),
    })

    assert.equal(exitCode, 0)
    const output = out.text()
    assert.match(output, /code block/i)
    assert.match(output, /module\.js/, 'js fences preview the inferred filename')
    assert.ok(!output.includes('not defined'), 'no ReferenceError leaks into output')
    assert.ok(!output.includes('is not defined'))
  } finally {
    await server.close()
    await fs.rm(workspace, { recursive: true, force: true })
  }
})
