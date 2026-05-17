/**
 * Real-stars scoring library — Node/dashboard entrypoint.
 *
 * This is NOT a mirror anymore. The algorithm lives in ONE place — the
 * extension's pure modules:
 *
 *   src/shared/constants.ts   — all algorithm constants
 *   src/shared/mad.ts         — median / mad / detectBursts
 *   src/shared/validation.ts  — validateBurst cross-validation
 *   src/background/userScore.ts — scoreFromProfile / sampleUsers
 *
 * They are pure (no chrome.* APIs) and import cleanly under tsx, exactly
 * like scripts/bench-repo.ts already does. This file re-exports them and
 * adds ONLY the dashboard-specific IO that the extension doesn't need:
 *
 *   - FileSystemCache  : the .user-cache.json adapter (extension uses
 *                        chrome.storage.local instead)
 *   - gh()             : a rate-limit-aware fetch wrapper (the cron must
 *                        abort cleanly on 403; the extension surfaces
 *                        rate-limits through its own UI path)
 *   - fetch helpers    : repo metadata / stargazers / forks (network IO)
 *   - scoreUsers       : rate-limit-propagating batch loop over
 *                        scoreFromProfile
 *   - scoreRepo        : end-to-end orchestration for one repo
 *
 * Run via tsx (see package.json `score-trending` / the trending workflow).
 * The parity test (tests/unit/parity.test.ts) guards that the re-exported
 * pure functions behave identically to what the extension uses.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GITHUB_API_BASE,
  STARGAZERS_PER_PAGE,
  DEFAULT_STARGAZER_LIMIT,
  MIN_STARS_FOR_VERDICT,
  CACHE_TTL_MS as USER_CACHE_TTL_MS,
  CACHE_SCHEMA_VERSION,
  MAD_THRESHOLD,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
} from '../src/shared/constants';
import { median, mad, detectBursts } from '../src/shared/mad';
import { validateBurst } from '../src/shared/validation';
import { evaluateAudienceGate } from '../src/shared/audienceGate';
import {
  scoreFromProfile,
  sampleUsers,
  USER_SAMPLE_SIZE,
  USER_FETCH_CONCURRENCY,
  USER_SUSPICIOUS_THRESHOLD,
} from '../src/background/userScore';
import type { UserScore } from '../src/background/userScore';
import type { Burst, CrossValidation, ForkPoint, StargazerEvent } from '../src/shared/types';

// Re-export the single-source-of-truth surface so existing importers
// (parity test, score-trending) keep working unchanged.
export {
  GITHUB_API_BASE,
  STARGAZERS_PER_PAGE,
  DEFAULT_STARGAZER_LIMIT,
  MIN_STARS_FOR_VERDICT,
  CACHE_SCHEMA_VERSION,
  MAD_THRESHOLD,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
  USER_SAMPLE_SIZE,
  USER_FETCH_CONCURRENCY,
  USER_SUSPICIOUS_THRESHOLD,
  USER_CACHE_TTL_MS,
  median,
  mad,
  detectBursts,
  validateBurst,
  scoreFromProfile,
  sampleUsers,
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Concurrent stargazer-page fetches per repo (matches src/background/github.ts). */
const STARGAZER_FETCH_CONCURRENCY = 6;

interface RateLimitError extends Error {
  isRateLimit?: boolean;
  resetAt?: string;
}

interface NotFoundError extends Error {
  is404?: boolean;
}

interface CachedUserScore extends UserScore {
  expiresAt: number;
  algoVersion: number;
}

// ─── file-system user cache ──────────────────────────────────────────────
/**
 * One JSON file holds all user scores. Keyed by lowercase login.
 * Entries past TTL are filtered on read. Whole file rewritten on each save
 * — fine because the cache is <1 MB and we only save once per script run.
 *
 * This is the dashboard's equivalent of the extension's chrome.storage
 * cache layer in src/background/userScore.ts. Same TTL + algo-version
 * guard semantics; different backing store.
 */
export class FileSystemCache {
  path: string;
  dirty: boolean;
  entries: Map<string, CachedUserScore>;

  constructor(path = resolve(__dirname, '.user-cache.json')) {
    this.path = path;
    this.dirty = false;
    this.entries = new Map();
    this.load();
  }

