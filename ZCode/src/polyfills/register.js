/**
 * Preload script: registers ZCode polyfills for Node.js.
 *
 * Usage:
 *   node --import tsx/esm --import ./src/polyfills/register.js <entry>
 *
 * This must be loaded AFTER tsx (so tsx's loader is registered first)
 * but BEFORE any application code (so globals are in place).
 */

// 1. Set up Bun API globals (MACRO, Bun, etc.)
import './globals.js'

// 2. Register custom loader for bun:bundle resolution and .js→.ts extension
import { register } from 'node:module'
register('./loader.js', import.meta.url)
