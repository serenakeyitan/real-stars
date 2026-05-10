#!/usr/bin/env -S npx tsx
/**
 * Calibration: run real-stars' detection pipeline against a curated list of
 * GitHub repos and print a markdown report comparing results to expectations.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx pnpm calibrate
 *   GITHUB_TOKEN=ghp_xxx pnpm calibrate --repos owner/name,owner2/name2
 *   GITHUB_TOKEN=ghp_xxx pnpm calibrate --out calibration-report.md
 *
 * Default: reads scripts/calibration-repos.json (curated seed list) and writes
 * to stdout + calibration/report-{timestamp}.md.
 *
 * IMPORTANT: this is a research/diagnostic tool, not a production code path.
 * It runs the SAME algorithm as the extension (imported from src/shared/) but
 * with its own CLI fetcher (no chrome.storage, no chrome.identity).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectBursts } from '../src/shared/mad';
import { validateBurst } from '../src/shared/validation';
import { fetchStargazers as fetchStargazersFromSrc } from '../src/background/github';
import {
  GITHUB_API_BASE,
  DEFAULT_STARGAZER_LIMIT,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
} from '../src/shared/constants';
import type { ForkPoint, ReferrerSnapshot } from '../src/shared/types';

// Re-implement userScore inline for the calibration script — chrome.storage
// caching from src/background/userScore.ts requires a chrome environment
// that doesn't exist in Node. Logic mirrors that module exactly.

const USER_SUSPICIOUS_THRESHOLD = 4.0;
const USER_FETCH_CONCURRENCY = 6;
const USER_SAMPLE_SIZE = 200;

interface UserScoreLite {
  login: string;
  score: number;
  suspicious: boolean;
}

async function scoreUserCli(login: string): Promise<UserScoreLite | null> {
  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API_BASE}/users/${encodeURIComponent(login)}`, {
      headers: {
        Authorization: `Bearer ${TOKEN!}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return null;
  }
  if (resp.status === 404) {
    return { login, score: 5.0, suspicious: true };
  }
  if (!resp.ok) return null;
  const u = (await resp.json()) as {
    login: string;
    created_at: string;
    followers: number;
    public_repos: number;
    gravatar_id?: string;
    avatar_url?: string;
  };
  const ageDays = (Date.now() - new Date(u.created_at).getTime()) / 86400000;
  let score = 0;
  if (ageDays < 30) score += 2.0;
  if (u.followers === 0) score += 1.5;
  else if (u.followers < 5) score += 0.5;
  if (u.public_repos === 0) score += 1.5;
  else if (u.public_repos < 2) score += 0.5;
  const hasCustomAvatar = !!u.avatar_url && /\?(v=|u=)/.test(u.avatar_url);
  const noGravatar = !u.gravatar_id || u.gravatar_id === '';
  if (!hasCustomAvatar && noGravatar) score += 0.5;
  if (u.followers === 0 && u.public_repos === 0) score += 1.0;
  return { login: u.login, score, suspicious: score >= USER_SUSPICIOUS_THRESHOLD };
}

async function scoreUsersCli(logins: string[]): Promise<UserScoreLite[]> {
  const out: UserScoreLite[] = [];
  for (let i = 0; i < logins.length; i += USER_FETCH_CONCURRENCY) {
    const batch = logins.slice(i, i + USER_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(scoreUserCli));
    for (const r of settled) if (r.status === 'fulfilled' && r.value) out.push(r.value);
  }
  return out;
}

function sampleUsersCli(users: string[], n: number, seed: string): string[] {
  if (users.length <= n) return [...users];
  // Allow a CALIBRATE_RUN_ID env var to vary the seed across runs of the
  // same repo, so multiple passes produce different samples and we can
  // estimate variance.
  const fullSeed = seed + (process.env.CALIBRATE_RUN_ID ?? '');
  let h = 2166136261;
  for (let i = 0; i < fullSeed.length; i++) {
    h ^= fullSeed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const indices = new Set<number>();
  while (indices.size < n) indices.add(Math.floor(rng() * users.length));
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => users[i]);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GITHUB_API = 'https://api.github.com';

interface SeedEntry {
  repo: string;
  expected: 'organic' | 'fake-suspect' | 'unknown';
  reason: string;
}

interface RepoResult {
  repo: string;
  expected: SeedEntry['expected'];
  expectedReason: string;
  totalStars: number;
  analyzedStars: number;
  bursts: number;
  organicBursts: number;
  suspiciousBursts: number;
  fakeBursts: number;
  suspiciousStars: number;
  fakePercent: number;
  riskLevel: 'low' | 'medium' | 'high';
  match: 'agree' | 'disagree' | 'inconclusive';
  warning?: string;
  error?: string;
  durationMs: number;
}

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('Set GITHUB_TOKEN env var (a fine-grained PAT with public_repo read access).');
  process.exit(1);
}

const args = process.argv.slice(2);
const reposArg = takeOpt(args, '--repos');
const seedsArg = takeOpt(args, '--seeds');
const outArg = takeOpt(args, '--out');
const limitArg = takeOpt(args, '--limit');
const stargazerLimit = limitArg ? parseInt(limitArg, 10) : DEFAULT_STARGAZER_LIMIT;

// Always load the canonical seeds file so we have expected labels available
// even when --repos is used to subset the run. Default seeds path lives at
// scripts/calibration-repos.json; --seeds overrides it.
const seedPath = seedsArg
  ? resolve(ROOT, seedsArg)
  : resolve(ROOT, 'scripts/calibration-repos.json');
const seedFile: SeedEntry[] = JSON.parse(readFileSync(seedPath, 'utf8'));
const seedIndex = new Map(seedFile.map((s) => [s.repo, s]));

let seeds: SeedEntry[];
if (reposArg) {
  seeds = reposArg.split(',').map((r) => {
    const repo = r.trim();
    const known = seedIndex.get(repo);
    if (known) return known;
    return { repo, expected: 'unknown' as const, reason: 'CLI override (no seed entry)' };
  });
} else {
  seeds = seedFile;
}

console.error(
  `[calibrate] running against ${seeds.length} repo(s), stargazer limit=${stargazerLimit}…`,
);

const results: RepoResult[] = [];
for (const seed of seeds) {
  const t0 = Date.now();
  console.error(`[calibrate] → ${seed.repo} (expected: ${seed.expected})`);
  try {
    const result = await analyzeOne(seed, stargazerLimit);
    results.push({ ...result, durationMs: Date.now() - t0 });
    console.error(
      `   analyzed=${result.analyzedStars}, bursts=${result.bursts}, fake%=${result.fakePercent.toFixed(1)}, risk=${result.riskLevel}, match=${result.match}`,
    );
  } catch (err) {
    results.push({
      repo: seed.repo,
      expected: seed.expected,
      expectedReason: seed.reason,
      totalStars: 0,
      analyzedStars: 0,
      bursts: 0,
      organicBursts: 0,
      suspiciousBursts: 0,
      fakeBursts: 0,
      suspiciousStars: 0,
      fakePercent: 0,
      riskLevel: 'low',
      match: 'inconclusive',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    });
    console.error(`   ERROR: ${err instanceof Error ? err.message : err}`);
  }
}

const reportMd = renderReport(results);
const reportDir = resolve(ROOT, 'calibration');
mkdirSync(reportDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportPath = outArg ? resolve(ROOT, outArg) : resolve(reportDir, `report-${stamp}.md`);
writeFileSync(reportPath, reportMd);
console.error(`\n[calibrate] report → ${reportPath}`);
console.log(reportMd);

// ────────────────────────────────────────────────────────────────────────

async function analyzeOne(seed: SeedEntry, limit: number): Promise<Omit<RepoResult, 'durationMs'>> {
  const [owner, name] = seed.repo.split('/');
  if (!owner || !name) throw new Error(`invalid repo: ${seed.repo}`);

  const meta = await fetchRepoMetadata(owner, name);
  const stargazers = await fetchStargazersFromSrc(owner, name, TOKEN!, limit);
  const bursts = detectBursts(stargazers);

  let forkSeries: ForkPoint[] = [];
  let referrers: ReferrerSnapshot[] = [];
  if (bursts.length > 0) {
    try {
      forkSeries = await fetchForkTimeseries(owner, name);
    } catch {
      /* best-effort */
    }
    try {
      referrers = await fetchTrafficReferrers(owner, name);
    } catch {
      /* requires push access; expected to 403 */
    }
  }

  const initialValidated = bursts.map((b) => ({
    ...b,
    validation: validateBurst(b, forkSeries, referrers),
  }));

  // Global per-user analysis on the whole stargazer slice (mirrors production).
  const allUsers = stargazers.map((s) => s.username);
  const globalSample = sampleUsersCli(allUsers, USER_SAMPLE_SIZE, `${owner}/${name}`);
  const globalScores = await scoreUsersCli(globalSample);
  const globalSus = globalScores.filter((s) => s.suspicious).length;
  const globalRatio = globalScores.length > 0 ? globalSus / globalScores.length : 0;

  // Per-burst user analysis (mirrors production).
  const burstsNeedingUserAnalysis = initialValidated.filter((b) => b.users.length > 0);
  const userAnalyses = new Map<string, { sampled: number; suspicious: number; ratio: number }>();
  for (const b of burstsNeedingUserAnalysis) {
    const sample = sampleUsersCli(b.users, USER_SAMPLE_SIZE, b.startDate);
    const scores = await scoreUsersCli(sample);
    const sus = scores.filter((s) => s.suspicious).length;
    userAnalyses.set(`${b.startDate}|${b.endDate}`, {
      sampled: scores.length,
      suspicious: sus,
      ratio: scores.length > 0 ? sus / scores.length : 0,
    });
  }

  const validated = initialValidated.map((b) => {
    const ua = userAnalyses.get(`${b.startDate}|${b.endDate}`);
    let v = b.validation;
    if (ua && ua.sampled >= 10) {
      if (ua.ratio >= 0.6) {
        v = {
          ...b.validation,
          verdict: 'fake',
          confidence: Math.max(b.validation.confidence, 0.85),
        };
      } else if (ua.ratio <= 0.1) {
        v = {
          ...b.validation,
          verdict: 'organic',
          confidence: Math.max(b.validation.confidence, 0.85),
        };
      }
    }
    return { ...b, validation: v, userAnalysis: ua };
  });

  const organicBursts = validated.filter((b) => b.validation.verdict === 'organic').length;
  const suspiciousBursts = validated.filter((b) => b.validation.verdict === 'suspicious').length;
  const fakeBursts = validated.filter((b) => b.validation.verdict === 'fake').length;

  // Same dual-signal logic as production.
  const burstSuspiciousStars = validated
    .filter((b) => b.validation.verdict !== 'organic')
    .reduce((s, b) => {
      if (b.userAnalysis && b.userAnalysis.sampled >= 10) {
        return s + Math.round(b.stars * b.userAnalysis.ratio);
      }
      return s + b.stars;
    }, 0);
  const globalSuspiciousStars =
    globalScores.length >= 10 ? Math.round(stargazers.length * globalRatio) : 0;
  const suspiciousStars = Math.max(burstSuspiciousStars, globalSuspiciousStars);
  const analyzedTotal = stargazers.length;
  const fakePercent =
    globalScores.length >= 10
      ? globalRatio * 100
      : meta.stargazers_count > 0
        ? (suspiciousStars / meta.stargazers_count) * 100
        : 0;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
  else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

  const match = classifyMatch(seed.expected, riskLevel);

  return {
    repo: seed.repo,
    expected: seed.expected,
    expectedReason: seed.reason,
    totalStars: meta.stargazers_count,
    analyzedStars: analyzedTotal,
    bursts: bursts.length,
    organicBursts,
    suspiciousBursts,
    fakeBursts,
    suspiciousStars,
    fakePercent,
    riskLevel,
    match,
    warning:
      analyzedTotal === limit && meta.stargazers_count > limit
        ? `analyzed ${limit} of ${meta.stargazers_count}`
        : undefined,
  };
}

