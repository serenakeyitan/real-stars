#!/usr/bin/env node
/**
 * Mobile responsive audit — screenshots both pages at common phone widths
 * so we can review the layout before shipping.
 *
 * Widths captured:
 *   • 375x812  iPhone 13 mini / SE
 *   • 393x852  iPhone 15 / Pixel 8 (most common today)
 *   • 414x896  iPhone 11 / Plus models
 *
 * Output: artifacts/mobile-audit/<page>-<width>.png (full page)
 */

import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'mobile-audit');
mkdirSync(OUT, { recursive: true });

const LOCAL = process.env.LOCAL_URL ?? 'http://localhost:4567';

const browser = await chromium.launch();

const widths = [
  { name: 'iphone-se', viewport: { width: 375, height: 812 } },
  { name: 'iphone-15', viewport: { width: 393, height: 852 } },
  { name: 'iphone-plus', viewport: { width: 414, height: 896 } },
];

const pages = [
  { name: 'home', path: '/' },
  { name: 'registry', path: '/registry.html' },
];

for (const w of widths) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: w.viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  for (const p of pages) {
    const url = `${LOCAL}${p.path}`;
    console.error(`▶ ${w.name} (${w.viewport.width}px) — ${p.path}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('load', { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Capture full page so we see every section
    const file = `${p.name}-${w.name}.png`;
    await page.screenshot({ path: resolve(OUT, file), fullPage: true });
    console.error(`  → ${file}`);

    // Also check for horizontal scroll (mobile killer)
    const scrollInfo = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      vpW: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    if (scrollInfo.overflow) {
      console.error(
        `  ⚠ HORIZONTAL OVERFLOW: docW=${scrollInfo.docW} vs vpW=${scrollInfo.vpW}`,
      );
    }
  }
  await ctx.close();
}

await browser.close();
console.error(`\nartifacts/mobile-audit/`);
