#!/usr/bin/env node
/**
 * Scrape github.com/trending (daily + weekly) and cross-reference each
 * trending repo against the StarScout dataset (site/data/hall-of-shame.json).
 *
 * Output: site/data/trending.json
 *   {
 *     fetchedAt,
 *     snapshotDate,        // dataset snapshot date for context
 *     daily:  [{repo, language, todayStars, inDataset, fakePercent?, fakeStars?, totalStars?, detectedBy?}, …],
 *     weekly: [{…}],
 *   }
 *
 * Run from repo root:  node scripts/fetch-trending.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const DATA_PATH = resolve(REPO_ROOT, 'site/data/hall-of-shame.json');
const OUT_PATH = resolve(REPO_ROOT, 'site/data/trending.json');

const TRENDING_URLS = {
  daily: 'https://github.com/trending?since=daily',
  weekly: 'https://github.com/trending?since=weekly',
};

async function fetchTrending(url) {
  const resp = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; real-stars-cron/1.0; +https://github.com/serenakeyitan/real-stars)',
      accept: 'text/html',
    },
  });
  if (!resp.ok) throw new Error(`GET ${url} → ${resp.status}`);
  return resp.text();
}

// Parse GitHub trending HTML. Each repo block looks like:
//   <h2 class="h3 lh-condensed">
//     <a href="/owner/repo" ...>
//       <span class="text-normal">owner /</span>
//       repo
//     </a>
//   </h2>
//   …
//   <span itemprop="programmingLanguage">TypeScript</span>
//   …
//   <span class="d-inline-block float-sm-right">
//     <svg ...></svg> 1,234 stars today
//   </span>
function parseTrending(html) {
  const out = [];
  // Repo URLs in trending pages are clean /owner/repo links inside the headline h2.
  // We extract by walking each <article class="Box-row"> block.
  const blocks = html.split(/<article class="Box-row[^"]*">/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    // Headline link
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"\/]+\/[^"\/?]+)"/);
    if (!linkMatch) continue;
    const repo = linkMatch[1].trim();
    // Language (optional)
    const langMatch = block.match(/itemprop="programmingLanguage"[^>]*>([^<]+)</);
    const language = langMatch ? langMatch[1].trim() : null;
    // Stars today / this week
    const todayMatch = block.match(/([\d,]+)\s+stars\s+(?:today|this week)/);
    const todayStars = todayMatch ? parseInt(todayMatch[1].replace(/,/g, ''), 10) : null;
    out.push({ repo, language, todayStars });
  }
  return out;
}

console.error('[trending] loading dataset…');
const dataset = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const index = new Map();
for (const r of dataset.all) index.set(r.repo.toLowerCase(), r);
console.error(`[trending] dataset: ${dataset.all.length} flagged repos`);

const result = {
  fetchedAt: new Date().toISOString(),
  snapshotDate: dataset.snapshotDate,
  daily: [],
  weekly: [],
};

for (const [period, url] of Object.entries(TRENDING_URLS)) {
  console.error(`[trending] fetching ${period}…`);
  const html = await fetchTrending(url);
  const parsed = parseTrending(html);
  console.error(`[trending] ${period}: parsed ${parsed.length} repos`);
  if (parsed.length === 0) {
    throw new Error(`[trending] parse failed for ${period} — got 0 repos, HTML structure may have changed`);
  }
  for (const p of parsed) {
    const hit = index.get(p.repo.toLowerCase());
    if (hit) {
      result[period].push({
        ...p,
        inDataset: true,
        totalStars: hit.totalStars,
        fakeStars: hit.fakeStars,
        fakePercent: hit.fakePercent,
        detectedBy: hit.detectedBy,
      });
    } else {
      result[period].push({ ...p, inDataset: false });
    }
  }
}

writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
const flagged = {
  daily: result.daily.filter((r) => r.inDataset).length,
  weekly: result.weekly.filter((r) => r.inDataset).length,
};
console.error(
  `[trending] wrote ${OUT_PATH}\n` +
    `[trending]   daily:  ${result.daily.length} trending, ${flagged.daily} in dataset\n` +
    `[trending]   weekly: ${result.weekly.length} trending, ${flagged.weekly} in dataset`,
);
