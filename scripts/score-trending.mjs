#!/usr/bin/env node
/**
 * Score each trending repo with the full real-stars algorithm.
 *
 * Inputs:
 *   site/data/trending.json         — daily/weekly/monthly trending lists
 *   site/data/trending-scored.json  — previous results (preserved + refreshed)
 *   scripts/.user-cache.json        — per-user score cache (7-day TTL)
 *   $GITHUB_TOKEN                   — required (Actions provides automatically)
 *
 * Output:
 *   site/data/trending-scored.json  — { repo, fakePercent, riskLevel, ... }
 *
 * Behavior:
 *   • Dedups across daily/weekly/monthly so we score each repo at most once
 *   • Skips repos whose previous score is fresher than SCORE_TTL_HOURS
 *   • Catches rate-limit errors and stops cleanly (preserves partial progress)
 *   • Cache is persisted between runs via GitHub Actions cache (out of band)
 *
 * Run from repo root:  node scripts/score-trending.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemCache, scoreRepo } from './_score-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const TRENDING_PATH = resolve(REPO_ROOT, 'site/data/trending.json');
const SCORED_PATH = resolve(REPO_ROOT, 'site/data/trending-scored.json');

// Reverted to 24h on 2026-05-12 alongside the n=400→200 revert. The 12h
// TTL was paired with the doubled sample size; without that, 24h keeps
// each run cheap and well within the 5000/hr rate limit.
const SCORE_TTL_HOURS = 24;
const MAX_API_BUDGET = 4500; // soft cap per run — leaves buffer under 5000/hr

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('[score-trending] missing $GITHUB_TOKEN');
  process.exit(1);
}

console.error('[score-trending] loading inputs…');
const trending = JSON.parse(readFileSync(TRENDING_PATH, 'utf8'));

let prior = { scores: {}, scoredAt: null };
if (existsSync(SCORED_PATH)) {
  try {
    prior = JSON.parse(readFileSync(SCORED_PATH, 'utf8'));
    if (!prior.scores) prior.scores = {};
  } catch (err) {
    console.error(`[score-trending] previous results unreadable (${err.message}); starting fresh`);
  }
}

// Dedup the trending list across daily/weekly/monthly
const allTrending = [];
const seen = new Set();
for (const period of ['daily', 'weekly', 'monthly']) {
  for (const r of trending[period] ?? []) {
    const key = r.repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    allTrending.push(r);
  }
}
console.error(`[score-trending] ${allTrending.length} unique trending repos`);

// Drop scores whose entry is no longer in trending (housekeeping)
const trendingKeys = new Set(allTrending.map((r) => r.repo.toLowerCase()));
const beforePrune = Object.keys(prior.scores).length;
for (const k of Object.keys(prior.scores)) {
  if (!trendingKeys.has(k)) delete prior.scores[k];
}
const pruned = beforePrune - Object.keys(prior.scores).length;
if (pruned > 0) console.error(`[score-trending] pruned ${pruned} stale entries`);

const cache = new FileSystemCache();
const startApi = await currentRateLimit(token);
console.error(`[score-trending] rate limit at start: ${startApi.remaining}/${startApi.limit}`);

const now = Date.now();
const TTL_MS = SCORE_TTL_HOURS * 60 * 60 * 1000;

const toScore = [];
let freshSkipped = 0;
for (const r of allTrending) {
  const key = r.repo.toLowerCase();
  const existing = prior.scores[key];
  if (existing && now - existing.scoredAt < TTL_MS) {
    freshSkipped++;
    continue;
  }
  toScore.push(r);
}
console.error(`[score-trending] ${freshSkipped} fresh (<${SCORE_TTL_HOURS}h), ${toScore.length} to score`);

let scoredCount = 0,
  errorCount = 0,
  insufficientCount = 0,
  budgetExhausted = false;

for (const r of toScore) {
  const [owner, repo] = r.repo.split('/');
  if (!owner || !repo) {
    console.error(`[score-trending] skipping malformed: ${r.repo}`);
    continue;
  }

  // Check budget before each repo — leaves room for the next one even if it spikes
  const rateBefore = await currentRateLimit(token);
  if (startApi.remaining - rateBefore.remaining > MAX_API_BUDGET) {
    console.error(
      `[score-trending] API budget reached (${startApi.remaining - rateBefore.remaining} used); deferring rest`,
    );
    budgetExhausted = true;
    break;
  }

  console.error(`[score-trending] ▶ ${r.repo} (rate left: ${rateBefore.remaining})`);
  const t0 = Date.now();
  try {
    const result = await scoreRepo(owner, repo, token, cache);
    prior.scores[r.repo.toLowerCase()] = {
      repo: r.repo,
      totalStars: result.totalStars,
      analyzedStars: result.analyzedStars,
      fakePercent: result.fakePercent,
      riskLevel: result.riskLevel,
      suspiciousStars: result.suspiciousStars,
      realStars: result.realStars,
      insufficientData: result.insufficientData ?? false,
      bursts: result.bursts,
      validatedBursts: result.validatedBursts,
      sampleSize: result.globalUserAnalysis?.sampled ?? 0,
      suspiciousSampleRatio: result.globalUserAnalysis?.suspiciousRatio ?? null,
      burstVerdicts: result.burstVerdicts ?? [],
      warning: result.warning ?? null,
      scoredAt: Date.now(),
    };
    scoredCount++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const verdict = result.insufficientData
      ? 'insufficient'
      : `${result.fakePercent}% (${result.riskLevel})`;
    console.error(`[score-trending]   ✓ ${verdict} in ${elapsed}s`);
    if (result.insufficientData) insufficientCount++;
  } catch (err) {
    if (err.isRateLimit) {
      console.error(`[score-trending] ⚠ rate-limited mid-batch; saving progress and exiting`);
      budgetExhausted = true;
      break;
    }
    if (err.is404) {
      // Repo deleted between scrape and score. Mark and skip.
      prior.scores[r.repo.toLowerCase()] = {
        repo: r.repo,
        deleted: true,
        scoredAt: Date.now(),
      };
      console.error(`[score-trending]   ✗ 404 (deleted)`);
      errorCount++;
      continue;
    }
    console.error(`[score-trending]   ✗ ${err.message}`);
    errorCount++;
  }
}

cache.save();

const out = {
  scoredAt: new Date().toISOString(),
  ttlHours: SCORE_TTL_HOURS,
  totalScored: Object.keys(prior.scores).length,
  cacheSize: cache.size(),
  scores: prior.scores,
};
writeFileSync(SCORED_PATH, JSON.stringify(out, null, 2));
console.error(`[score-trending] wrote ${SCORED_PATH}`);
console.error(
  `[score-trending] summary: scored=${scoredCount} fresh=${freshSkipped} errors=${errorCount} insufficient=${insufficientCount} budgetExhausted=${budgetExhausted}`,
);

async function currentRateLimit(token) {
  try {
    const resp = await fetch('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'real-stars-score-trending/1.0',
      },
    });
    if (!resp.ok) return { remaining: 5000, limit: 5000 };
    const data = await resp.json();
    return { remaining: data.rate.remaining, limit: data.rate.limit };
  } catch {
    return { remaining: 5000, limit: 5000 };
  }
}
