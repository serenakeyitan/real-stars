#!/usr/bin/env node
/**
 * Capture how leading AI/dev companies present "announcement" or
 * "install our extension/SDK" CTAs at the top of their pages. Used to
 * inform our /trending banner redesign.
 *
 * Output: artifacts/banner-study/*.png
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'banner-study');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// Pages I want to study — landing pages or "product" pages of dev/AI
// companies known for restrained, modern banners.
const sites = [
  { url: 'https://www.anthropic.com', name: 'anthropic-home' },
  { url: 'https://openai.com', name: 'openai-home' },
  { url: 'https://vercel.com', name: 'vercel-home' },
  { url: 'https://linear.app', name: 'linear-home' },
  { url: 'https://stripe.com', name: 'stripe-home' },
  { url: 'https://supabase.com', name: 'supabase-home' },
  { url: 'https://github.com', name: 'github-home' },
];

for (const { url, name } of sites) {
  console.error(`▶ ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForLoadState('load', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Top 600px of the page — that's where announcement banners live
    await page.screenshot({
      path: resolve(OUT, `${name}.png`),
      clip: { x: 0, y: 0, width: 1280, height: 600 },
    });
    console.error(`  → ${name}.png`);
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
  }
}

await browser.close();
console.error(`\n${OUT}/`);
