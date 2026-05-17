#!/usr/bin/env node
/**
 * Screenshot reference GitHub pages to inform our design system.
 *
 * Captures multiple GitHub list pages + extracts computed CSS values from
 * key elements (Box-row spacing, type sizes, color tokens). Output is
 * written to artifacts/github-study/.
 *
 * Run from repo root:
 *   node scripts/study-github.mjs
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'artifacts', 'github-study');
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  colorScheme: 'dark',
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const pages = [
  { url: 'https://github.com/trending', name: 'trending' },
  { url: 'https://github.com/explore', name: 'explore' },
  { url: 'https://github.com/search?q=stars&type=repositories', name: 'search' },
];

for (const { url, name } of pages) {
  console.error(`▶ ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  await page.screenshot({ path: resolve(OUT_DIR, `${name}.png`), fullPage: true });
  console.error(`  → ${name}.png`);

  // Pull a row close-up if we can find one
  const rowSel = name === 'trending' ? 'article.Box-row' : 'article, .Box-row, [role="row"]';
  const row = await page.$(rowSel);
  if (row) {
    await row.screenshot({ path: resolve(OUT_DIR, `${name}-row.png`) });
    console.error(`  → ${name}-row.png`);
  }
}

// Extract tokens from trending page (the most relevant reference)
await page.goto('https://github.com/trending', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

const computed = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  const row = document.querySelector('article.Box-row');
  const rowS = row ? getComputedStyle(row) : null;
  const title = row?.querySelector('h2 a');
  const titleS = title ? getComputedStyle(title) : null;
  const description = row?.querySelector('p');
  const descS = description ? getComputedStyle(description) : null;
  const meta = row?.querySelector('.f6');
  const metaS = meta ? getComputedStyle(meta) : null;

  return {
    bodyBg: body.backgroundColor,
    bodyColor: body.color,
    bodyFont: body.fontFamily,
    bodyFontSize: body.fontSize,
    bodyLineHeight: body.lineHeight,
    rowBorder: rowS?.borderColor,
    rowBorderWidth: rowS?.borderTopWidth,
    rowPadding: rowS?.padding,
    rowBg: rowS?.backgroundColor,
    titleFontSize: titleS?.fontSize,
    titleFontWeight: titleS?.fontWeight,
    titleColor: titleS?.color,
    titleFontFamily: titleS?.fontFamily,
    descFontSize: descS?.fontSize,
    descColor: descS?.color,
    descLineHeight: descS?.lineHeight,
    metaFontSize: metaS?.fontSize,
    metaColor: metaS?.color,
  };
});

writeFileSync(resolve(OUT_DIR, 'tokens.json'), JSON.stringify(computed, null, 2));
console.error(`\n▶ tokens.json:\n${JSON.stringify(computed, null, 2)}`);

await browser.close();
console.error(`\n${OUT_DIR}/`);
