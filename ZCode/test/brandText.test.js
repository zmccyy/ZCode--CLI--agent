import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'config',
  'brandText.js',
)

test('brand text helpers derive default ZCode copy', async () => {
  const mod = await loadModule(`${modulePath}?brand-text-default=${Date.now()}`)

  assert.equal(mod.getCommandName(), 'zcode')
  assert.equal(
    mod.getCliDescription(),
    'ZCode CLI Agent - starts an interactive session by default, use -p/--print for non-interactive output',
  )
  assert.equal(mod.getVersionBanner('1.2.3'), '1.2.3 (ZCode)')
  assert.equal(mod.getLaunchCommandTip(), 'Tip: You can launch ZCode with just `zcode`')
  assert.equal(mod.getCliIdentityLine(), 'You are ZCode, a CLI coding agent.')
  assert.equal(
    mod.getAgentIdentityLine(),
    "You are an agent for ZCode. Given the user's message, you should use the tools available to complete the task.",
  )
  assert.equal(
    mod.getAttributionMarkdown('https://example.com/zcode'),
    '🤖 Generated with [ZCode](https://example.com/zcode)',
  )
})

test('brand text helpers honor env-driven brand overrides', async () => {
  process.env.ZCODE_PRODUCT_NAME = 'ZSharp'
  process.env.ZCODE_WELCOME_TITLE = 'ZSharp Terminal Agent'
  process.env.ZCODE_COMMAND_NAMESPACE = 'zs'

  try {
    const mod = await loadModule(
      `${modulePath}?brand-text-override=${Date.now()}`,
    )

    assert.equal(mod.getCommandName(), 'zs')
    assert.equal(
      mod.getCliDescription(),
      'ZSharp Terminal Agent - starts an interactive session by default, use -p/--print for non-interactive output',
    )
    assert.equal(mod.getVersionBanner('9.9.9'), '9.9.9 (ZSharp)')
    assert.equal(mod.getLaunchCommandTip(), 'Tip: You can launch ZSharp with just `zs`')
    assert.equal(mod.getCliIdentityLine(), 'You are ZSharp, a CLI coding agent.')
    assert.equal(
      mod.getAttributionMarkdown('https://zsharp.dev'),
      '🤖 Generated with [ZSharp](https://zsharp.dev)',
    )
  } finally {
    delete process.env.ZCODE_PRODUCT_NAME
    delete process.env.ZCODE_WELCOME_TITLE
    delete process.env.ZCODE_COMMAND_NAMESPACE
  }
})
