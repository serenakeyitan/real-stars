#!/usr/bin/env -S npx tsx
/**
 * Build a calibration seed list using StarScout's published ground truth.
 *
 * StarScout (ICSE 2026) published repo_labels.csv with 581 manually-labeled
 * repos. Their `ai_label` column has these values:
 *   - "suspicious" → flagged as having fake stars (103 repos)
 *   - "ai" / "blockchain" / "web" / "tool/application" / etc → legitimate
 *     domain (478 repos; these passed StarScout's filters and got
 *     a real-product domain classification)
 *
 * We sample N repos from each side, check that they're still accessible on
 * GitHub (a chunk of fake-suspect repos get deleted by GitHub T&S — the
 * paper's headline finding), and write a calibration-repos.json our
 * calibrate.ts script can consume.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx pnpm tsx scripts/build-starscout-seeds.ts
 *   GITHUB_TOKEN=ghp_xxx pnpm tsx scripts/build-starscout-seeds.ts --suspicious 10 --organic 10
 *   GITHUB_TOKEN=ghp_xxx pnpm tsx scripts/build-starscout-seeds.ts --out scripts/calibration-repos-starscout.json
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN env var.');
  process.exit(1);
}

const args = process.argv.slice(2);
const nSuspicious = parseInt(takeOpt(args, '--suspicious') ?? '10', 10);
const nOrganic = parseInt(takeOpt(args, '--organic') ?? '10', 10);
const outPath = takeOpt(args, '--out') ?? resolve(ROOT, 'scripts/calibration-repos-starscout.json');
const cachePath = resolve(ROOT, 'scripts/.starscout-labels-cache.csv');

const STARSCOUT_LABELS_URL =
  'https://raw.githubusercontent.com/hehao98/StarScout/main/data/repo_labels.csv';

console.error(`[seeds] target: ${nSuspicious} suspicious + ${nOrganic} organic`);

let csv: string;
if (existsSync(cachePath)) {
  console.error(`[seeds] using cached labels at ${cachePath}`);
  csv = readFileSync(cachePath, 'utf8');
} else {
  console.error(`[seeds] downloading ${STARSCOUT_LABELS_URL}…`);
  const resp = await fetch(STARSCOUT_LABELS_URL);
  if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
  csv = await resp.text();
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, csv);
}

const lines = csv.split('\n').filter(Boolean);
const header = lines.shift()!.split(',');
const repoIdx = header.indexOf('repo');
const aiLabelIdx = header.indexOf('ai_label');
if (repoIdx < 0 || aiLabelIdx < 0) throw new Error(`unexpected CSV headers: ${header}`);

interface LabeledRepo {
  repo: string;
  label: string;
}

const allLabeled: LabeledRepo[] = lines
  .map((line) => {
    const parts = line.split(',');
    return { repo: parts[repoIdx]?.trim() ?? '', label: parts[aiLabelIdx]?.trim() ?? '' };
  })
  .filter((r) => r.repo && r.label);

const suspiciousPool = allLabeled.filter((r) => r.label === 'suspicious');
const organicPool = allLabeled.filter((r) => r.label !== 'suspicious' && r.label !== '');
console.error(
  `[seeds] StarScout pool: ${suspiciousPool.length} suspicious, ${organicPool.length} organic`,
);

// Deterministic shuffle (so re-runs pick the same seeds when StarScout's CSV
// hasn't changed — keeps calibration reports comparable across runs).
shuffleInPlace(suspiciousPool, 'real-stars-suspicious');
shuffleInPlace(organicPool, 'real-stars-organic');

const susResults = await pickAccessible(suspiciousPool, nSuspicious, 'fake-suspect');
const orgResults = await pickAccessible(organicPool, nOrganic, 'organic');

const seedFile = [
  ...susResults.map((r) => ({
    repo: r.repo,
    expected: 'fake-suspect' as const,
    reason: `StarScout ai_label="${r.starscoutLabel}" — flagged as having fake stars`,
  })),
  ...orgResults.map((r) => ({
    repo: r.repo,
    expected: 'organic' as const,
    reason: `StarScout ai_label="${r.starscoutLabel}" — classified as legitimate domain`,
  })),
];

writeFileSync(outPath, JSON.stringify(seedFile, null, 2) + '\n');
console.error(`[seeds] wrote ${seedFile.length} seeds → ${outPath}`);
console.log(JSON.stringify(seedFile, null, 2));

// ────────────────────────────────────────────────────────────────────────

interface AccessibleResult {
  repo: string;
  starscoutLabel: string;
}

async function pickAccessible(
  pool: LabeledRepo[],
  target: number,
  mode: 'fake-suspect' | 'organic',
): Promise<AccessibleResult[]> {
  const out: AccessibleResult[] = [];
  let i = 0;
  while (out.length < target && i < pool.length) {
    const candidate = pool[i++];
    const accessible = await checkAccessible(candidate.repo);
    if (accessible) {
      out.push({ repo: candidate.repo, starscoutLabel: candidate.label });
      console.error(`[seeds]   ✓ ${mode}: ${candidate.repo} (label=${candidate.label})`);
    } else {
      console.error(`[seeds]   ✗ ${mode}: ${candidate.repo} (deleted/private/404)`);
    }
  }
  return out;
}

async function checkAccessible(repo: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'real-stars-calibration',
      },
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

function shuffleInPlace<T>(arr: T[], seed: string): void {
  // Mulberry32 — deterministic shuffle from a string seed
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function takeOpt(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}
