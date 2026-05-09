import {
  fetchRepoMetadata,
  fetchStargazers,
  fetchForkTimeseries,
  fetchTrafficReferrers,
} from './github';
import { detectBursts } from '@/shared/mad';
import { validateBurst } from '@/shared/validation';
import { getAuthToken } from './auth';
import { checkStarScout } from './starscout';
import {
  CACHE_SCHEMA_VERSION,
  CACHE_TTL_MS,
  STORAGE_KEY_CACHE_PREFIX,
  DEFAULT_STARGAZER_LIMIT,
  MIN_STARS_FOR_VERDICT,
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
  // Schema mismatch → treat as stale. Prevents users from seeing results
  // computed under a pre-fix algorithm after the extension auto-updates.
  if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  if (Date.now() - entry.cachedAt > entry.ttlMs) return null;
  return entry;
}

async function writeCache(result: AnalysisResult): Promise<void> {
  const entry: CachedAnalysis = {
    ...result,
    cachedAt: Date.now(),
    ttlMs: CACHE_TTL_MS,
    schemaVersion: CACHE_SCHEMA_VERSION,
  };
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
    // Run StarScout lookup + repo metadata in parallel. StarScout is
    // peer-reviewed ground truth — when it has an opinion, we should trust
    // it over our heuristics. The lookup is a single tiny request to our
    // Worker, so it costs nothing in the common (cache miss) path.
    const [meta, starscout] = await Promise.all([
      fetchRepoMetadata(owner, repo, token),
      checkStarScout(owner, repo).catch(() => null),
    ]);

    // If StarScout flagged this repo, build the verdict directly from its
    // numbers. We still attach the heuristic burst data when available so
    // the user can see WHERE the fake stars came from, but the headline
    // numbers (suspiciousStars, fakePercent, riskLevel) come from
    // StarScout. This is the highest-confidence path — overrides the
    // 1000-star gate too.
    if (starscout) {
      const suspiciousStars = starscout.fakeStars;
      const fakePercent = starscout.fakeRatio * 100;
      const realStars = Math.max(0, meta.stargazers_count - suspiciousStars);
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
      else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

      const result: AnalysisResult = {
        owner,
        repo,
        totalStars: meta.stargazers_count,
        analyzedStars: 0, // we didn't run heuristic analysis on this branch
        bursts: [],
        validatedBursts: [],
        suspiciousStars,
        realStars,
        fakePercent,
        riskLevel,
        starscout,
        analyzedAt: Date.now(),
      };
      await writeCache(result);
      return result;
    }

    // Confidence gate: under MIN_STARS_FOR_VERDICT the heuristic's
    // false-positive rate is too high to make a public claim (see
    // CALIBRATION.md). Skip analysis entirely and tell the badge to show
    // an "insufficient data" state.
    if (meta.stargazers_count < MIN_STARS_FOR_VERDICT) {
      const result: AnalysisResult = {
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
        warning: `real-stars only issues verdicts for repos with at least ${MIN_STARS_FOR_VERDICT.toLocaleString()} stars (calibration showed insufficient accuracy below this threshold).`,
      };
      await writeCache(result);
      return result;
    }

    // Run stargazer + fork + traffic in parallel. They're independent reads
    // that all need to complete before validation. Saves ~2s compared to
    // serial. Fork and traffic are best-effort — wrap in inner try blocks
    // via Promise.allSettled so a 403 on traffic doesn't kill the analysis.
    const [stargazerResult, forkResult, referrerResult] = await Promise.allSettled([
      fetchStargazers(owner, repo, token, DEFAULT_STARGAZER_LIMIT),
      fetchForkTimeseries(owner, repo, token),
      fetchTrafficReferrers(owner, repo, token),
    ]);

    if (stargazerResult.status === 'rejected') {
      throw stargazerResult.reason;
    }
    const stargazers = stargazerResult.value;
    const earlyForkSeries = forkResult.status === 'fulfilled' ? forkResult.value : [];
    const earlyReferrers = referrerResult.status === 'fulfilled' ? referrerResult.value : [];

    if (stargazers.length === 0) {
      const empty: AnalysisResult = {
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
      await writeCache(empty);
      return empty;
    }

    const bursts = detectBursts(stargazers);

    // Reuse the parallel-fetched fork + referrer data. We already paid the
    // RTT for these even when there are zero bursts — the cost is small
    // (1 fork-list call + 1 traffic-popular-referrers call) and parallel.
    const forkSeries = earlyForkSeries;
    const referrers = earlyReferrers;

    const validatedBursts: Array<Burst & { validation: CrossValidation }> = bursts.map((b) => ({
      ...b,
      validation: validateBurst(b, forkSeries, referrers),
    }));

    // Sum stars from bursts that crossed the "suspicious" or "fake" verdict
    const suspiciousStars = validatedBursts
      .filter((b) => b.validation.verdict !== 'organic')
      .reduce((sum: number, b) => sum + b.stars, 0);

    // The "total" for risk-level math is the analyzed slice (we can only
    // claim suspicion about stars we actually looked at). The "displayed"
    // total in the result uses the true repo count for context.
    const analyzedTotal = stargazers.length;
    const realStars = Math.max(0, meta.stargazers_count - suspiciousStars);
    // The denominator must be the TRUE total stars, not the analyzed slice.
    // Otherwise a 5000-stargazer slice with 1000 suspicious shows as "20% fake"
    // even when those 1000 are 0.5% of the repo's actual 200k stars. The
    // suspicious count itself is still bounded by what we analyzed; we're
    // honest about this via the `analyzedStars` field.
    const fakePercent =
      meta.stargazers_count > 0 ? (suspiciousStars / meta.stargazers_count) * 100 : 0;

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
    else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

    const result: AnalysisResult = {
      owner,
      repo,
      totalStars: meta.stargazers_count,
      analyzedStars: analyzedTotal,
      bursts,
      validatedBursts,
      suspiciousStars,
      realStars,
      fakePercent,
      riskLevel,
      analyzedAt: Date.now(),
      warning:
        analyzedTotal === DEFAULT_STARGAZER_LIMIT && meta.stargazers_count > DEFAULT_STARGAZER_LIMIT
          ? `Analyzed the ${DEFAULT_STARGAZER_LIMIT} most recent stargazers out of ${meta.stargazers_count.toLocaleString()} total. Bought stars cluster near launch, so this is usually sufficient.`
          : undefined,
    };
    await writeCache(result);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
