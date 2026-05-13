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

    // Per-user analysis on the WHOLE stargazer slice (not just bursts).
    // This is the live equivalent of StarScout's low-activity heuristic —
    // we look for throwaway-account fingerprints (new account, no
    // followers, no repos, default avatar) across all stargazers.
    //
    // Critical: bought-star episodes that DON'T form a tight time-series
    // burst (e.g. spread evenly over weeks) are invisible to MAD detection
    // but very visible at the user-level — every account is empty.
    // Sampling at the global level catches these. LupusLeaks/EasyFN is
    // exactly this case: 92% of stargazers are completely empty accounts
    // but only some form burst spikes.
    //
    // Cost: USER_SAMPLE_SIZE GitHub API calls (one per sampled stargazer),
    // 7-day cached. ~7s with 6-way parallelism. We pay this once per repo
    // analysis, not per burst.
    const allUsers = stargazers.map((s) => s.username);
    const globalSample = sampleUsers(allUsers, USER_SAMPLE_SIZE, `${owner}/${repo}`);
    const globalScores = await scoreUsers(globalSample, token);
    const globalSuspiciousCount = globalScores.filter((s) => s.suspicious).length;
    const globalUserAnalysis: UserScoreSummary = {
      sampled: globalScores.length,
      suspicious: globalSuspiciousCount,
      suspiciousRatio: globalScores.length > 0 ? globalSuspiciousCount / globalScores.length : 0,
      examples: globalScores
        .filter((s) => s.suspicious)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(({ login, score, reasons }) => ({ login, score, reasons })),
    };

    // Per-burst analysis: re-use the global cache (those user scores are
    // already in chrome.storage.local). For each burst, just look up which
    // of its users we already scored and tally.
    const globalScoreByLogin = new Map(globalScores.map((s) => [s.login.toLowerCase(), s]));
    const userAnalyses = new Map<string, UserScoreSummary>();
    for (const b of initialValidated.filter((b) => b.users.length > 0)) {
      // Sample the burst's users and look them up in global; for users
      // we haven't scored yet, fetch (cheap because cached if already
      // scored elsewhere).
      const burstSample = sampleUsers(b.users, USER_SAMPLE_SIZE, b.startDate);
      const fromCache = burstSample
        .map((u) => globalScoreByLogin.get(u.toLowerCase()))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);
      const missing = burstSample.filter((u) => !globalScoreByLogin.has(u.toLowerCase()));
      const fresh = await scoreUsers(missing, token);
      for (const s of fresh) globalScoreByLogin.set(s.login.toLowerCase(), s);
      const allScores = [...fromCache, ...fresh];
      const suspiciousCount = allScores.filter((s) => s.suspicious).length;
      const summary: UserScoreSummary = {
        sampled: allScores.length,
        suspicious: suspiciousCount,
        suspiciousRatio: allScores.length > 0 ? suspiciousCount / allScores.length : 0,
        examples: allScores
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

    // The fake-star estimate has two signals:
    //
    //   (a) BURST signal: stars that fell inside a detected non-organic
    //       burst, scaled by that burst's per-user ratio when known.
    //   (b) GLOBAL signal: total_stars × global_user_suspicious_ratio.
    //
    // Take the MAX. A repo that buys "evenly" (no burst spike) but where
    // 90% of stargazers are empty accounts deserves to be called out — the
    // global signal catches this. A repo with a sharp burst of mostly real
    // accounts but one bad cluster gets caught by the burst signal.
    //
    // Either signal alone misses cases the other catches; their max is the
    // best lower-bound estimate of fake stars.
    const burstSuspiciousStars = validatedBursts
      .filter((b) => b.validation.verdict !== 'organic')
      .reduce((sum: number, b) => {
        if (b.userAnalysis && b.userAnalysis.sampled >= 10) {
          return sum + Math.round(b.stars * b.userAnalysis.suspiciousRatio);
        }
        return sum + b.stars;
      }, 0);

    // Global signal: the global user-analysis is sampled from the analyzed
    // slice (last 5000 stars), not the whole repo. So we apply the ratio
    // to analyzedStars, not totalStars — gives a calibrated estimate that
    // matches what we actually inspected.
    const globalSuspiciousStars =
      globalUserAnalysis.sampled >= 10
        ? Math.round(stargazers.length * globalUserAnalysis.suspiciousRatio)
        : 0;

    // ─── Audience-aware gate ────────────────────────────────────────────
    // The global per-user signal over-flags repos with non-developer
    // audiences (curated lists, prompt collections) because real users
    // who only star — never code — look profile-identical to bought-fake
    // accounts (zero followers, zero repos, default avatar).
    //
    // Discriminator: real-developer audiences fork the repos they star.
    // Bought-fake accounts never fork.
    //
    // If at least 2 sizable bursts (≥20 stars each) have an average
    // fork-ratio ≥5%, we have strong evidence the audience contains real
    // active developers, and we suppress the global signal.
    //
    // This preserves recall on actual bought-star repos:
    //   - LupusLeaks/EasyFN: avg burst fork-ratio 3.1% → gate doesn't fire
    //   - GaiaNet-AI/gaianet-node: 3.7% → gate doesn't fire
    //   - microsoft/vscode, torvalds/linux: only 1 burst → gate doesn't fire
    //
    // And it fixes the curated-list false positives:
    //   - awesome-notebookLM-prompts: 5 bursts, avg fork-ratio 14.9%
    //     → gate fires, 18% MEDIUM → 0.2% LOW
    const sizableBursts = validatedBursts.filter((b) => b.stars >= 20);
    const avgBurstForkRatio =
      sizableBursts.length > 0
        ? sizableBursts.reduce((s, b) => s + b.validation.forkRatio, 0) / sizableBursts.length
        : 0;
    const audienceLikelyReal =
      sizableBursts.length >= 2 && avgBurstForkRatio >= 0.05;
    const gatedGlobalSuspiciousStars = audienceLikelyReal ? 0 : globalSuspiciousStars;

    const suspiciousStars = Math.max(burstSuspiciousStars, gatedGlobalSuspiciousStars);

    const analyzedTotal = stargazers.length;
    const realStars = Math.max(0, meta.stargazers_count - suspiciousStars);
    // Denominator: when we have a global per-user signal AND the audience
    // gate didn't fire, we trust that ratio applies to the WHOLE repo
    // (not just the analyzed slice). When the gate fires, the global
    // signal is unreliable for this audience type, so fall back to the
    // burst-only fakePercent.
    const fakePercent =
      globalUserAnalysis.sampled >= 10 && !audienceLikelyReal
        ? globalUserAnalysis.suspiciousRatio * 100
        : meta.stargazers_count > 0
          ? (suspiciousStars / meta.stargazers_count) * 100
          : 0;

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
    else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

    // For the displayed `realStars`, use the global ratio applied to the
    // TRUE repo total (so vscode shows "184k real" not "5k real"). When
    // the audience gate fires, use the burst-only suspiciousStars subtracted
    // from total instead.
    const realStarsForDisplay =
      globalUserAnalysis.sampled >= 10 && !audienceLikelyReal
        ? Math.round(meta.stargazers_count * (1 - globalUserAnalysis.suspiciousRatio))
        : realStars;

    const result: AnalysisResult = {
      owner,
      repo,
      totalStars: meta.stargazers_count,
      analyzedStars: analyzedTotal,
      bursts,
      validatedBursts,
      suspiciousStars,
      realStars: realStarsForDisplay,
      fakePercent,
      riskLevel,
      globalUserAnalysis,
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
