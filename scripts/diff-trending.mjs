#!/usr/bin/env node
/**
 * Side-by-side screenshot comparison of github.com/trending vs our /trending.
 * Used during the visual port — open the resulting PNGs, iterate the CSS,
 * re-run. Not a CI test.
 *
 * Usage:
 *   # 1. start the local site (default port 4567):
 *   pnpm site:dev   # in another terminal
 *   # 2. run the diff:
 *   node scripts/diff-trending.mjs
 *
 * Output:
 *   artifacts/trending-diff/
 *     github.png       — what github.com/trending looks like (full page)
 *     ours.png         — what our /trending.html looks like (full page)
 *     github-row.png   — just the first article row, scoped + cropped
 *     ours-row.png     — just our first repo card, scoped + cropped
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'artifacts', 'trending-diff');
mkdirSync(OUT_DIR, { recursive: true });

const LOCAL_URL = process.env.LOCAL_URL ?? 'http://localhost:4567/trending.html';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function shot(url, file, rowSelector) {
  console.error(`▶ ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Let layout + fonts settle
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUT_DIR, file), fullPage: true });
  console.error(`  → ${file}`);
  // First-row close-up
  if (rowSelector) {
    const row = await page.$(rowSelector);
    if (row) {
      await row.screenshot({ path: resolve(OUT_DIR, file.replace('.png', '-row.png')) });
      console.error(`  → ${file.replace('.png', '-row.png')}`);
    } else {
      console.error(`  ! selector "${rowSelector}" not found`);
    }
  }
}

await shot('https://github.com/trending', 'github.png', 'article.Box-row');
await shot(LOCAL_URL, 'ours.png', '.trending-row, .trend-card');

await browser.close();
console.error(`\nopen ${OUT_DIR}/ to compare.`);