function classifyMatch(
  expected: SeedEntry['expected'],
  risk: 'low' | 'medium' | 'high',
): 'agree' | 'disagree' | 'inconclusive' {
  if (expected === 'unknown') return 'inconclusive';
  if (expected === 'organic' && risk === 'low') return 'agree';
  if (expected === 'organic' && risk !== 'low') return 'disagree';
  if (expected === 'fake-suspect' && (risk === 'high' || risk === 'medium')) return 'agree';
  if (expected === 'fake-suspect' && risk === 'low') return 'disagree';
  return 'inconclusive';
}

// ─── HTTP layer (mirrors src/background/github.ts but without chrome) ────────

async function gh(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'real-stars-calibration',
      ...headers,
    },
  });
}

async function fetchRepoMetadata(
  owner: string,
  repo: string,
): Promise<{ stargazers_count: number; forks_count: number }> {
  const resp = await gh(`/repos/${owner}/${repo}`);
  if (!resp.ok) throw new Error(`repo metadata: ${resp.status} ${resp.statusText}`);
  return (await resp.json()) as { stargazers_count: number; forks_count: number };
}

async function fetchForkTimeseries(
  owner: string,
  repo: string,
  maxForks = 1000,
): Promise<ForkPoint[]> {
  const perPage = 100;
  const buckets = new Map<string, number>();
  for (let page = 1; page <= Math.ceil(maxForks / perPage); page++) {
    const resp = await gh(
      `/repos/${owner}/${repo}/forks?per_page=${perPage}&page=${page}&sort=newest`,
    );
    if (!resp.ok) break;
    const items = (await resp.json()) as Array<{ created_at: string }>;
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

async function fetchTrafficReferrers(owner: string, repo: string): Promise<ReferrerSnapshot[]> {
  const resp = await gh(`/repos/${owner}/${repo}/traffic/popular/referrers`);
  if (!resp.ok) return [];
  return (await resp.json()) as ReferrerSnapshot[];
}

// ─── Reporting ────────────────────────────────────────────────────────────

function renderReport(rows: RepoResult[]): string {
  const summaryAgree = rows.filter((r) => r.match === 'agree').length;
  const summaryDisagree = rows.filter((r) => r.match === 'disagree').length;
  const summaryInconclusive = rows.filter((r) => r.match === 'inconclusive').length;
  const errored = rows.filter((r) => r.error).length;

  const lines: string[] = [];
  lines.push(`# real-stars calibration report`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- ✅ Agree:        **${summaryAgree}** / ${rows.length}`);
  lines.push(`- ❌ Disagree:     **${summaryDisagree}** / ${rows.length}`);
  lines.push(`- ⚪ Inconclusive: ${summaryInconclusive} / ${rows.length}`);
  if (errored) lines.push(`- ⚠️ Errored:      ${errored} / ${rows.length}`);
  lines.push('');
  lines.push('A "match" means the algorithm agreed with the curated expectation:');
  lines.push('');
  lines.push('| Expected      | Algorithm risk          | Match     |');
  lines.push('| ------------- | ----------------------- | --------- |');
  lines.push('| organic       | low                     | agree     |');
  lines.push('| organic       | medium / high           | disagree  |');
  lines.push('| fake-suspect  | medium / high           | agree     |');
  lines.push('| fake-suspect  | low                     | disagree  |');
  lines.push('| unknown       | (any)                   | inconclusive |');
  lines.push('');
  lines.push(`## Details`);
  lines.push('');
  lines.push(
    '| Repo | Stars | Analyzed | Bursts (org/sus/fake) | Suspicious % | Risk | Expected | Match | Notes |',
  );
  lines.push(
    '| ---- | ----- | -------- | --------------------- | ------------ | ---- | -------- | ----- | ----- |',
  );
  for (const r of rows) {
    if (r.error) {
      lines.push(
        `| [${r.repo}](https://github.com/${r.repo}) | — | — | — | — | — | ${r.expected} | ⚠️ | error: \`${r.error}\` |`,
      );
      continue;
    }
    const matchIcon = r.match === 'agree' ? '✅' : r.match === 'disagree' ? '❌' : '⚪';
    lines.push(
      `| [${r.repo}](https://github.com/${r.repo}) | ${r.totalStars.toLocaleString()} | ${r.analyzedStars.toLocaleString()} | ${r.organicBursts}/${r.suspiciousBursts}/${r.fakeBursts} | ${r.fakePercent.toFixed(1)}% | ${r.riskLevel} | ${r.expected} | ${matchIcon} | ${r.warning ?? r.expectedReason} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function takeOpt(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}
