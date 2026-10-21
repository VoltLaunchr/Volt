import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Shared browser/Node globals reused across config blocks.
const sharedGlobals = {
  // Browser globals
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Window: 'readonly',
  // Browser APIs
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLDivElement: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  CustomEvent: 'readonly',
  MediaQueryListEvent: 'readonly',
  Notification: 'readonly',
  AudioContext: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Worker: 'readonly',
  MessageEvent: 'readonly',
  ErrorEvent: 'readonly',
  RequestInit: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  SVGGElement: 'readonly',
  SVGSVGElement: 'readonly',
  SVGElement: 'readonly',
  SVGTextElement: 'readonly',
  SVGRectElement: 'readonly',
  SVGLineElement: 'readonly',
  SVGPathElement: 'readonly',
  DOMRect: 'readonly',
  // React
  React: 'readonly',
  // Node.js (for vite.config.ts and test scripts)
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

export default [
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'src-tauri/target/**',
      'node_modules/**',
      '.eslintrc.cjs',
      '.claude/**',
      // Generated/coverage outputs
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // ts-rs generated IPC bindings (source of truth is the Rust structs)
      'src/shared/types/generated/**',
    ],
  },
  // Type-checked config for project source (src/) — requires tsconfig project.
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: sharedGlobals,
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs['recommended-type-checked'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Type-checked rules: surface as warnings to keep safety nets visible
      // without blocking CI on pre-existing volume. Fix incrementally.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-implied-eval': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      // Downgraded to warn: pre-existing volume; safety net still visible.
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      'no-useless-escape': 'warn',
      // Audit recommendation: re-enable manual-memo lint as warning
      // since React Compiler is not enabled in vite.config.ts.
      'react-hooks/preserve-manual-memoization': 'warn',
      // Other React Compiler rules remain off (noisier, audit only flagged the first).
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  // Non-type-checked block for top-level config files & scripts that aren't
  // in any tsconfig project (eslint.config.js, playwright.config.ts, etc.).
  // Type-aware rules are skipped; only basic JS/TS rules run.
  // Scoped to .{js,jsx,ts,tsx} to match the original glob — .mjs/.cjs scripts
  // were not linted before, leave them as-is to avoid surfacing pre-existing
  // errors that aren't in this audit's scope.
  {
    files: [
      'eslint.config.js',
      'playwright.config.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'scripts/**/*.{js,ts,jsx,tsx}',
      '*.config.{js,ts}',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsparser,
      parserOptions: {
        ecmaFeatures: { jsx: false },
        // No `project` here: these files are not in any tsconfig include.
        // Type-aware rules will simply not run for them.
      },
      globals: sharedGlobals,
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-useless-escape': 'warn',
    },
  },
];
