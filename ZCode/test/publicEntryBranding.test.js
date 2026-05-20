import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { resolveFromHere } from './helpers/loadModule.js'

async function readSource(...segments) {
  return fs.readFile(resolveFromHere(import.meta.url, '..', ...segments), 'utf8')
}

test('welcome screen copy uses ZCode operator-console language', async () => {
  const source = await readSource(
    'src',
    'components',
    'LogoV2',
    'WelcomeV2.tsx',
  )

  assert.match(source, /cwd:/)
  assert.match(source, /mode: interactive/)
  assert.match(source, /ask, edit, run, inspect/)
  assert.doesNotMatch(source, /Welcome to Claude Code/)
})

test('general help copy describes ZCode in neutral tool language', async () => {
  const source = await readSource('src', 'components', 'HelpV2', 'General.tsx')

  assert.match(
    source,
    /ZCode reads your workspace, proposes edits, runs commands with\s+approval, and keeps the session in context\./,
  )
  assert.doesNotMatch(source, /Claude understands your codebase/)
})

test('remote access callout avoids Claude app and claude.ai\/code in first-layer copy', async () => {
  const source = await readSource('src', 'components', 'RemoteCallout.tsx')

  assert.match(source, /Open this session elsewhere/)
  assert.match(source, /secure web link/)
  assert.match(source, /resume it from another device/)
  assert.doesNotMatch(source, /Claude app/)
  assert.doesNotMatch(source, /claude\.ai\/code/)
})

test('bridge dialog status copy uses neutral linked-session wording', async () => {
  const source = await readSource('src', 'bridge', 'bridgeStatusUtil.ts')

  assert.match(source, /Open this session elsewhere via/)
  assert.match(source, /Continue in your linked session or/)
  assert.doesNotMatch(source, /Claude app/)
})

test('update command uses ZCode user-facing status text', async () => {
  const source = await readSource('src', 'cli', 'update.ts')

  assert.match(source, /managed by winget\./)
  assert.match(source, /is up to date!/)
  assert.doesNotMatch(source, /Claude is up to date!/)
  assert.doesNotMatch(source, /Claude Code is up to date/)
})

test('IDE onboarding uses neutral ZCode workspace language', async () => {
  const source = await readSource('src', 'components', 'IdeOnboardingDialog.tsx')

  assert.match(source, /ZCode for/)
  assert.match(source, /Open files and selected lines stay in context/)
  assert.match(source, /Review session changes in your IDE/)
  assert.doesNotMatch(source, /Welcome to Claude Code/)
  assert.doesNotMatch(source, /Claude has context of/)
  assert.doesNotMatch(source, /Review Claude Code's changes/)
})

test('remote-control first-run prompts avoid Claude app and web branding copy', async () => {
  const source = await readSource('src', 'bridge', 'bridgeMain.ts')

  assert.match(
    source,
    /Remote Control lets you open this CLI session elsewhere with a secure web link\./,
  )
  assert.match(
    source,
    /Remote Control spawn mode lets you create additional sessions in this project from a linked session or another device\./,
  )
  assert.doesNotMatch(source, /or the Claude app/)
  assert.doesNotMatch(source, /Claude Remote Control is launching in spawn mode/)
  assert.doesNotMatch(source, /from Claude Code on Web or your Mobile app/)
})
