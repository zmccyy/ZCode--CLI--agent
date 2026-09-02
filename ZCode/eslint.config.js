/**
 * ESLint flat config — scoped to the public layer (the code that actually
 * ships in the harness runtime). The vendored reference tree under src/ is
 * deliberately NOT linted: it is reference material scheduled for removal
 * (see docs/adr/0001), and linting 185k lines of legacy source would be noise.
 */

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const publicLayer = [
  'src/entrypoints/**/*.js',
  'src/cli/publicCliCore.js',
  'src/cli/harnessPrint.js',
  'src/harness/**/*.ts',
  'src/providers/**/*.js',
  'src/contracts/providerAdapter.js',
  'src/config/brandConfig.js',
  'src/config/brandText.js',
  'src/config/settingsContract.js',
  'src/config/providerEnvironment.js',
  'test/harness/**/*.js',
  'test/e2e/**/*.js',
  'test/helpers/fakeLlmServer.js',
  'test/helpers/loadModule.js',
  'test/all.test.js',
]

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', 'src/types/**', 'src/services/**'],
  },
  {
    files: publicLayer,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Harness code communicates failure through tool results and stop
      // reasons; bare console output is a CLI concern, not a harness one.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
)
