import { fetchStargazers, fetchForkTimeseries, fetchTrafficReferrers } from './github';
import { detectBursts } from '@/shared/mad';
import { validateBurst } from '@/shared/validation';
import { getAuthToken } from './auth';
import {
  CACHE_TTL_MS,
  STORAGE_KEY_CACHE_PREFIX,
  DEFAULT_STARGAZER_LIMIT,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
} from '@/shared/constants';
import type { AnalysisResult, Burst, CachedAnalysis, CrossValidation } from '@/shared/types';

function cacheKey(owner: string, repo: string): string {
  return `${STORAGE_KEY_CACHE_PREFIX}${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

async function readCache(owner: string, repo: string): Promise<CachedAnalysis | null> {
  const key = cacheKey(owner, repo);
  const result = await chrome.storage.local.get(key);
  const entry: CachedAnalysis | undefined = result[key];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > entry.ttlMs) return null;
  return entry;
}

async function writeCache(result: AnalysisResult): Promise<void> {
  const entry: CachedAnalysis = { ...result, cachedAt: Date.now(), ttlMs: CACHE_TTL_MS };
  await chrome.storage.local.set({ [cacheKey(result.owner, result.repo)]: entry });
}

export async function handleClearCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEY_CACHE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function handleAnalyzeRepo(payload: {
  owner: string;
  repo: string;
  forceRefresh?: boolean;
}): Promise<AnalysisResult | { error: string }> {
  const { owner, repo, forceRefresh } = payload;

  if (!forceRefresh) {
    const cached = await readCache(owner, repo);
    if (cached) {
      // Strip cache metadata from the returned shape
      const { cachedAt: _c, ttlMs: _t, ...rest } = cached;
      void _c;
      void _t;
      return rest;
    }
  }

  const token = await getAuthToken();
  if (!token) return { error: 'unauthenticated' };

  try {
    const stargazers = await fetchStargazers(owner, repo, token, DEFAULT_STARGAZER_LIMIT);

    if (stargazers.length === 0) {
      const empty: AnalysisResult = {
        owner,
        repo,
        totalStars: 0,
        analyzedStars: 0,
        bursts: [],
        validatedBursts: [],
        suspiciousStars: 0,
        realStars: 0,
        fakePercent: 0,
        riskLevel: 'low',
        analyzedAt: Date.now(),
      };
      await writeCache(empty);
      return empty;
    }

    const bursts = detectBursts(stargazers);

    // Cross-validate each burst against fork activity and traffic referrers
    let forkSeries: Awaited<ReturnType<typeof fetchForkTimeseries>> = [];
    let referrers: Awaited<ReturnType<typeof fetchTrafficReferrers>> = [];

    if (bursts.length > 0) {
      try {
        forkSeries = await fetchForkTimeseries(owner, repo, token);
      } catch {
        // Fork data is best-effort
      }
      try {
        referrers = await fetchTrafficReferrers(owner, repo, token);
      } catch {
        // Traffic data requires push access; many users won't have it. Fail soft.
      }
    }

    const validatedBursts: Array<Burst & { validation: CrossValidation }> = bursts.map((b) => ({
      ...b,
      validation: validateBurst(b, forkSeries, referrers),
    }));

    // Sum stars from bursts that crossed the "suspicious" or "fake" verdict
    const suspiciousStars = validatedBursts
      .filter((b) => b.validation.verdict !== 'organic')
      .reduce((sum: number, b) => sum + b.stars, 0);

    const totalStars = stargazers.length; // we capped at DEFAULT_STARGAZER_LIMIT — see "warning" below
    const realStars = Math.max(0, totalStars - suspiciousStars);
    const fakePercent = totalStars > 0 ? (suspiciousStars / totalStars) * 100 : 0;

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
    else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

    const result: AnalysisResult = {
      owner,
      repo,
      totalStars,
      analyzedStars: stargazers.length,
      bursts,
      validatedBursts,
      suspiciousStars,
      realStars,
      fakePercent,
      riskLevel,
      analyzedAt: Date.now(),
      warning:
        stargazers.length === DEFAULT_STARGAZER_LIMIT
          ? `Analyzed the ${DEFAULT_STARGAZER_LIMIT} most recent stargazers (sufficient for fake-star detection — bought stars cluster near launch).`
          : undefined,
    };
    await writeCache(result);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
