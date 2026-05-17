import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as moduleHelpers from './loadModule.js'

test('dirnameFromMetaUrl returns the current file directory', () => {
  const expected = path.dirname(fileURLToPath(import.meta.url))

  assert.equal(moduleHelpers.dirnameFromMetaUrl(import.meta.url), expected)
})

test('resolveFromHere resolves segments relative to the current file', () => {
  const expected = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'productConstants.test.js',
  )

  assert.equal(
    moduleHelpers.resolveFromHere(
      import.meta.url,
      '..',
      'productConstants.test.js',
    ),
    expected,
  )
})
