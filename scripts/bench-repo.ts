#!/usr/bin/env -S npx tsx
/**
 * Batch benchmark: runs the LIVE extension algorithm against a set of
 * repos and prints a one-line summary per repo + final JSON dump.
 *
 * This script imports the same algorithm pieces the extension's
 * `analyze.ts` uses, so its output matches what the extension would
 * show on a real GitHub page — unlike `calibrate.ts` which has a
 * separate (and historically buggy) pipeline.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx tsx scripts/bench-repo.ts owner/r1,owner/r2,...
 */

import { detectBursts } from '../src/shared/mad';
import { validateBurst } from '../src/shared/validation';
import { fetchStargazers } from '../src/background/github';

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_STARGAZER_LIMIT = 5000;

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN');
  process.exit(1);
}

const [, , reposArg] = process.argv;
if (!reposArg) {
  console.error('Usage: npx tsx scripts/bench-repo.ts owner/r1,owner/r2,...');
  process.exit(1);
}
const repos = reposArg.split(',').map((r) => r.trim());

async function gh(path: string): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'real-stars-bench/1.0',
    },
  });
}

async function fetchRepoMetadata(owner: string, repo: string) {
  const r = await gh(`/repos/${owner}/${repo}`);
  if (!r.ok) throw new Error(`metadata: ${r.status}`);
  return r.json() as Promise<{ stargazers_count: number; forks_count: number }>;
}

async function fetchForkTimeseries(owner: string, repo: string, maxForks = 1000) {
  const perPage = 100;
  const buckets = new Map<string, number>();
  for (let page = 1; page <= Math.ceil(maxForks / perPage); page++) {
    const r = await gh(
      `/repos/${owner}/${repo}/forks?per_page=${perPage}&page=${page}&sort=newest`,
    );
    if (!r.ok) break;
    const items = (await r.json()) as Array<{ created_at: string }>;
    if (items.length === 0) break;
    for (const item of items) {
      if (!item.created_at) continue;
      const day = item.created_at.slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    if (items.length < perPage) break;
  }
  return [...buckets.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface Result {
  repo: string;
  totalStars: number;
  forks: number;
  forkRatio: number;
  analyzed: number;
  burstsTotal: number;
  burstsOrganic: number;
  burstsSuspicious: number;
  suspiciousStars: number;
  fakePercent: number;
  bursts: Array<{
    startDate: string;
    endDate: string;
    days: number;
    stars: number;
    forkDelta: number;
    forkRatio: number;
    verdict: string;
  }>;
}

const results: Result[] = [];

for (const repoPath of repos) {
  const [owner, repo] = repoPath.split('/');
  if (!owner || !repo) {
    console.error(`skip bad path: ${repoPath}`);
    continue;
  }
  console.error(`▶ ${repoPath}…`);
  try {
    const meta = await fetchRepoMetadata(owner, repo);
    const stargazers = await fetchStargazers(owner, repo, TOKEN!, DEFAULT_STARGAZER_LIMIT);
    const forkSeries = await fetchForkTimeseries(owner, repo);
    const bursts = detectBursts(stargazers);
    const validated = bursts.map((b) => ({
      ...b,
      validation: validateBurst(b, forkSeries, []),
    }));

    const suspiciousStars = validated
      .filter((b) => b.validation.verdict !== 'organic')
      .reduce((s, b) => s + b.stars, 0);

    const fakePercent =
      meta.stargazers_count > 0 ? (suspiciousStars / meta.stargazers_count) * 100 : 0;

    const burstsOrganic = validated.filter((b) => b.validation.verdict === 'organic').length;
    const burstsSuspicious = validated.length - burstsOrganic;

    const result: Result = {
      repo: repoPath,
      totalStars: meta.stargazers_count,
      forks: meta.forks_count,
      forkRatio: meta.stargazers_count > 0 ? meta.forks_count / meta.stargazers_count : 0,
      analyzed: stargazers.length,
      burstsTotal: bursts.length,
      burstsOrganic,
      burstsSuspicious,
      suspiciousStars,
      fakePercent: +fakePercent.toFixed(2),
      bursts: validated.map((b) => ({
        startDate: b.startDate,
        endDate: b.endDate,
        days: b.days,
        stars: b.stars,
        forkDelta: b.validation.forkDelta,
        forkRatio: +b.validation.forkRatio.toFixed(3),
        verdict: b.validation.verdict,
      })),
    };
    results.push(result);
    console.error(
      `  → ${result.fakePercent}% (${result.burstsTotal} bursts: ${result.burstsOrganic} organic, ${result.burstsSuspicious} suspicious)`,
    );
  } catch (err) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log('\n=== RESULTS ===');
console.log(JSON.stringify(results, null, 2));
