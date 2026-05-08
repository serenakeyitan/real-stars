#!/usr/bin/env -S npx tsx
/**
 * One-off: find StarScout-flagged "suspicious" repos with ≥1000 stars
 * still accessible on GitHub. Output as a calibration seed JSON.
 *
 * Usage: GITHUB_TOKEN=$(gh auth token) tsx scripts/find-big-fake.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN');
  process.exit(1);
}

const csv = readFileSync(resolve(ROOT, 'scripts/.starscout-labels-cache.csv'), 'utf8');
const lines = csv.split('\n').filter(Boolean).slice(1);
const suspicious = lines
  .map((l) => l.split(','))
  .filter((p) => p[4]?.trim() === 'suspicious')
  .map((p) => p[0].trim());

console.error(`[find] checking ${suspicious.length} suspicious repos…`);

const results: Array<{ repo: string; stars: number }> = [];

// 6-way parallelism for speed
const CONCURRENCY = 6;
let i = 0;
async function worker() {
  while (i < suspicious.length) {
    const idx = i++;
    const repo = suspicious[idx];
    try {
      const resp = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'real-stars-find-big-fake',
        },
      });
      if (resp.status === 200) {
        const data = (await resp.json()) as { stargazers_count: number };
        if (data.stargazers_count >= 1000) {
          results.push({ repo, stars: data.stargazers_count });
          console.error(`  ✓ ${repo}: ${data.stargazers_count} stars`);
        }
      }
    } catch {
      // ignore
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

results.sort((a, b) => b.stars - a.stars);
console.error(`\n[find] ${results.length} repos with ≥1000 stars and still live`);

const seedFile = results.map((r) => ({
  repo: r.repo,
  expected: 'fake-suspect' as const,
  reason: `StarScout ai_label="suspicious" — ${r.stars.toLocaleString()} stars at scan time`,
}));

const outPath = resolve(ROOT, 'scripts/calibration-repos-big-fake.json');
writeFileSync(outPath, JSON.stringify(seedFile, null, 2) + '\n');
console.error(`[find] wrote ${seedFile.length} seeds → ${outPath}`);