  load() {
    if (!existsSync(this.path)) return;
    try {
      const obj = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, CachedUserScore>;
      const now = Date.now();
      let kept = 0,
        droppedExpired = 0,
        droppedStaleAlgo = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (v.expiresAt && now > v.expiresAt) {
          droppedExpired++;
          continue;
        }
        // Algorithm-version guard: a score computed under an older
        // algorithm is invalid even if not time-expired. Without this,
        // bumping the algorithm left up-to-7-day-old per-user scores in
        // the cache, polluting weekly/monthly verdicts with a mix of old
        // and new scoring until natural TTL expiry.
        if (v.algoVersion !== CACHE_SCHEMA_VERSION) {
          droppedStaleAlgo++;
          continue;
        }
        this.entries.set(k, v);
        kept++;
      }
      console.error(
        `[cache] loaded ${kept} entries (dropped ${droppedExpired} expired, ${droppedStaleAlgo} stale-algo)`,
      );
    } catch (err) {
      console.error(`[cache] load failed (${(err as Error).message}); starting empty`);
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

  get(login: string): CachedUserScore | null {
    return this.entries.get(login.toLowerCase()) ?? null;
  }

  set(login: string, score: UserScore) {
    this.entries.set(login.toLowerCase(), {
      ...score,
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
      algoVersion: CACHE_SCHEMA_VERSION,
    });
    this.dirty = true;
  }

  size(): number {
    return this.entries.size;
  }
}

// ─── GitHub fetch with rate-limit awareness ──────────────────────────────
async function gh(
  path: string,
  token: string,
  headers: Record<string, string> = {},
): Promise<Response> {
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
    const err: RateLimitError = new Error(`rate-limited; resets at ${resetAt}`);
    err.isRateLimit = true;
    err.resetAt = resetAt;
    throw err;
  }
  return resp;
}

