#!/usr/bin/env node
/**
 * Real-stars scoring library — node-compatible mirror of the Chrome extension.
 *
 * ⚠️  MIRROR OF src/background/userScore.ts + src/background/analyze.ts ⚠️
 *     If you change scoring weights, sample sizes, or the verdict gates
 *     in EITHER place, update the other or run scripts/calibrate.ts to
 *     verify the calibration baseline still passes.
 *
 * The two sides differ only in their CACHE layer:
 *   - extension:  chrome.storage.local (per-browser, 7-day TTL)
 *   - script:     ./scripts/.user-cache.json (single file, 7-day TTL)
 *
 * Public surface:
 *   scoreRepo(owner, repo, token, cache, opts) → result
 *   FileSystemCache class
 *
 * Designed to be called from scripts/score-trending.mjs and any other
 * batch job that needs the full algorithm.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── algorithm constants (mirrored from src/shared/constants.ts) ─────────
export const GITHUB_API_BASE = 'https://api.github.com';
export const STARGAZERS_PER_PAGE = 100;
export const DEFAULT_STARGAZER_LIMIT = 5000;
export const MIN_STARS_FOR_VERDICT = 1000;
// Statistically: 400 samples → ±3.5% at 95% binomial CI (was ±5% at 200).
// Doubling the sample is cheap thanks to the 30-day cache (was 7d): in
// steady state, >95% of users on trending repos are already cached.
export const USER_SAMPLE_SIZE = 400;
export const USER_FETCH_CONCURRENCY = 6;
export const USER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const USER_SUSPICIOUS_THRESHOLD = 4.0;
export const STARGAZER_FETCH_CONCURRENCY = 6;

// MAD detection constants
export const MAD_THRESHOLD = 3.0 * 1.48;
export const WINDOW_SIZE = 28;
export const MIN_STAR_COUNT = 30;
export const MIN_STARS_GROWTH_PERCENT = 300;
export const RISK_HIGH_THRESHOLD = 0.3;
export const RISK_MEDIUM_THRESHOLD = 0.1;

// ─── file-system user cache ──────────────────────────────────────────────
/**
 * One JSON file holds all user scores. Keyed by lowercase login.
 * Entries past TTL are filtered on read. Whole file rewritten on each save
 * — fine because the cache is <1 MB and we only save once per script run.
 */
export class FileSystemCache {
  constructor(path = resolve(__dirname, '.user-cache.json')) {
    this.path = path;
    this.dirty = false;
    this.entries = new Map(); // login → { login, score, suspicious, reasons, computedAt, expiresAt }
    this.load();
  }

  load() {
    if (!existsSync(this.path)) return;
    try {
      const obj = JSON.parse(readFileSync(this.path, 'utf8'));
      const now = Date.now();
      let kept = 0,
        dropped = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (v.expiresAt && now > v.expiresAt) {
          dropped++;
          continue;
        }
        this.entries.set(k, v);
        kept++;
      }
      console.error(`[cache] loaded ${kept} entries (dropped ${dropped} expired)`);
    } catch (err) {
      console.error(`[cache] load failed (${err.message}); starting empty`);
    }
  }

  save() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const obj = Object.fromEntries(this.entries);
    writeFileSync(this.path, JSON.stringify(obj));
    console.error(`[cache] saved ${this.entries.size} entries → ${this.path}`);
    this.dirty = false;
  }

  get(login) {
    return this.entries.get(login.toLowerCase()) ?? null;
  }

  set(login, score) {
    this.entries.set(login.toLowerCase(), {
      ...score,
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
    });
    this.dirty = true;
  }

  size() {
    return this.entries.size;
  }
}

// ─── GitHub fetch with rate-limit awareness ──────────────────────────────
async function gh(path, token, headers = {}) {
  const resp = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'real-stars-score-trending/1.0',
      ...headers,
    },
  });
  if (resp.status === 403 && resp.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = resp.headers.get('X-RateLimit-Reset');
    const resetAt = reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : 'unknown';
    const err = new Error(`rate-limited; resets at ${resetAt}`);
    err.isRateLimit = true;
    err.resetAt = resetAt;
    throw err;
  }
  return resp;
}

