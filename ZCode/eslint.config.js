/**
 * ESLint flat config — scoped to the public layer, which is now the only code
 * in the repository. The legacy reference tree that previously lived under
 * src/ was removed in v1.4 (see docs/adr/0001).
 */

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const publicLayer = [
  'src/entrypoints/**/*.js',
  'src/cli/publicCliCore.js',
  'src/cli/harnessPrint.js',
  'src/cli/tui.js',
  'src/harness/**/*.ts',
  'src/providers/**/*.js',
  'src/contracts/providerAdapter.js',
  'src/config/**/*.js',
  'src/utils/permissions/runMode.js',
  'src/utils/model/configs.js',
  'test/harness/**/*.js',
  'test/e2e/**/*.js',
  'test/helpers/fakeLlmServer.js',
  'test/helpers/loadModule.js',
  'test/all.test.js',
]

export default tseslint.config(
  {
    ignores: ['**/node_modules/**'],
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
