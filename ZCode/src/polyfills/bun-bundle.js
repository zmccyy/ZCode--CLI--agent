/**
 * Node.js polyfill for bun:bundle.
 *
 * In Bun, feature() is a build-time macro that enables dead-code elimination.
 * For Node.js (dev/oss builds), all features are enabled (return true).
 * Production bundling will inline these via Bun's bundler.
 */

/**
 * @param {string} _name - feature flag name
 * @returns {true}
 */
export function feature(_name) {
  return true
}
