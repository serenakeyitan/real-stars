#!/usr/bin/env -S npx tsx
/**
 * Per-burst diagnostic for a single repo. Dumps each detected burst with:
 *   - start/end date, days, star count
 *   - MAD median/spike-ratio (how anomalous it was)
 *   - cross-validation: fork-delta, fork-ratio, referrer evidence
 *   - final verdict (organic | suspicious | fake)
 *
 * Goal: figure out WHY a specific burst gets classified suspicious, so we
 * can decide whether the validation is right or has a real bug.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx tsx scripts/diagnose-repo.ts owner/repo
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

const [, , repoArg] = process.argv;
if (!repoArg || !repoArg.includes('/')) {
  console.error('Usage: npx tsx scripts/diagnose-repo.ts owner/repo');
  process.exit(1);
}
const [owner, repo] = repoArg.split('/');

async function gh(path: string): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'real-stars-diagnose/1.0',
    },
  });
}

async function fetchRepoMetadata() {
  const r = await gh(`/repos/${owner}/${repo}`);
  if (!r.ok) throw new Error(`metadata: ${r.status}`);
  return r.json();
}

async function fetchForkTimeseries(maxForks = 1000) {
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

(async () => {
  console.log(`\n▶ diagnosing ${owner}/${repo}\n`);
  const meta = await fetchRepoMetadata();
  console.log(`  total stars: ${meta.stargazers_count}`);
  console.log(`  total forks: ${meta.forks_count}`);
  console.log(`  fork ratio:  ${((meta.forks_count / meta.stargazers_count) * 100).toFixed(1)}%`);

  console.log(`\n▶ fetching stargazers (limit ${DEFAULT_STARGAZER_LIMIT})…`);
  const stargazers = await fetchStargazers(owner, repo, TOKEN!, DEFAULT_STARGAZER_LIMIT);
  console.log(`  fetched ${stargazers.length}`);
  console.log(`  first: ${stargazers[0]?.starredAt.toISOString().slice(0, 10)}`);
  console.log(
    `  last:  ${stargazers[stargazers.length - 1]?.starredAt.toISOString().slice(0, 10)}`,
  );

  console.log(`\n▶ fetching forks timeseries…`);
  const forkSeries = await fetchForkTimeseries();
  console.log(`  ${forkSeries.length} days with forks`);
  const totalForkBursts = forkSeries.reduce((s, f) => s + f.count, 0);
  console.log(`  total forks in window: ${totalForkBursts}`);

  console.log(`\n▶ detecting bursts…`);
  const bursts = detectBursts(stargazers);
  console.log(`  ${bursts.length} bursts found\n`);

  let totalSuspiciousStars = 0;
  for (let i = 0; i < bursts.length; i++) {
    const b = bursts[i];
    const v = validateBurst(b, forkSeries, []);
    const symbol = v.verdict === 'organic' ? '✓' : v.verdict === 'fake' ? '🚨' : '⚠';
    console.log(`${symbol} Burst #${i + 1}: ${b.startDate} → ${b.endDate} (${b.days} days)`);
    console.log(`    stars:        ${b.stars}`);
    console.log(`    median(prev): ${b.median.toFixed(1)}`);
    console.log(`    MAD:          ${b.mad.toFixed(1)}`);
    console.log(`    spikeRatio:   ${b.spikeRatio.toFixed(1)}× above median`);
    console.log(`    forkDelta:    ${v.forkDelta} (in burst window)`);
    console.log(`    forkRatio:    ${(v.forkRatio * 100).toFixed(2)}% (forks/stars in this burst)`);
    console.log(`    referrers:    ${v.hasReferrerEvidence ? v.topReferrers.join(', ') : 'none'}`);
    console.log(
      `    VERDICT:      ${v.verdict.toUpperCase()} (confidence ${v.confidence.toFixed(2)})`,
    );
    if (v.verdict !== 'organic') totalSuspiciousStars += b.stars;
    console.log();
  }

  const fakePct =
    meta.stargazers_count > 0 ? (totalSuspiciousStars / meta.stargazers_count) * 100 : 0;
  console.log(`▶ Summary:`);
  console.log(`  total suspicious stars: ${totalSuspiciousStars}`);
  console.log(`  fakePercent:            ${fakePct.toFixed(2)}%\n`);
})();
