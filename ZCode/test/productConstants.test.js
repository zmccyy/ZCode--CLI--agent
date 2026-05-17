import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'constants',
  'product.ts',
)

test('product constants default to ZCode brand URLs', async () => {
  const mod = await loadModule(`${modulePath}?product-default=${Date.now()}`)

  assert.equal(mod.PRODUCT_URL, 'https://example.com/zcode')
  assert.equal(mod.CLAUDE_AI_BASE_URL, 'https://example.com/zcode')
  assert.equal(
    mod.CLAUDE_AI_STAGING_BASE_URL,
    'https://staging.example.com/zcode',
  )
  assert.equal(mod.CLAUDE_AI_LOCAL_BASE_URL, 'http://localhost:4000')
})

test('product constants honor brand env overrides', async () => {
  process.env.ZCODE_PRODUCT_URL = 'https://zcode.dev'
  process.env.ZCODE_REMOTE_BASE_URL = 'https://remote.zcode.dev'

  try {
    const mod = await loadModule(`${modulePath}?product-env=${Date.now()}`)

    assert.equal(mod.PRODUCT_URL, 'https://zcode.dev')
    assert.equal(mod.CLAUDE_AI_BASE_URL, 'https://remote.zcode.dev')
  } finally {
    delete process.env.ZCODE_PRODUCT_URL
    delete process.env.ZCODE_REMOTE_BASE_URL
  }
})

test('getRemoteSessionUrl works in ESM mode for cse session IDs', async () => {
  const mod = await loadModule(`${modulePath}?product-remote-url=${Date.now()}`)

  assert.equal(
    mod.getRemoteSessionUrl('cse_123'),
    'https://example.com/zcode/code/session_123',
  )
})
