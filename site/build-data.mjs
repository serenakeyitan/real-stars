#!/usr/bin/env node
/**
 * Build the Hall of Shame data JSON from StarScout's published CSVs.
 *
 * Produces site/data/hall-of-shame.json with:
 *   - All 13.5k repos flagged by either StarScout heuristic
 *   - For each: totalStars, fakeStars, fakePercent, detectedBy[]
 *   - Sorted by fakePercent desc within ≥1000 star tier
 *
 * Reads:
 *   site/data/starscout-low.csv       (low-activity heuristic, 4.9k rows)
 *   site/data/starscout-clustered.csv (lockstep heuristic, 8.9k rows)
 *
 * Source data: https://github.com/hehao98/StarScout/tree/main/data/250101
 * Paper: https://arxiv.org/abs/2412.13459 (ICSE 2026)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERE = __dirname;

function parseCsv(path) {
  const txt = readFileSync(path, 'utf8');
  const lines = txt.split('\n').filter((l) => l.length > 0);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cells[i] ?? '';
    return row;
  });
}

const out = new Map();

console.error('[build] reading low-activity csv…');
const low = parseCsv(resolve(HERE, 'data/starscout-low.csv'));
for (const row of low) {
  const repo = row['repo_name']?.trim();
  if (!repo || !repo.includes('/')) continue;
  const total = parseInt(row['n_stars'], 10) || 0;
  const fake = parseInt(row['n_stars_low_activity'], 10) || 0;
  if (total === 0) continue;
  out.set(repo.toLowerCase(), {
    repo,
    totalStars: total,
    fakeStars: fake,
    fakePercent: +((fake / total) * 100).toFixed(1),
    detectedBy: ['low-activity'],
  });
}
console.error(`[build] ${low.length} low-activity repos`);

console.error('[build] reading clustered csv…');
const clustered = parseCsv(resolve(HERE, 'data/starscout-clustered.csv'));
for (const row of clustered) {
  const repo = row['repo_name']?.trim();
  if (!repo || !repo.includes('/')) continue;
  const total = parseInt(row['n_stars'], 10) || 0;
  const fake = parseInt(row['n_stars_clustered'], 10) || 0;
  if (total === 0) continue;
  const key = repo.toLowerCase();
  const existing = out.get(key);
  if (existing) {
    // Take max fake count across both heuristics
    const merged = {
      repo,
      totalStars: Math.max(existing.totalStars, total),
      fakeStars: Math.max(existing.fakeStars, fake),
      fakePercent: +(
        (Math.max(existing.fakeStars, fake) / Math.max(existing.totalStars, total)) *
        100
      ).toFixed(1),
      detectedBy: [...new Set([...existing.detectedBy, 'lockstep'])],
    };
    out.set(key, merged);
  } else {
    out.set(key, {
      repo,
      totalStars: total,
      fakeStars: fake,
      fakePercent: +((fake / total) * 100).toFixed(1),
      detectedBy: ['lockstep'],
    });
  }
}
console.error(`[build] ${clustered.length} clustered repos`);

// Compute shameScore = log10(totalStars) × fakeStars
// Weights fame against fakeness. A 100k-star repo with 5% fake (5000 fake)
// scores 25000; a 5k-star repo at 80% (4000 fake) scores 14800. Famous wins,
// but mid-tier scandals can break in.
for (const r of out.values()) {
  r.shameScore = +(Math.log10(Math.max(r.totalStars, 10)) * r.fakeStars).toFixed(0);
}

// Sort by fakePercent desc (default sort for the full list)
const all = [...out.values()].sort((a, b) => b.fakePercent - a.fakePercent);
console.error(`[build] merged: ${all.length} unique repos`);

// Three views into the data, each tells a different story:
//   topByShame   — fame-weighted: the household-name scandals
//   topByStars   — pure absolute fake count (existing famous-offender list)
//   topByPercent — repos that are MOSTLY fake (existing extreme-ratio list)
const topByShame = [...all]
  .filter((r) => r.fakePercent >= 5) // filter noise floor
  .sort((a, b) => b.shameScore - a.shameScore)
  .slice(0, 30);
const topByStars = all
  .filter((r) => r.totalStars >= 5000 && r.fakePercent >= 15)
  .sort((a, b) => b.fakeStars - a.fakeStars)
  .slice(0, 50);
const topByPercent = all.filter((r) => r.totalStars >= 1000 && r.fakePercent >= 15).slice(0, 50);
console.error(`[build] top by shame score (log10(stars) × fake): ${topByShame.length}`);
console.error(`[build] top by famousness (≥5000 stars, ≥15% fake): ${topByStars.length}`);
console.error(`[build] top by percent (≥1000 stars, ≥15% fake): ${topByPercent.length}`);

const data = {
  generatedAt: new Date().toISOString(),
  snapshotDate: '2025-01-01',
  source: 'https://github.com/hehao98/StarScout',
  paper: 'https://arxiv.org/abs/2412.13459',
  paperTitle:
    '4.5 Million (Suspected) Fake Stars in GitHub: A Growing Problem with Wide-Reaching Implications',
  shameScoreFormula: 'log10(totalStars) × fakeStars',
  totalRepos: all.length,
  topByShame,
  topByStars,
  topByPercent,
  all,
};

const outPath = resolve(HERE, 'data/hall-of-shame.json');
writeFileSync(outPath, JSON.stringify(data));
console.error(
  `[build] wrote ${(readFileSync(outPath).byteLength / 1024).toFixed(1)} KB → ${outPath}`,
);
