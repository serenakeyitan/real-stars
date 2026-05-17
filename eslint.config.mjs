// ESLint 9 flat config. Type-aware linting on the TypeScript sources —
// the rules that catch the real bug classes in an async/network codebase
// (floating promises, misused promises, unhandled awaits) that a
// formatter cannot. Prettier owns formatting; ESLint owns correctness.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Browser + WebExtension + timer globals. The extension runs as a content
// script / service worker / popup — all have DOM + fetch + chrome + timers.
const browserGlobals = {
  fetch: 'readonly',
  document: 'readonly',
  window: 'readonly',
  console: 'readonly',
  chrome: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  MutationObserver: 'readonly',
  getComputedStyle: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  AbortController: 'readonly',
  crypto: 'readonly',
  TextEncoder: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
};
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  Response: 'readonly',
  AbortController: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'artifacts/**',
      'site/data/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'worker/node_modules/**',
    ],
  },

  js.configs.recommended,

  // Type-checked rules for the product TypeScript (extension + shared +
  // the tsx-run scripts). Requires the TS program, so scoped to files in
  // tsconfig's include.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...browserGlobals, ...nodeGlobals },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The bug class this codebase actually had: async work not awaited.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Bare `catch {}` that swallows errors must be deliberate — allow
      // it but the empty-block rule forces an explanatory comment.
      'no-empty': ['error', { allowEmptyCatch: false }],
      // Pragmatic: the codebase uses `any` sparingly at untyped JS seams
      // (the cron's fetch JSON). Warn, don't block — typing every
      // GitHub API shape is out of scope and low value.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Node tooling scripts (.mjs) — build/scrape/research helpers. Syntax
  // + correctness only (no type info). Scrapers drive a headless browser
  // so they legitimately reference DOM globals inside page-eval callbacks.
  {
    files: ['scripts/**/*.mjs', 'site/build-data.mjs', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Browser scripts served by the static dashboard site.
  {
    files: ['site/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Tests: relax the strictest type rules (fixtures intentionally use
  // partial/loose shapes; that's the point of a test fixture).
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
