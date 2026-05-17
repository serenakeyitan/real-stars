import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage is measured on the PURE algorithm core only. That is
      // where a regression silently corrupts every verdict and where
      // tests are cheap (no mocking). The I/O layers (network fetch,
      // chrome.storage, OAuth) are deliberately excluded — covering them
      // needs heavy environment mocking for low marginal safety, and
      // they're exercised end-to-end by the Playwright E2E suite instead.
      include: ['src/shared/mad.ts', 'src/shared/validation.ts', 'src/shared/audienceGate.ts'],
      // Hard floor — CI fails if the algorithm core regresses below this.
      // Current actual: validation/audienceGate 100%, mad ~96%. The bar
      // is set just under today's reality so it ratchets, never slips.
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 95,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
