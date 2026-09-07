// Tests for the TUI theme palette (v1.7.1 D5/D6/D7): semantic tokens, dark/
// light mode mapping, context-load thresholds, and mode resolution.

import test from 'node:test'
import assert from 'node:assert/strict'

import { createStyler } from '../../src/cli/ansi.js'
import { resolveThemeMode, createTuiTheme, createPlainTheme } from '../../src/cli/tuiTheme.js'

// Expected wrapper, built without escape-char regex literals.
const ESC = String.fromCharCode(27)
const wrap = code => text => `${ESC}[${code}m${text}${ESC}[0m`

test('theme: resolveThemeMode honors ZCODE_THEME over the COLORFGBG heuristic', () => {
  assert.equal(resolveThemeMode({}), 'dark')
  assert.equal(resolveThemeMode({ ZCODE_THEME: 'light' }), 'light')
  assert.equal(resolveThemeMode({ ZCODE_THEME: 'dark' }), 'dark')
  assert.equal(resolveThemeMode({ ZCODE_THEME: ' LIGHT ' }), 'light', 'case/space tolerant')
  assert.equal(resolveThemeMode({ ZCODE_THEME: 'solarized' }), 'dark', 'unknown value falls back')
  // COLORFGBG "fg;bg": background codes 7..15 are light surfaces.
  assert.equal(resolveThemeMode({ COLORFGBG: '15;7' }), 'light')
  assert.equal(resolveThemeMode({ COLORFGBG: '15;15' }), 'light')
  assert.equal(resolveThemeMode({ COLORFGBG: '15;0' }), 'dark')
  assert.equal(resolveThemeMode({ COLORFGBG: '0;15' }), 'light', 'the bg field decides')
  assert.equal(resolveThemeMode({ COLORFGBG: 'garbage' }), 'dark')
  assert.equal(resolveThemeMode({ COLORFGBG: '15;7', ZCODE_THEME: 'dark' }), 'dark', 'explicit wins')
})

test('theme: dark chrome is faint; light chrome is mid-gray; hues stay', () => {
  const dark = createTuiTheme(createStyler(true), 'dark')
  const light = createTuiTheme(createStyler(true), 'light')

  assert.equal(dark.chrome('x'), wrap(2)('x'))
  assert.equal(light.chrome('x'), wrap(90)('x'), 'faint is unreadable on white')
  assert.equal(light.accent('x'), wrap(36)('x'), 'accent keeps its hue')
  assert.equal(light.success('x'), wrap(32)('x'))
  assert.equal(light.danger('x'), wrap(31)('x'))
  assert.equal(light.emphasis('x'), wrap(1)('x'))
  assert.equal(dark.mode, 'dark')
  assert.equal(light.mode, 'light')
})

test('theme: contextLoad colors by load threshold', () => {
  const theme = createTuiTheme(createStyler(true), 'dark')
  assert.equal(theme.contextLoad(12)('bar'), wrap(36)('bar'), 'calm: accent')
  assert.equal(theme.contextLoad(49)('bar'), wrap(36)('bar'))
  assert.equal(theme.contextLoad(50)('bar'), wrap(33)('bar'), 'half: warn')
  assert.equal(theme.contextLoad(79)('bar'), wrap(33)('bar'))
  assert.equal(theme.contextLoad(80)('bar'), wrap(31)('bar'), 'near limit: alarm')
  assert.equal(theme.contextLoad(Number.NaN)('bar'), wrap(2)('bar'), 'unknown degrades to chrome')
})

test('theme: plain theme is identity everywhere (headless / NO_COLOR)', () => {
  const theme = createPlainTheme()
  assert.equal(theme.accent('x'), 'x')
  assert.equal(theme.chrome('x'), 'x')
  assert.equal(theme.emphasis('x'), 'x')
  assert.equal(theme.contextLoad(90)('bar'), 'bar')
  assert.equal(theme.mode, 'plain')
})