// ─── repo metadata ───────────────────────────────────────────────────────
export async function fetchRepoMetadata(owner, repo, token) {
  const resp = await gh(`/repos/${owner}/${repo}`, token);
  if (!resp.ok) {
    if (resp.status === 404) {
      const err = new Error(`repo not found: ${owner}/${repo}`);
      err.is404 = true;
      throw err;
    }
    throw new Error(`metadata ${owner}/${repo}: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return { stargazers_count: data.stargazers_count, forks_count: data.forks_count };
}

// ─── stargazer fetch (recent strategy, parallel) ─────────────────────────
export async function fetchStargazers(owner, repo, token, limit = DEFAULT_STARGAZER_LIMIT) {
  const firstResp = await gh(
    `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=1`,
    token,
    { Accept: 'application/vnd.github.star+json' },
  );
  if (!firstResp.ok) throw new Error(`stargazers: ${firstResp.status} ${firstResp.statusText}`);
  const firstPage = await firstResp.json();

  const linkHeader = firstResp.headers.get('Link') ?? '';
  const lastPageMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  const lastPage = lastPageMatch ? parseInt(lastPageMatch[1], 10) : 1;

  const pagesNeeded = Math.ceil(limit / STARGAZERS_PER_PAGE);
  const startPage = Math.max(1, lastPage - pagesNeeded + 1);

  const events = [];
  if (startPage === 1) pushEvents(events, firstPage);

  const pagesToFetch = [];
  for (let p = Math.max(startPage, 2); p <= lastPage; p++) pagesToFetch.push(p);

  for (let i = 0; i < pagesToFetch.length; i += STARGAZER_FETCH_CONCURRENCY) {
    const batch = pagesToFetch.slice(i, i + STARGAZER_FETCH_CONCURRENCY);
    const responses = await Promise.all(
      batch.map((page) =>
        gh(
          `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=${page}`,
          token,
          { Accept: 'application/vnd.github.star+json' },
        ).then(async (resp) => {
          if (!resp.ok) throw new Error(`stargazers page ${page}: ${resp.status}`);
          return resp.json();
        }),
      ),
    );
    for (const raw of responses) pushEvents(events, raw);
  }

  events.sort((a, b) => a.starredAt.getTime() - b.starredAt.getTime());
  return events;
}

function pushEvents(out, raw) {
  for (const item of raw) {
    if (!item.starred_at || !item.user?.login) continue;
    const t = new Date(item.starred_at);
    if (Number.isNaN(t.getTime())) continue;
    out.push({ username: item.user.login, starredAt: t });
  }
}

// ─── fork timeseries (cross-validation) ──────────────────────────────────
export async function fetchForkTimeseries(owner, repo, token, maxForks = 1000) {
  const perPage = 100;
  const buckets = new Map();
  for (let page = 1; page <= Math.ceil(maxForks / perPage); page++) {
    const resp = await gh(
      `/repos/${owner}/${repo}/forks?per_page=${perPage}&page=${page}&sort=newest`,
      token,
    );
    if (!resp.ok) break;
    const items = await resp.json();
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

// ─── MAD burst detection (mirror of src/shared/mad.ts) ───────────────────
function isoDay(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDay(s) {
  return Date.parse(`${s}T00:00:00Z`);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function madStat(values, med) {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - med)));
}

function bucketByDay(events) {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.starredAt.getTime() - b.starredAt.getTime());
  const map = new Map();
  for (const ev of sorted) {
    const day = isoDay(ev.starredAt);
    const entry = map.get(day) ?? { count: 0, users: [] };
    entry.count++;
    entry.users.push(ev.username);
    map.set(day, entry);
  }
  const minDay = isoDay(sorted[0].starredAt);
  const maxDay = isoDay(sorted[sorted.length - 1].starredAt);
  const result = [];
  let cursor = parseDay(minDay);
  const end = parseDay(maxDay);
  while (cursor <= end) {
    const date = isoDay(new Date(cursor));
    const entry = map.get(date);
    result.push({ date, count: entry?.count ?? 0, users: entry?.users ?? [] });
    cursor += 86400000;
  }
  return result;
}

export function detectBursts(events) {
  const buckets = bucketByDay(events);
  if (buckets.length === 0) return [];

  // Min-baseline guard for viral repos (see CALIBRATION.md)
  const MIN_BASELINE_DAYS = WINDOW_SIZE * 2;
  const totalStars = buckets.reduce((s, b) => s + b.count, 0);
  const avgStarsPerDay = totalStars / buckets.length;
  const HIGH_DENSITY = 10;
  if (buckets.length < MIN_BASELINE_DAYS && avgStarsPerDay > HIGH_DENSITY) return [];

  const cumulative = [];
  let running = 0;
  for (const b of buckets) {
    cumulative.push(running);
    running += b.count;
  }

  const flags = new Array(buckets.length).fill(false);
  const stats = [];

  for (let i = 0; i < buckets.length; i++) {
    const today = buckets[i].count;
    const cumBefore = cumulative[i];
    let med = 0,
      m = 0;
    if (i >= WINDOW_SIZE) {
      const window = buckets.slice(i - WINDOW_SIZE, i).map((b) => b.count);
      med = median(window);
      m = madStat(window, med);
    }
    let isAnomaly = false,
      spikeRatio = 0;
    if (cumBefore >= MIN_STAR_COUNT && m > 0.001 && i >= WINDOW_SIZE) {
      const threshold = med + MAD_THRESHOLD * m;
      if (today > threshold && today > med + 1) {
        isAnomaly = true;
        spikeRatio = m > 0 ? (today - med) / m : Infinity;
      }
    } else if (today > 0) {
      const pct = (today / Math.max(1, cumBefore)) * 100;
      const significantJump = today > Math.max(5, med * 2);
      if ((pct > MIN_STARS_GROWTH_PERCENT && today > 5) || significantJump) {
        isAnomaly = true;
        spikeRatio = pct;
      }
    }
    flags[i] = isAnomaly;
    stats.push({ median: med, mad: m, spikeRatio });
  }

  const bursts = [];
  let cursor = 0;
  while (cursor < buckets.length) {
    if (!flags[cursor]) {
      cursor++;
      continue;
    }
    const start = cursor;
    let end = cursor;
    while (end + 1 < buckets.length && flags[end + 1]) end++;
    const slice = buckets.slice(start, end + 1);
    const stars = slice.reduce((sum, b) => sum + b.count, 0);
    const users = [].concat(...slice.map((b) => b.users));
    bursts.push({
      startDate: slice[0].date,
      endDate: slice[slice.length - 1].date,
      days: slice.length,
      stars,
      users: Array.from(new Set(users)),
      median: stats[start].median,
      mad: stats[start].mad,
      spikeRatio: Math.max(...slice.map((_, idx) => stats[start + idx].spikeRatio)),
    });
    cursor = end + 1;
  }
  return bursts;
}

// ─── burst cross-validation (mirror of src/shared/validation.ts) ─────────
export function validateBurst(burst, forkSeries, referrers) {
  // Count forks in the burst window
  let forkDelta = 0;
  for (const f of forkSeries) {
    if (f.date >= burst.startDate && f.date <= burst.endDate) forkDelta += f.count;
  }
  const forkRatio = burst.stars > 0 ? forkDelta / burst.stars : 0;

  const hasReferrerEvidence = referrers && referrers.length > 0;
  const topReferrers = (referrers ?? []).slice(0, 3).map((r) => r.referrer);

  // Verdict heuristic (matches src/shared/validation.ts at time of writing):
  //   - high fork ratio (≥3%) → organic
  //   - meaningful referrer evidence → organic
  //   - otherwise → suspicious (per-user analysis upgrades to fake/organic later)
  let verdict = 'suspicious';
  let confidence = 0.5;
  if (forkRatio >= 0.03) {
    verdict = 'organic';
    confidence = 0.7;
  } else if (hasReferrerEvidence) {
    verdict = 'organic';
    confidence = 0.6;
  }
  return { forkDelta, forkRatio, hasReferrerEvidence, topReferrers, verdict, confidence };
}

// ─── user scoring (mirror of src/background/userScore.ts) ────────────────
function scoreFromProfile(user) {
  const reasons = [];
  let score = 0;
  const ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
  if (ageDays < 30) {
    score += 2.0;
    reasons.push(`new account (${Math.floor(ageDays)} days old)`);
  }
  if (user.followers === 0) {
    score += 1.5;
    reasons.push('zero followers');
  } else if (user.followers < 5) {
    score += 0.5;
    reasons.push(`few followers (${user.followers})`);
  }
  if (user.public_repos === 0) {
    score += 1.5;
    reasons.push('zero public repos');
  } else if (user.public_repos < 2) {
    score += 0.5;
    reasons.push(`few public repos (${user.public_repos})`);
  }
  const hasCustomAvatar = !!user.avatar_url && /\?(v=|u=)/.test(user.avatar_url);
  const noGravatar = !user.gravatar_id || user.gravatar_id === '';
  if (!hasCustomAvatar && noGravatar) {
    score += 0.5;
    reasons.push('default avatar');
  }
  if (user.followers === 0 && user.public_repos === 0) {
    score += 1.0;
    reasons.push('account exists but is completely empty');
  }
  return {
    login: user.login,
    score,
    suspicious: score >= USER_SUSPICIOUS_THRESHOLD,
    reasons,
    computedAt: Date.now(),
  };
}

async function fetchAndScoreUser(login, token, cache) {
  const cached = cache.get(login);
  if (cached) return cached;
  let resp;
  try {
    resp = await gh(`/users/${encodeURIComponent(login)}`, token);
  } catch (err) {
    if (err.isRateLimit) throw err;
    return null;
  }
  if (resp.status === 404) {
    const score = {
      login,
      score: 5.0,
      suspicious: true,
      reasons: ['account deleted by GitHub'],
      computedAt: Date.now(),
    };
    cache.set(login, score);
    return score;
  }
  if (!resp.ok) return null;
  const user = await resp.json();
  const score = scoreFromProfile(user);
  cache.set(login, score);
  return score;
}

export async function scoreUsers(logins, token, cache) {
  const results = [];
  for (let i = 0; i < logins.length; i += USER_FETCH_CONCURRENCY) {
    const batch = logins.slice(i, i + USER_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((login) => fetchAndScoreUser(login, token, cache)),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
      else if (r.status === 'rejected' && r.reason?.isRateLimit) throw r.reason;
    }
  }
  return results;
}

// ─── deterministic sampling (mirror of src/background/userScore.ts) ──────
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleUsers(users, n, seed) {
  if (users.length <= n) return [...users];
  const rng = mulberry32(hashSeed(seed));
  const indices = new Set();
  while (indices.size < n) indices.add(Math.floor(rng() * users.length));
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => users[i]);
}

// ─── top-level scoreRepo (mirror of src/background/analyze.ts) ───────────
/**
 * Score a single repo end-to-end. Returns the same shape the extension's
 * AnalysisResult uses (modulo cache metadata). Throws on rate-limit; the
 * caller decides whether to abort the batch or wait.
 */
export async function scoreRepo(owner, repo, token, cache) {
  const meta = await fetchRepoMetadata(owner, repo, token);

  if (meta.stargazers_count < MIN_STARS_FOR_VERDICT) {
    return {
      owner,
      repo,
      totalStars: meta.stargazers_count,
      analyzedStars: 0,
      bursts: [],
      validatedBursts: [],
      suspiciousStars: 0,
      realStars: meta.stargazers_count,
      fakePercent: 0,
      riskLevel: 'low',
      insufficientData: true,
      analyzedAt: Date.now(),
      warning: `Below ${MIN_STARS_FOR_VERDICT}-star verdict threshold`,
    };
  }

  // Stargazers + forks in parallel; skip traffic referrers entirely
  // (the endpoint requires push access we don't have).
  const [stargazerResult, forkResult] = await Promise.allSettled([
    fetchStargazers(owner, repo, token, DEFAULT_STARGAZER_LIMIT),
    fetchForkTimeseries(owner, repo, token),
  ]);
  if (stargazerResult.status === 'rejected') throw stargazerResult.reason;
  const stargazers = stargazerResult.value;
  const forkSeries = forkResult.status === 'fulfilled' ? forkResult.value : [];

  if (stargazers.length === 0) {
    return {
      owner,
      repo,
      totalStars: meta.stargazers_count,
      analyzedStars: 0,
      bursts: [],
      validatedBursts: [],
      suspiciousStars: 0,
      realStars: meta.stargazers_count,
      fakePercent: 0,
      riskLevel: 'low',
      analyzedAt: Date.now(),
    };
  }

  const bursts = detectBursts(stargazers);
  const initialValidated = bursts.map((b) => ({
    ...b,
    validation: validateBurst(b, forkSeries, []),
  }));

  // Global per-user sampling on the whole stargazer slice
  const allUsers = stargazers.map((s) => s.username);
  const globalSample = sampleUsers(allUsers, USER_SAMPLE_SIZE, `${owner}/${repo}`);
  const globalScores = await scoreUsers(globalSample, token, cache);
  const globalSuspCount = globalScores.filter((s) => s.suspicious).length;
  const globalUserAnalysis = {
    sampled: globalScores.length,
    suspicious: globalSuspCount,
    suspiciousRatio: globalScores.length > 0 ? globalSuspCount / globalScores.length : 0,
    examples: globalScores
      .filter((s) => s.suspicious)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ login, score, reasons }) => ({ login, score, reasons })),
  };

  // Per-burst user analysis (reuses global cache)
  const globalScoreByLogin = new Map(globalScores.map((s) => [s.login.toLowerCase(), s]));
  const userAnalyses = new Map();
  for (const b of initialValidated.filter((b) => b.users.length > 0)) {
    const burstSample = sampleUsers(b.users, USER_SAMPLE_SIZE, b.startDate);
    const fromCache = burstSample
      .map((u) => globalScoreByLogin.get(u.toLowerCase()))
      .filter((s) => s !== undefined);
    const missing = burstSample.filter((u) => !globalScoreByLogin.has(u.toLowerCase()));
    const fresh = await scoreUsers(missing, token, cache);
    for (const s of fresh) globalScoreByLogin.set(s.login.toLowerCase(), s);
    const allScores = [...fromCache, ...fresh];
    const suspCount = allScores.filter((s) => s.suspicious).length;
    userAnalyses.set(`${b.startDate}|${b.endDate}`, {
      sampled: allScores.length,
      suspicious: suspCount,
      suspiciousRatio: allScores.length > 0 ? suspCount / allScores.length : 0,
      examples: allScores
        .filter((s) => s.suspicious)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(({ login, score, reasons }) => ({ login, score, reasons })),
    });
  }

  // Upgrade verdicts based on per-user evidence
  const validatedBursts = initialValidated.map((b) => {
    const ua = userAnalyses.get(`${b.startDate}|${b.endDate}`);
    let upgraded = b.validation;
    if (ua && ua.sampled >= 10) {
      if (ua.suspiciousRatio >= 0.6) {
        upgraded = { ...b.validation, verdict: 'fake', confidence: Math.max(b.validation.confidence, 0.85) };
      } else if (ua.suspiciousRatio <= 0.1) {
        upgraded = { ...b.validation, verdict: 'organic', confidence: Math.max(b.validation.confidence, 0.85) };
      }
    }
    return { ...b, validation: upgraded, userAnalysis: ua };
  });

  // suspiciousStars = max(burst signal, global signal)
  const burstSusp = validatedBursts
    .filter((b) => b.validation.verdict !== 'organic')
    .reduce((sum, b) => {
      if (b.userAnalysis && b.userAnalysis.sampled >= 10) {
        return sum + Math.round(b.stars * b.userAnalysis.suspiciousRatio);
      }
      return sum + b.stars;
    }, 0);

  const globalSusp =
    globalUserAnalysis.sampled >= 10
      ? Math.round(stargazers.length * globalUserAnalysis.suspiciousRatio)
      : 0;
  const suspiciousStars = Math.max(burstSusp, globalSusp);

  // Same denominator rule as extension
  const fakePercent =
    globalUserAnalysis.sampled >= 10
      ? globalUserAnalysis.suspiciousRatio * 100
      : meta.stargazers_count > 0
        ? (suspiciousStars / meta.stargazers_count) * 100
        : 0;

  let riskLevel = 'low';
  if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
  else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

  const realStars =
    globalUserAnalysis.sampled >= 10
      ? Math.round(meta.stargazers_count * (1 - globalUserAnalysis.suspiciousRatio))
      : Math.max(0, meta.stargazers_count - suspiciousStars);

  return {
    owner,
    repo,
    totalStars: meta.stargazers_count,
    analyzedStars: stargazers.length,
    bursts: bursts.length,
    validatedBursts: validatedBursts.length,
    suspiciousStars,
    realStars,
    fakePercent: +fakePercent.toFixed(1),
    riskLevel,
    globalUserAnalysis: {
      sampled: globalUserAnalysis.sampled,
      suspicious: globalUserAnalysis.suspicious,
      suspiciousRatio: +globalUserAnalysis.suspiciousRatio.toFixed(3),
    },
    burstVerdicts: validatedBursts.map((b) => ({
      startDate: b.startDate,
      endDate: b.endDate,
      stars: b.stars,
      verdict: b.validation.verdict,
      confidence: b.validation.confidence,
      suspiciousRatio: b.userAnalysis?.suspiciousRatio ?? null,
    })),
    analyzedAt: Date.now(),
  };
}
