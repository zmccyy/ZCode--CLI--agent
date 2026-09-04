import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveFromHere } from './helpers/loadModule.js'
import { serveStatic } from '../www/server.ts'

function createMockRequest(url) {
  return { url }
}

function createMockResponse() {
  return {
    statusCode: 0,
    body: null,
    writeHead(code) {
      this.statusCode = code
    },
    end(body) {
      this.body = body
    },
  }
}

function serve(wwwDir, url) {
  const res = createMockResponse()
  serveStatic(wwwDir, createMockRequest(url), res)
  return res
}

function createWwwFixture() {
  const wwwDir = mkdtempSync(path.join(tmpdir(), 'zcode-www-'))
  writeFileSync(path.join(wwwDir, 'index.html'), '<h1>home</h1>', 'utf8')
  mkdirSync(path.join(wwwDir, 'assets'), { recursive: true })
  writeFileSync(path.join(wwwDir, 'assets', 'app.js'), 'console.log(1)', 'utf8')
  return wwwDir
}

test('serveStatic serves files inside the www directory', () => {
  const wwwDir = createWwwFixture()

  try {
    const home = serve(wwwDir, '/')
    assert.equal(home.statusCode, 200)
    assert.ok(String(home.body).includes('<h1>home</h1>'))

    const asset = serve(wwwDir, '/assets/app.js?cache=1')
    assert.equal(asset.statusCode, 200)
    assert.ok(String(asset.body).includes('console.log(1)'))
  } finally {
    rmSync(wwwDir, { recursive: true, force: true })
  }
})

test('serveStatic rejects ../ traversal out of the www directory', () => {
  const wwwDir = createWwwFixture()
  const outside = mkdtempSync(path.join(tmpdir(), 'zcode-www-out-'))
  writeFileSync(path.join(outside, 'secret.txt'), 'top secret', 'utf8')

  try {
    for (const url of ['/../secret.txt', '/../' + path.basename(outside) + '/secret.txt']) {
      const res = serve(wwwDir, url)
      assert.equal(res.statusCode, 403, url)
    }
  } finally {
    rmSync(wwwDir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('serveStatic rejects percent-encoded traversal', () => {
  const wwwDir = createWwwFixture()
  const outside = mkdtempSync(path.join(tmpdir(), 'zcode-www-enc-'))
  writeFileSync(path.join(outside, 'secret.txt'), 'top secret', 'utf8')
  const encoded = encodeURIComponent('/' + path.basename(outside) + '/secret.txt')

  try {
    const res = serve(wwwDir, '/..' + encoded)
    assert.equal(res.statusCode, 403)
  } finally {
    rmSync(wwwDir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('serveStatic is not fooled by a sibling directory sharing the base prefix', () => {
  const wwwDir = createWwwFixture()
  const sibling = `${wwwDir}-sibling`
  mkdirSync(sibling, { recursive: true })
  writeFileSync(path.join(sibling, 'secret.html'), 'sibling secret', 'utf8')

  try {
    const res = serve(wwwDir, '/../' + path.basename(sibling) + '/secret.html')
    assert.equal(res.statusCode, 403)
  } finally {
    rmSync(wwwDir, { recursive: true, force: true })
    rmSync(sibling, { recursive: true, force: true })
  }
})

test('serveStatic never serves secret content via backslash traversal paths', () => {
  const wwwDir = createWwwFixture()
  const outside = mkdtempSync(path.join(tmpdir(), 'zcode-www-bs-'))
  writeFileSync(path.join(outside, 'secret.txt'), 'top secret', 'utf8')

  try {
    const res = serve(wwwDir, '/..%5C..%5C' + path.basename(outside) + '%5Csecret.txt')
    const leaked = res.statusCode === 200 && String(res.body).includes('top secret')
    assert.equal(leaked, false)
  } finally {
    rmSync(wwwDir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('serveStatic returns 404 for missing files and 400 for malformed encoding', () => {
  const wwwDir = createWwwFixture()

  try {
    const missing = serve(wwwDir, '/no-such-file.html')
    assert.equal(missing.statusCode, 404)

    const malformed = serve(wwwDir, '/%zz-broken')
    assert.equal(malformed.statusCode, 400)
  } finally {
    rmSync(wwwDir, { recursive: true, force: true })
  }
})