// ─── repo metadata ───────────────────────────────────────────────────────
export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token: string,
): Promise<{ stargazers_count: number; forks_count: number }> {
  const resp = await gh(`/repos/${owner}/${repo}`, token);
  if (!resp.ok) {
    if (resp.status === 404) {
      const err: NotFoundError = new Error(`repo not found: ${owner}/${repo}`);
      err.is404 = true;
      throw err;
    }
    throw new Error(`metadata ${owner}/${repo}: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as { stargazers_count: number; forks_count: number };
  return { stargazers_count: data.stargazers_count, forks_count: data.forks_count };
}

// ─── stargazer fetch (recent strategy, parallel) ─────────────────────────
export async function fetchStargazers(
  owner: string,
  repo: string,
  token: string,
  limit = DEFAULT_STARGAZER_LIMIT,
): Promise<StargazerEvent[]> {
  const firstResp = await gh(
    `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=1`,
    token,
    { Accept: 'application/vnd.github.star+json' },
  );
  if (!firstResp.ok) throw new Error(`stargazers: ${firstResp.status} ${firstResp.statusText}`);
  const firstPage = (await firstResp.json()) as StarApiItem[];

  const linkHeader = firstResp.headers.get('Link') ?? '';
  const lastPageMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  const lastPage = lastPageMatch ? parseInt(lastPageMatch[1], 10) : 1;

  const pagesNeeded = Math.ceil(limit / STARGAZERS_PER_PAGE);
  const startPage = Math.max(1, lastPage - pagesNeeded + 1);

  const events: StargazerEvent[] = [];
  if (startPage === 1) pushEvents(events, firstPage);

  const pagesToFetch: number[] = [];
  for (let p = Math.max(startPage, 2); p <= lastPage; p++) pagesToFetch.push(p);

  for (let i = 0; i < pagesToFetch.length; i += STARGAZER_FETCH_CONCURRENCY) {
    const batch = pagesToFetch.slice(i, i + STARGAZER_FETCH_CONCURRENCY);
    const responses = await Promise.all(
      batch.map((page) =>
        gh(
          `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=${page}`,
          token,
          {
            Accept: 'application/vnd.github.star+json',
          },
        ).then(async (resp) => {
          if (!resp.ok) throw new Error(`stargazers page ${page}: ${resp.status}`);
          return resp.json() as Promise<StarApiItem[]>;
        }),
      ),
    );
    for (const raw of responses) pushEvents(events, raw);
  }

  events.sort((a, b) => a.starredAt.getTime() - b.starredAt.getTime());
  return events;
}

interface StarApiItem {
  starred_at?: string;
  user?: { login?: string };
}

function pushEvents(out: StargazerEvent[], raw: StarApiItem[]) {
  for (const item of raw) {
    if (!item.starred_at || !item.user?.login) continue;
    const t = new Date(item.starred_at);
    if (Number.isNaN(t.getTime())) continue;
    out.push({ username: item.user.login, starredAt: t });
  }
}

// ─── fork timeseries (cross-validation) ──────────────────────────────────
export async function fetchForkTimeseries(
  owner: string,
  repo: string,
  token: string,
  maxForks = 1000,
): Promise<ForkPoint[]> {
  const perPage = 100;
  const buckets = new Map<string, number>();
  for (let page = 1; page <= Math.ceil(maxForks / perPage); page++) {
    const resp = await gh(
      `/repos/${owner}/${repo}/forks?per_page=${perPage}&page=${page}&sort=newest`,
      token,
    );
    if (!resp.ok) break;
    const items = (await resp.json()) as Array<{ created_at?: string }>;
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

// ─── user scoring (network layer over the shared scoreFromProfile) ───────
// scoreFromProfile is the SINGLE source of truth (src/background/userScore.ts).
// Only the network + rate-limit-abort wrapper lives here, because the cron
// must stop cleanly on a 403 whereas the extension surfaces rate-limits
// through its own UI path.
async function fetchAndScoreUser(
  login: string,
  token: string,
  cache: FileSystemCache,
): Promise<UserScore | null> {
  const cached = cache.get(login);
  if (cached) return cached;
  let resp: Response;
  try {
    resp = await gh(`/users/${encodeURIComponent(login)}`, token);
  } catch (err) {
    if ((err as RateLimitError).isRateLimit) throw err;
    return null;
  }
  if (resp.status === 404) {
    const score: UserScore = {
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
  const user = (await resp.json()) as Parameters<typeof scoreFromProfile>[0];
  const score = scoreFromProfile(user);
  cache.set(login, score);
  return score;
}

export async function scoreUsers(
  logins: string[],
  token: string,
  cache: FileSystemCache,
): Promise<UserScore[]> {
  const results: UserScore[] = [];
  for (let i = 0; i < logins.length; i += USER_FETCH_CONCURRENCY) {
    const batch = logins.slice(i, i + USER_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((login) => fetchAndScoreUser(login, token, cache)),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
      else if (r.status === 'rejected' && (r.reason as RateLimitError)?.isRateLimit) throw r.reason;
    }
  }
  return results;
}

// ─── top-level scoreRepo (dashboard orchestration) ───────────────────────
type ValidatedBurst = Burst & { validation: CrossValidation };
interface UserAnalysis {
  sampled: number;
  suspicious: number;
  suspiciousRatio: number;
  examples: Array<{ login: string; score: number; reasons: string[] }>;
}

/**
 * Score a single repo end-to-end. Returns the same shape the extension's
 * AnalysisResult uses (modulo cache metadata). Throws on rate-limit; the
 * caller decides whether to abort the batch or wait.
 */
export async function scoreRepo(
  owner: string,
  repo: string,
  token: string,
  cache: FileSystemCache,
) {
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
      riskLevel: 'low' as const,
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
      riskLevel: 'low' as const,
      analyzedAt: Date.now(),
    };
  }

  const bursts = detectBursts(stargazers);
  const initialValidated: ValidatedBurst[] = bursts.map((b) => ({
    ...b,
    validation: validateBurst(b, forkSeries, []),
  }));

  // Global per-user sampling on the whole stargazer slice
  const allUsers = stargazers.map((s) => s.username);
  const globalSample = sampleUsers(allUsers, USER_SAMPLE_SIZE, `${owner}/${repo}`);
  const globalScores = await scoreUsers(globalSample, token, cache);
  const globalSuspCount = globalScores.filter((s) => s.suspicious).length;
  const globalUserAnalysis: UserAnalysis = {
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
  const userAnalyses = new Map<string, UserAnalysis>();
  for (const b of initialValidated.filter((b) => b.users.length > 0)) {
    const burstSample = sampleUsers(b.users, USER_SAMPLE_SIZE, b.startDate);
    const fromCache = burstSample
      .map((u) => globalScoreByLogin.get(u.toLowerCase()))
      .filter((s): s is UserScore => s !== undefined);
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
        upgraded = {
          ...b.validation,
          verdict: 'fake',
          confidence: Math.max(b.validation.confidence, 0.85),
        };
      } else if (ua.suspiciousRatio <= 0.1) {
        upgraded = {
          ...b.validation,
          verdict: 'organic',
          confidence: Math.max(b.validation.confidence, 0.85),
        };
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

  // Audience-aware gate — single definition in src/shared/audienceGate.ts,
  // imported (not re-implemented) so the dashboard and extension can never
  // diverge on it.
  const audienceLikelyReal = evaluateAudienceGate(validatedBursts).suppressGlobalSignal;
  const gatedGlobalSusp = audienceLikelyReal ? 0 : globalSusp;
  const suspiciousStars = Math.max(burstSusp, gatedGlobalSusp);

  // Denominator rule: use global ratio only when gate didn't fire
  const fakePercent =
    globalUserAnalysis.sampled >= 10 && !audienceLikelyReal
      ? globalUserAnalysis.suspiciousRatio * 100
      : meta.stargazers_count > 0
        ? (suspiciousStars / meta.stargazers_count) * 100
        : 0;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
  else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

  const realStars =
    globalUserAnalysis.sampled >= 10 && !audienceLikelyReal
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
