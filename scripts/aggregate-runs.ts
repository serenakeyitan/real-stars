#!/usr/bin/env -S npx tsx
/**
 * Aggregate fake-percent numbers across multiple calibration run files.
 *
 * Usage:
 *   tsx scripts/aggregate-runs.ts /tmp/famous-run1.md /tmp/famous-run2.md ...
 *
 * For each repo that appears in all input runs, prints:
 *   mean ± std  (n=runs)  range [min, max]  repo
 */

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: tsx scripts/aggregate-runs.ts <file1.md> [file2.md ...]');
  process.exit(1);
}

interface Sample {
  pct: number;
  risk: string;
}

const data = new Map<string, Sample[]>();

for (const f of files) {
  const txt = readFileSync(f, 'utf8');
  const lines = txt.split('\n').filter((l) => l.startsWith('| ['));
  for (const line of lines) {
    const cells = line.split('|').map((c) => c.trim());
    // [empty, repo, stars, analyzed, bursts, pct, risk, expected, match, notes, ...]
    const repoMatch = cells[1].match(/\[([^\]]+)\]/);
    if (!repoMatch) continue;
    const repo = repoMatch[1];
    const pctStr = cells[5].replace('%', '');
    const pct = parseFloat(pctStr);
    if (Number.isNaN(pct)) continue;
    const risk = cells[6];
    if (!data.has(repo)) data.set(repo, []);
    data.get(repo)!.push({ pct, risk });
  }
}

interface Row {
  repo: string;
  mean: number;
  std: number;
  min: number;
  max: number;
  n: number;
  risks: string[];
}

const rows: Row[] = [];
for (const [repo, samples] of data) {
  const pcts = samples.map((s) => s.pct);
  const n = pcts.length;
  const mean = pcts.reduce((a, b) => a + b, 0) / n;
  const variance = pcts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(variance);
  const min = Math.min(...pcts);
  const max = Math.max(...pcts);
  const risks = [...new Set(samples.map((s) => s.risk))];
  rows.push({ repo, mean, std, min, max, n, risks });
}

rows.sort((a, b) => b.mean - a.mean);

console.log(
  'repo                                              mean ± std    range            n   risks',
);
console.log(
  '────                                              ──────────    ─────            ─   ─────',
);
for (const r of rows) {
  const repo = r.repo.padEnd(48);
  const mean = r.mean.toFixed(1).padStart(5);
  const std = r.std.toFixed(1).padStart(4);
  const rng = `[${r.min.toFixed(1)}, ${r.max.toFixed(1)}]`.padEnd(15);
  const risks = r.risks.join('/');
  console.log(`${repo}  ${mean}% ± ${std}%  ${rng}  ${r.n}   ${risks}`);
}
