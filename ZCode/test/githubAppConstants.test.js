import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'constants',
  'github-app.ts',
)

test('github app constants default to ZCode branding', async () => {
  const mod = await loadModule(`${modulePath}?github-app-default=${Date.now()}`)

  assert.equal(mod.PR_TITLE, 'Add ZCode GitHub Workflow')
  assert.match(mod.WORKFLOW_CONTENT, /name: ZCode/)
  assert.match(mod.WORKFLOW_CONTENT, /Run ZCode/)
  assert.match(mod.WORKFLOW_CONTENT, /zcode/)
  assert.doesNotMatch(mod.WORKFLOW_CONTENT, /@claude/)
  assert.match(mod.PR_BODY, /Installing ZCode GitHub App/)
  assert.match(mod.PR_BODY, /\[ZCode\]\(https:\/\/example\.com\/zcode\)/)
  assert.match(mod.PR_BODY, /mentioning @zcode/)
  assert.match(mod.CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT, /name: ZCode Review/)
  assert.match(
    mod.CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT,
    /uses: anthropics\/claude-code-action@v1/,
  )
})

test('github app constants honor brand overrides', async () => {
  process.env.ZCODE_PRODUCT_NAME = 'ZSharp'
  process.env.ZCODE_COMMAND_NAMESPACE = 'zs'
  process.env.ZCODE_PRODUCT_URL = 'https://zsharp.dev'

  try {
    const mod = await loadModule(
      `${modulePath}?github-app-override=${Date.now()}`,
    )

    assert.equal(mod.PR_TITLE, 'Add ZSharp GitHub Workflow')
    assert.match(mod.WORKFLOW_CONTENT, /name: ZSharp/)
    assert.match(mod.WORKFLOW_CONTENT, /Run ZSharp/)
    assert.match(mod.WORKFLOW_CONTENT, /@zs/)
    assert.match(mod.PR_BODY, /Installing ZSharp GitHub App/)
    assert.match(mod.PR_BODY, /\[ZSharp\]\(https:\/\/zsharp\.dev\)/)
    assert.match(mod.PR_BODY, /mentioning @zs/)
    assert.match(
      mod.CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT,
      /name: ZSharp Review/,
    )
  } finally {
    delete process.env.ZCODE_PRODUCT_NAME
    delete process.env.ZCODE_COMMAND_NAMESPACE
    delete process.env.ZCODE_PRODUCT_URL
  }
})
