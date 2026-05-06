import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false, // chrome extension contexts don't parallelize cleanly
  workers: 1,
  reporter: [['list']],
  use: {
    headless: false, // chrome extensions require a real browser context
    trace: 'retain-on-failure',
  },
});
