#!/usr/bin/env node
/**
 * Pick a 10-repo stratified calibration set from StarScout's published
 * dataset. We want:
 *   - 3 high-fake (≥30% bought per StarScout) — checks our algorithm
 *     catches obvious fakes
 *   - 4 mid-fake (10–30% bought) — the tricky middle range where most
 *     trending repos sit
 *   - 3 clean famous (NOT in StarScout dataset, ≥10k stars) — checks
 *     our algorithm doesn't flag legitimate repos
 *
 * Output: scripts/calibration-repos-starscout-test.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, '..', 'site/data/hall-of-shame.json');
const OUT = resolve(__dirname, 'calibration-repos-starscout-test.json');

const dataset = JSON.parse(readFileSync(DATA, 'utf8'));

// High-fake tier: ≥30% AND ≥10k stars (so we're testing famous-but-fake repos)
const high = dataset.all
  .filter((r) => r.fakePercent >= 30 && r.totalStars >= 10000)
  .slice(0, 3);

// Mid-fake tier: 10–30%, ≥10k stars (the realistic middle range)
const mid = dataset.all
  .filter((r) => r.fakePercent >= 10 && r.fakePercent < 30 && r.totalStars >= 10000)
  .slice(0, 4);

// Clean famous: known-legit, NOT in the dataset
// (StarScout doesn't list these → expected fake% is very low)
const cleanFamous = [
  { repo: 'torvalds/linux', expectedFakePercent: 1.0, reason: 'Linux kernel' },
  { repo: 'microsoft/vscode', expectedFakePercent: 1.5, reason: 'VS Code' },
  { repo: 'facebook/react', expectedFakePercent: 2.0, reason: 'React' },
];

const seeds = [
  ...high.map((r) => ({
    repo: r.repo,
    expectedFakePercent: r.fakePercent,
    expectedTotalStars: r.totalStars,
    expectedBoughtStars: r.fakeStars,
    tier: 'high',
    starscoutFlags: r.detectedBy,
  })),
  ...mid.map((r) => ({
    repo: r.repo,
    expectedFakePercent: r.fakePercent,
    expectedTotalStars: r.totalStars,
    expectedBoughtStars: r.fakeStars,
    tier: 'mid',
    starscoutFlags: r.detectedBy,
  })),
  ...cleanFamous.map((r) => ({ ...r, tier: 'clean' })),
];

writeFileSync(OUT, JSON.stringify(seeds, null, 2));
console.error(`[seed] wrote ${seeds.length} seeds → ${OUT}`);
for (const s of seeds) {
  console.error(`  [${s.tier}] ${s.repo} — expected ${s.expectedFakePercent}%`);
}
