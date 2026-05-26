/**
 * ESLint flat config for the Forge plugin.
 *
 * Goals:
 *   - Catch real bugs (no-unused-vars, no-undef-init, etc.)
 *   - Keep style noise low (no opinionated formatting rules)
 *   - Allow @ts-expect-error for Obsidian's many undocumented APIs
 *   - Allow `any` only with explicit eslint-disable for that line
 */
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'main.js',
      'node_modules/**',
      'package/**',
      'dist/**',
      '*.config.js',
      '*.config.mjs',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // Don't need project-aware linting (no type-check rules), which
        // keeps lint fast.
      },
      globals: {
        // Browser + Obsidian runtime
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        localStorage: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        performance: 'readonly',
        // Timer globals
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        // DOM types used as values
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLButtonElement: 'readonly',
        FocusEvent: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // Type safety — encourage explicit types but allow inference
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Bug catchers
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-coercion': ['warn', { allow: ['!!', '+'] }],
      'eqeqeq': ['error', 'smart'],
      'no-throw-literal': 'error',
      'no-return-await': 'warn',

      // Code health
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-undef-init': 'error',
      'no-unneeded-ternary': 'warn',

      // Allow @ts-expect-error and @ts-ignore (we use them sparingly for
      // Obsidian's undocumented runtime APIs like app.commands and
      // app.secretStorage).
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': false,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
    },
  },
  {
    // Test files relax some rules
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
