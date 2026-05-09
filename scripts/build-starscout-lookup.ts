#!/usr/bin/env -S npx tsx
/**
 * Build the StarScout lookup table from their published CSVs.
 *
 * Inputs:
 *   data/starscout/low_activity_250101.csv  — 4,905 repos flagged via the
 *                                             low-activity heuristic
 *   data/starscout/clustered_250101.csv     — 8,895 repos flagged via the
 *                                             lockstep (CopyCatch) heuristic
 *
 * Output:
 *   worker/src/starscout-lookup.json — { "owner/name": { ... }, ... }
 *
 * The Worker bundles this JSON at deploy time. ~13k entries × ~80 bytes
 * each = ~1 MB. Workers free tier allows 10 MB script size, so we have
 * plenty of room.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface StarScoutEntry {
  /** Total stars at scan time (2025-01-01 snapshot) */
  totalStars: number;
  /** Stars flagged as fake by ANY heuristic */
  fakeStars: number;
  /** Fraction of stars flagged as fake (0..1) */
  fakeRatio: number;
  /** Which heuristic(s) caught this repo */
  detectedBy: ('low-activity' | 'lockstep')[];
  /** Snapshot date — informs the user how stale this verdict is */
  snapshot: string;
}

const SNAPSHOT_DATE = '2025-01-01';

const out: Record<string, StarScoutEntry> = {};

function parseCsv(path: string): Array<Record<string, string>> {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cells[i] ?? '';
    return row;
  });
}

console.error('[lookup] reading low-activity csv…');
const low = parseCsv(resolve(ROOT, 'data/starscout/low_activity_250101.csv'));
for (const row of low) {
  const repoName = row['repo_name']?.trim();
  if (!repoName || !repoName.includes('/')) continue;
  const totalStars = parseInt(row['n_stars'], 10) || 0;
  const fakeStars = parseInt(row['n_stars_low_activity'], 10) || 0;
  const ratio = parseFloat(row['p_stars_low_activity']) || 0;
  out[repoName.toLowerCase()] = {
    totalStars,
    fakeStars,
    fakeRatio: ratio,
    detectedBy: ['low-activity'],
    snapshot: SNAPSHOT_DATE,
  };
}
console.error(`[lookup] loaded ${low.length} low-activity repos`);

console.error('[lookup] reading clustered (lockstep) csv…');
const clustered = parseCsv(resolve(ROOT, 'data/starscout/clustered_250101.csv'));
for (const row of clustered) {
  const repoName = row['repo_name']?.trim();
  if (!repoName || !repoName.includes('/')) continue;
  const key = repoName.toLowerCase();
  const totalStars = parseInt(row['n_stars'], 10) || 0;
  const fakeStars = parseInt(row['n_stars_clustered'], 10) || 0;
  const ratio = parseFloat(row['p_stars_clustered']) || 0;

  if (out[key]) {
    // Already detected by low-activity. Merge: take the larger fake count
    // and add lockstep to detectedBy.
    const existing = out[key];
    out[key] = {
      totalStars: Math.max(existing.totalStars, totalStars),
      fakeStars: Math.max(existing.fakeStars, fakeStars),
      fakeRatio: Math.max(existing.fakeRatio, ratio),
      detectedBy: [...existing.detectedBy, 'lockstep'],
      snapshot: SNAPSHOT_DATE,
    };
  } else {
    out[key] = {
      totalStars,
      fakeStars,
      fakeRatio: ratio,
      detectedBy: ['lockstep'],
      snapshot: SNAPSHOT_DATE,
    };
  }
}
console.error(`[lookup] loaded ${clustered.length} clustered repos`);

const totalEntries = Object.keys(out).length;
console.error(`[lookup] merged → ${totalEntries} unique repos`);

const outPath = resolve(ROOT, 'worker/src/starscout-lookup.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out));
const bytes = readFileSync(outPath).byteLength;
console.error(`[lookup] wrote ${(bytes / 1024).toFixed(1)} KB → ${outPath}`);
