import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['dist/'] },
  js.configs.recommended,
  {
    // main.js is a plain script PopCraft loads into its plugin sandbox, with a `popcraft` global.
    files: ['main.js'],
    languageOptions: { sourceType: 'script', ecmaVersion: 2023, globals: { ...globals.browser, popcraft: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^createConnector$' }] },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.js'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2023, globals: globals.node },
  },
]
