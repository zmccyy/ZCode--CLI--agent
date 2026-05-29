import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { sep, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadModule, resolveFromHere } from './helpers/loadModule.js'

const modulePath = resolveFromHere(
  import.meta.url,
  '..',
  'src',
  'config',
  'settingsContract.js',
)

function makeTempDir() {
  const dir = join(tmpdir(), `zcode-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Source order
// ---------------------------------------------------------------------------

test('SETTINGS_SOURCE_PRIORITY reflects documented override order', async () => {
  const { SETTINGS_SOURCE_PRIORITY, getSettingsSourcePriority } =
    await loadModule(modulePath)

  assert.deepEqual(SETTINGS_SOURCE_PRIORITY, [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ])
  assert.equal(getSettingsSourcePriority('userSettings'), 0)
  assert.equal(getSettingsSourcePriority('policySettings'), 4)
})

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

test('mergeSettingsLayers applies later sources on top of earlier sources', async () => {
  const { mergeSettingsLayers } = await loadModule(modulePath)

  const merged = mergeSettingsLayers([
    {
      source: 'projectSettings',
      settings: {
        model: 'claude-sonnet-4',
        env: { FOO: 'project' },
        hooks: ['project'],
      },
    },
    {
      source: 'userSettings',
      settings: {
        env: { BAR: 'user' },
        hooks: ['user'],
      },
    },
    {
      source: 'policySettings',
      settings: {
        model: 'claude-opus-4-1',
        env: { FOO: 'policy' },
        hooks: ['policy'],
      },
    },
  ])

  assert.deepEqual(merged, {
    model: 'claude-opus-4-1',
    env: {
      BAR: 'user',
      FOO: 'policy',
    },
    hooks: ['user', 'project', 'policy'],
  })
})

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

test('normalizeSettings sanitizes provider-facing settings', async () => {
  const { normalizeSettings } = await loadModule(modulePath)

  const normalized = normalizeSettings({
    provider: ' openai-compatible ',
    openaiCompatible: {
      provider: ' deepseek ',
      model: ' deepseek-chat ',
      baseUrl: 'https://api.deepseek.com/v1///',
      apiKey: ' test-key ',
      headers: {
        'X-Test': '1',
        Empty: '   ',
      },
      timeout: 120000,
    },
    modelOverrides: {
      'claude-sonnet-4-6': ' custom-sonnet ',
      'claude-opus-4-6': '',
    },
    availableModels: [' sonnet ', '', 'opus', 'sonnet'],
  })

  assert.deepEqual(normalized, {
    provider: 'openai-compatible',
    openaiCompatible: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-key',
      headers: {
        'X-Test': '1',
      },
      timeout: 120000,
    },
    modelOverrides: {
      'claude-sonnet-4-6': 'custom-sonnet',
    },
    availableModels: ['sonnet', 'opus'],
  })
})

test('normalizeSettings handles permissions, hooks, env, and model', async () => {
  const { normalizeSettings } = await loadModule(modulePath)

  const normalized = normalizeSettings({
    model: ' claude-sonnet-4-6 ',
    permissions: {
      allow: [' Bash(curl:*) ', ' Read '],
      deny: [' Bash(rm:*) ', ''],
      ask: [],
    },
    hooks: [' pre-commit ', ''],
    env: {
      ' NODE_ENV ': ' production ',
      'EMPTY': '   ',
    },
  })

  assert.deepEqual(normalized, {
    model: 'claude-sonnet-4-6',
    permissions: {
      allow: ['Bash(curl:*)', 'Read'],
      deny: ['Bash(rm:*)'],
    },
    hooks: ['pre-commit'],
    env: {
      NODE_ENV: 'production',
    },
  })
})

test('normalizeSettings returns empty object for non-object input', async () => {
  const { normalizeSettings } = await loadModule(modulePath)

  assert.deepEqual(normalizeSettings(null), {})
  assert.deepEqual(normalizeSettings(undefined), {})
  assert.deepEqual(normalizeSettings('string'), {})
  assert.deepEqual(normalizeSettings([]), {})
})

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

test('getSettingsHomePath returns path under home directory', async () => {
  const { getSettingsHomePath } = await loadModule(modulePath)

  const result = getSettingsHomePath('/home/testuser')
  assert.equal(result, '/home/testuser/.zcode')
})

test('getSettingsHomePath strips trailing slash', async () => {
  const { getSettingsHomePath } = await loadModule(modulePath)

  const result = getSettingsHomePath('/home/testuser/')
  assert.equal(result, '/home/testuser/.zcode')
})

test('getSettingsProjectPath returns path under cwd', async () => {
  const { getSettingsProjectPath } = await loadModule(modulePath)

  const result = getSettingsProjectPath('/my/project')
  assert.equal(result, '/my/project/.zcode')
})

test('getSettingsFilePath returns correct paths for all writeable sources', async () => {
  const { getSettingsFilePath } = await loadModule(modulePath)

  assert.equal(
    getSettingsFilePath('userSettings', { home: '/home/u' }),
    '/home/u/.zcode/settings.json',
  )
  assert.equal(
    getSettingsFilePath('projectSettings', { cwd: '/proj' }),
    '/proj/.zcode/settings.json',
  )
  assert.equal(
    getSettingsFilePath('localSettings', { cwd: '/proj' }),
    '/proj/.zcode/settings.local.json',
  )
  assert.equal(
    getSettingsFilePath('policySettings', { cwd: '/proj' }),
    '/proj/.zcode/managed-settings.json',
  )
})

test('getSettingsFilePath returns null for flagSettings', async () => {
  const { getSettingsFilePath } = await loadModule(modulePath)

  assert.equal(getSettingsFilePath('flagSettings'), null)
})

// ---------------------------------------------------------------------------
// File I/O: read / write / round-trip
// ---------------------------------------------------------------------------

test('writeSettingsFile and readSettingsFile round-trip', async () => {
  const { writeSettingsFile, readSettingsFile } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const filePath = `${dir}/settings.json`
    const input = { model: 'claude-sonnet-4-6', env: { FOO: 'bar' } }

    writeSettingsFile(filePath, input)
    const { settings, errors } = readSettingsFile(filePath)

    assert.equal(errors.length, 0)
    assert.deepEqual(settings, input)

    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    assert.deepEqual(parsed, input)
  } finally {
    cleanupTempDir(dir)
  }
})

test('writeSettingsFile creates intermediate directories', async () => {
  const { writeSettingsFile, readSettingsFile } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const filePath = `${dir}/deep/nested/path/settings.json`
    const input = { provider: 'anthropic' }

    writeSettingsFile(filePath, input)
    const { settings, errors } = readSettingsFile(filePath)

    assert.equal(errors.length, 0)
    assert.deepEqual(settings, input)
  } finally {
    cleanupTempDir(dir)
  }
})

test('readSettingsFile returns null settings for missing file', async () => {
  const { readSettingsFile } = await loadModule(modulePath)

  const { settings, errors } = readSettingsFile('/nonexistent/path/settings.json')

  assert.equal(settings, null)
  assert.equal(errors.length, 0)
})

test('readSettingsFile returns error for invalid JSON', async () => {
  const { readSettingsFile } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const filePath = `${dir}/bad.json`
    writeFileSync(filePath, 'not valid json {{{', 'utf-8')

    const { settings, errors } = readSettingsFile(filePath)

    assert.equal(settings, null)
    assert.ok(errors.length > 0)
    assert.ok(errors[0].message.includes('JSON'))
  } finally {
    cleanupTempDir(dir)
  }
})

test('readSettingsFile returns error for JSON array', async () => {
  const { readSettingsFile } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const filePath = `${dir}/array.json`
    writeFileSync(filePath, '["not", "an", "object"]', 'utf-8')

    const { settings, errors } = readSettingsFile(filePath)

    assert.equal(settings, null)
    assert.ok(errors.length > 0)
    assert.ok(errors[0].message.includes('object'))
  } finally {
    cleanupTempDir(dir)
  }
})

test('writeSettingsFile throws for non-object settings', async () => {
  const { writeSettingsFile } = await loadModule(modulePath)

  assert.throws(() => writeSettingsFile('/tmp/test.json', 'not an object'))
  assert.throws(() => writeSettingsFile('/tmp/test.json', []))
})

// ---------------------------------------------------------------------------
// Load single layer
// ---------------------------------------------------------------------------

test('loadSettingsLayer reads from disk', async () => {
  const { loadSettingsLayer, writeSettingsFile } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const zcodeDir = `${dir}/.zcode`
    mkdirSync(zcodeDir, { recursive: true })
    writeSettingsFile(`${zcodeDir}/settings.json`, { model: 'claude-opus' })

    const layer = loadSettingsLayer('projectSettings', { cwd: dir })

    assert.equal(layer.source, 'projectSettings')
    assert.deepEqual(layer.settings, { model: 'claude-opus' })
    assert.equal(layer.errors.length, 0)
  } finally {
    cleanupTempDir(dir)
  }
})

test('loadSettingsLayer returns empty settings for missing file', async () => {
  const { loadSettingsLayer } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const layer = loadSettingsLayer('projectSettings', { cwd: dir })

    assert.equal(layer.source, 'projectSettings')
    assert.deepEqual(layer.settings, {})
    assert.equal(layer.errors.length, 0)
  } finally {
    cleanupTempDir(dir)
  }
})

test('loadSettingsLayer returns empty for flagSettings', async () => {
  const { loadSettingsLayer } = await loadModule(modulePath)

  const layer = loadSettingsLayer('flagSettings')

  assert.equal(layer.source, 'flagSettings')
  assert.deepEqual(layer.settings, {})
  assert.equal(layer.errors.length, 0)
})

// ---------------------------------------------------------------------------
// Full chain: loadSettingsFromDisk
// ---------------------------------------------------------------------------

test('loadSettingsFromDisk merges 5 layers from disk', async () => {
  const {
    writeSettingsFile,
    loadSettingsFromDisk,
  } = await loadModule(modulePath)

  const dir = makeTempDir()
  const userHome = makeTempDir()
  try {
    const projZcode = `${dir}/.zcode`
    const userZcode = `${userHome}/.zcode`
    mkdirSync(projZcode, { recursive: true })
    mkdirSync(userZcode, { recursive: true })

    // userSettings: lowest priority
    writeSettingsFile(`${userZcode}/settings.json`, {
      model: 'claude-sonnet',
      env: { SHARED: 'from-user' },
    })

    // projectSettings
    writeSettingsFile(`${projZcode}/settings.json`, {
      model: 'claude-opus',
      hooks: ['project-hook'],
    })

    // localSettings
    writeSettingsFile(`${projZcode}/settings.local.json`, {
      env: { LOCAL_VAR: 'local-value' },
    })

    // policySettings: highest priority
    writeSettingsFile(`${projZcode}/managed-settings.json`, {
      model: 'claude-opus-4-1',
      permissions: { allow: ['Read'] },
    })

    const { settings, errors } = loadSettingsFromDisk({
      cwd: dir,
      home: userHome,
    })

    assert.equal(errors.length, 0)
    assert.deepEqual(settings, {
      model: 'claude-opus-4-1',
      env: {
        SHARED: 'from-user',
        LOCAL_VAR: 'local-value',
      },
      hooks: ['project-hook'],
      permissions: { allow: ['Read'] },
    })
  } finally {
    cleanupTempDir(dir)
    cleanupTempDir(userHome)
  }
})

test('loadSettingsFromDisk with flagSettings overrides file settings', async () => {
  const {
    writeSettingsFile,
    loadSettingsFromDisk,
  } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const projZcode = `${dir}/.zcode`
    mkdirSync(projZcode, { recursive: true })

    writeSettingsFile(`${projZcode}/settings.json`, {
      model: 'claude-sonnet',
    })

    const { settings, errors } = loadSettingsFromDisk({
      cwd: dir,
      flagSettings: {
        model: 'claude-haiku',
        provider: 'bedrock',
      },
    })

    assert.equal(errors.length, 0)
    assert.deepEqual(settings, {
      model: 'claude-haiku',
      provider: 'bedrock',
    })
  } finally {
    cleanupTempDir(dir)
  }
})

test('loadSettingsFromDisk collects errors from invalid files', async () => {
  const { loadSettingsFromDisk } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const projZcode = `${dir}/.zcode`
    mkdirSync(projZcode, { recursive: true })
    writeFileSync(`${projZcode}/settings.json`, 'invalid json {{{', 'utf-8')

    const { settings, errors } = loadSettingsFromDisk({ cwd: dir })

    assert.ok(errors.length > 0)
    assert.ok(errors[0].message.includes('JSON'))
    assert.deepEqual(settings, {})
  } finally {
    cleanupTempDir(dir)
  }
})

test('loadSettingsFromDisk with no files returns empty settings', async () => {
  const { loadSettingsFromDisk } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const { settings, errors } = loadSettingsFromDisk({ cwd: dir })

    assert.equal(errors.length, 0)
    assert.deepEqual(settings, {})
  } finally {
    cleanupTempDir(dir)
  }
})

// ---------------------------------------------------------------------------
// Save settings for a source
// ---------------------------------------------------------------------------

test('saveSettingsForSource creates new file with updates', async () => {
  const {
    saveSettingsForSource,
    readSettingsFile,
  } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const { settings: saved } = saveSettingsForSource(
      'localSettings',
      { model: 'claude-sonnet', env: { FOO: 'bar' } },
      { cwd: dir },
    )

    assert.deepEqual(saved, { model: 'claude-sonnet', env: { FOO: 'bar' } })

    const filePath = `${dir}/.zcode/settings.local.json`
    const { settings: diskSettings } = readSettingsFile(filePath)
    assert.deepEqual(diskSettings, { model: 'claude-sonnet', env: { FOO: 'bar' } })
  } finally {
    cleanupTempDir(dir)
  }
})

test('saveSettingsForSource merges into existing file', async () => {
  const {
    writeSettingsFile,
    saveSettingsForSource,
    readSettingsFile,
  } = await loadModule(modulePath)

  const dir = makeTempDir()
  try {
    const projZcode = `${dir}/.zcode`
    mkdirSync(projZcode, { recursive: true })

    writeSettingsFile(`${projZcode}/settings.json`, {
      model: 'claude-sonnet',
      env: { EXISTING: 'keep-me' },
    })

    const { settings: saved } = saveSettingsForSource(
      'projectSettings',
      { model: 'claude-opus', hooks: ['new-hook'] },
      { cwd: dir },
    )

    assert.deepEqual(saved, {
      model: 'claude-opus',
      env: { EXISTING: 'keep-me' },
      hooks: ['new-hook'],
    })

    const { settings: diskSettings } = readSettingsFile(`${projZcode}/settings.json`)
    assert.deepEqual(diskSettings, {
      model: 'claude-opus',
      env: { EXISTING: 'keep-me' },
      hooks: ['new-hook'],
    })
  } finally {
    cleanupTempDir(dir)
  }
})

test('saveSettingsForSource throws for flagSettings', async () => {
  const { saveSettingsForSource } = await loadModule(modulePath)

  assert.throws(
    () => saveSettingsForSource('flagSettings', { model: 'test' }),
    /Cannot write settings for source: flagSettings/,
  )
})

// ---------------------------------------------------------------------------
// Deep merge edge cases
// ---------------------------------------------------------------------------

test('mergeSettingsLayers deep-merges nested objects across all 5 layers', async () => {
  const { mergeSettingsLayers } = await loadModule(modulePath)

  const merged = mergeSettingsLayers([
    {
      source: 'userSettings',
      settings: {
        env: { A: 'user-a', B: 'user-b' },
        permissions: { allow: ['Read'] },
      },
    },
    {
      source: 'projectSettings',
      settings: {
        env: { B: 'project-b', C: 'project-c' },
      },
    },
    {
      source: 'localSettings',
      settings: {
        env: { C: 'local-c' },
      },
    },
    {
      source: 'flagSettings',
      settings: {
        permissions: { deny: ['Bash(rm:*)'] },
      },
    },
    {
      source: 'policySettings',
      settings: {
        model: 'claude-opus-4-1',
        env: { D: 'policy-d' },
        hooks: ['policy-hook'],
      },
    },
  ])

  assert.deepEqual(merged, {
    env: {
      A: 'user-a',
      B: 'project-b',
      C: 'local-c',
      D: 'policy-d',
    },
    permissions: {
      allow: ['Read'],
      deny: ['Bash(rm:*)'],
    },
    model: 'claude-opus-4-1',
    hooks: ['policy-hook'],
  })
})

test('mergeSettingsLayers with empty layers returns empty object', async () => {
  const { mergeSettingsLayers } = await loadModule(modulePath)

  assert.deepEqual(mergeSettingsLayers([]), {})
  assert.deepEqual(mergeSettingsLayers(), {})
})

test('mergeSettingsLayers handles layers with null/undefined settings', async () => {
  const { mergeSettingsLayers } = await loadModule(modulePath)

  const merged = mergeSettingsLayers([
    { source: 'userSettings', settings: null },
    { source: 'policySettings', settings: { model: 'claude-opus' } },
  ])

  assert.deepEqual(merged, { model: 'claude-opus' })
})
