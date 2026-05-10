import {
  fetchRepoMetadata,
  fetchStargazers,
  fetchForkTimeseries,
  fetchTrafficReferrers,
} from './github';
import { detectBursts } from '@/shared/mad';
import { validateBurst } from '@/shared/validation';
import { getAuthToken } from './auth';
import { scoreUsers, sampleUsers, USER_SAMPLE_SIZE } from './userScore';
import type { UserScoreSummary } from '@/shared/types';
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
    // Repo metadata: we need stargazers_count up-front for the gate
    // decision, so this can't be parallelized with stargazer fetch.
    const meta = await fetchRepoMetadata(owner, repo, token);

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

    // First pass: cross-validate with fork + traffic only (cheap, all-local).
    const initialValidated = bursts.map((b) => ({
      ...b,
      validation: validateBurst(b, forkSeries, referrers),
    }));

    // Per-user analysis: sample the burst's stargazers and check their
    // account profiles. This is the live equivalent of StarScout's
    // low-activity heuristic — we look for throwaway-account fingerprints
    // (new account, no followers, no repos, default avatar) on the actual
    // people who starred during the spike.
    //
    // We run this on ALL bursts (not just already-suspicious ones) because
    // the fork-ratio check has known false-organic cases — e.g. a repo
    // that legitimately got forks but whose stars were also bought from a
    // pool of throwaway accounts. Per-user is the strongest single signal
    // we have, so it should be the deciding voice.
    //
    // Cost: ~50 GitHub API calls per burst (sample size, with 7-day cache
    // per stargazer). For most repos this is just 1-3 bursts × 50 calls,
    // well under the 5000/hr quota.
    const burstsNeedingUserAnalysis = initialValidated.filter((b) => b.users.length > 0);

    const userAnalyses = new Map<string, UserScoreSummary>();
    for (const b of burstsNeedingUserAnalysis) {
      const sample = sampleUsers(b.users, USER_SAMPLE_SIZE, b.startDate);
      const scores = await scoreUsers(sample, token);
      const suspiciousCount = scores.filter((s) => s.suspicious).length;
      const summary: UserScoreSummary = {
        sampled: scores.length,
        suspicious: suspiciousCount,
        suspiciousRatio: scores.length > 0 ? suspiciousCount / scores.length : 0,
        examples: scores
          .filter((s) => s.suspicious)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map(({ login, score, reasons }) => ({ login, score, reasons })),
      };
      userAnalyses.set(`${b.startDate}|${b.endDate}`, summary);
    }

    const validatedBursts: Array<
      Burst & { validation: CrossValidation; userAnalysis?: UserScoreSummary }
    > = initialValidated.map((b) => {
      const ua = userAnalyses.get(`${b.startDate}|${b.endDate}`);
      // Per-user data overrides the verdict in either direction:
      //   ≥60% suspicious → 'fake' (strongest evidence we have)
      //   ≤10% suspicious → 'organic' (real user spike, even if fork-ratio
      //                                 was ambiguous)
      let upgradedValidation = b.validation;
      if (ua && ua.sampled >= 10) {
        if (ua.suspiciousRatio >= 0.6) {
          upgradedValidation = {
            ...b.validation,
            verdict: 'fake',
            confidence: Math.max(b.validation.confidence, 0.85),
          };
        } else if (ua.suspiciousRatio <= 0.1) {
          upgradedValidation = {
            ...b.validation,
            verdict: 'organic',
            confidence: Math.max(b.validation.confidence, 0.85),
          };
        }
      }
      return { ...b, validation: upgradedValidation, userAnalysis: ua };
    });

    // Sum stars from bursts that crossed the "suspicious" or "fake" verdict.
    // For bursts where we have per-user data, scale by the suspicious ratio
    // (if 80% of sampled stargazers are throwaways, count 80% of the
    // burst's stars). For bursts without per-user data, count the whole
    // burst — same as before.
    const suspiciousStars = validatedBursts
      .filter((b) => b.validation.verdict !== 'organic')
      .reduce((sum: number, b) => {
        if (b.userAnalysis && b.userAnalysis.sampled >= 10) {
          return sum + Math.round(b.stars * b.userAnalysis.suspiciousRatio);
        }
        return sum + b.stars;
      }, 0);

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
