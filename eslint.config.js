import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import stylistic from '@stylistic/eslint-plugin';
import vuePlugin from 'eslint-plugin-vue';
import jsoncPlugin from 'eslint-plugin-jsonc';
import eslintJs from '@eslint/js';
import * as vueParser from 'vue-eslint-parser';

export default [
  {
    // Base configuration for all files
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
    rules: {
      // Stylistic rules
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/no-trailing-spaces': ['error'],
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/brace-style': ['error', 'stroustrup', { allowSingleLine: true }],
    },
  },
  // Typescript config
  {
    // JavaScript and TypeScript files
    files: ['**/*.{js,ts}'],
    plugins: {
      '@typescript-eslint': typescript,
      '@stylistic': stylistic,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Honor the repo convention: a leading underscore marks an
      // intentionally-unused binding (required param, caught error, etc.).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  // Vue config
  {
    files: ['**/*.vue'],
    plugins: {
      'vue': vuePlugin,
      '@typescript-eslint': typescript,
      '@stylistic': stylistic,
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: 2020,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/html-indent': ['error', 2],
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/html-self-closing': ['error', {
        html: {
          void: 'always',
          normal: 'always',
          component: 'always',
        },
      }],
      'vue/max-attributes-per-line': ['error', {
        singleline: { max: 3 },
        multiline: { max: 1 },
      }],
      'vue/multi-word-component-names': 'off',
      'vue/valid-template-root': 'error',
    },
  },
  // JSON config (locale files and other JSON)
  // flat/base wires up the jsonc parser for .json files.
  ...jsoncPlugin.configs['flat/base'],
  {
    files: ['**/*.json'],
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      // JS-only stylistic rules from the base block don't apply to JSON.
      '@stylistic/semi': 'off',
      '@stylistic/indent': 'off',
      '@stylistic/comma-dangle': 'off',
      '@stylistic/brace-style': 'off',
      // (@stylistic/eol-last and @stylistic/no-trailing-spaces still apply:
      // eol-last enforces the trailing newline required below.)

      // JSON policies (GH #1)
      'jsonc/indent': ['error', 2],                 // 2-space indentation
      'jsonc/quotes': ['error', 'double'],          // double-quote values
      'jsonc/quote-props': ['error', 'always'],     // double-quote keys
      'jsonc/comma-dangle': ['error', 'never'],     // no trailing comma
    },
  },
];
