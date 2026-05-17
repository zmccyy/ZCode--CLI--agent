import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'config',
  'brandConfig.js',
)

test('getBrandConfig returns ZCode defaults', async () => {
  const { getBrandConfig } = await loadModule(modulePath)
  const config = getBrandConfig()

  assert.equal(config.productName, 'ZCode')
  assert.equal(config.commandNamespace, 'zcode')
  assert.match(config.documentationUrl, /^https?:\/\//)
})

test('getBrandConfig applies env overrides', async () => {
  process.env.ZCODE_PRODUCT_NAME = 'ZCode Dev'
  process.env.ZCODE_COMMAND_NAMESPACE = 'zc'

  try {
    const { getBrandConfig } = await loadModule(
      `${modulePath}?brand-override=${Date.now()}`,
    )
    const config = getBrandConfig()

    assert.equal(config.productName, 'ZCode Dev')
    assert.equal(config.commandNamespace, 'zc')
  } finally {
    delete process.env.ZCODE_PRODUCT_NAME
    delete process.env.ZCODE_COMMAND_NAMESPACE
  }
})
