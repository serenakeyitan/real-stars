/**
 * Pure verdict computation — the final scoring math, isolated.
 *
 * This was ~55 lines inline at the end of handleAnalyzeRepo (and mirrored
 * in the dashboard scorer): two suspicious-star signals, the audience
 * gate, the fakePercent denominator switch, risk banding, and the display
 * real-star count — all entangled with the I/O orchestration and
 * impossible to unit-test. The audit flagged it as the core fake-count
 * formula with zero direct coverage.
 *
 * Extracted here as a deterministic function of already-fetched data:
 * no network, no cache, no Date.now(). analyze.ts and _score-lib.ts both
 * call this one definition (same single-source principle as the algorithm
 * mirror elimination — the parity test guards it).
 */

import { evaluateAudienceGate } from './audienceGate';
import { RISK_HIGH_THRESHOLD, RISK_MEDIUM_THRESHOLD } from './constants';
import type { Burst, CrossValidation, UserScoreSummary } from './types';

/** A burst after cross-validation + optional per-burst user analysis. */
export type ValidatedBurst = Burst & {
  validation: CrossValidation;
  userAnalysis?: UserScoreSummary;
};

export interface VerdictInput {
  validatedBursts: ValidatedBurst[];
  globalUserAnalysis: UserScoreSummary;
  /** Stargazers actually analyzed (the recent slice, capped). */
  analyzedStars: number;
  /** True repo star total (the verdict denominator when trusted). */
  totalStars: number;
}

export interface Verdict {
  suspiciousStars: number;
  /** Real-star count for display (applied to the TRUE repo total). */
  realStarsForDisplay: number;
  fakePercent: number;
  riskLevel: 'low' | 'medium' | 'high';
  /** Whether the audience gate suppressed the global signal. */
  audienceGated: boolean;
}

/** Minimum sampled users before the global per-user signal is trusted. */
const MIN_GLOBAL_SAMPLE = 10;

/**
 * Combine the burst signal and the global per-user signal into the final
 * verdict. Pure and deterministic in its inputs.
 *
 * Two independent fake-star signals, combined via max:
 *   (a) BURST: stars inside a non-organic burst, scaled by that burst's
 *       per-user suspicious ratio when we sampled it.
 *   (b) GLOBAL: analyzed-slice size × global suspicious ratio.
 * Either alone misses cases the other catches; their max is the best
 * lower-bound estimate. The audience gate zeroes (b) when the burst
 * fork-ratios indicate a real-developer audience (see audienceGate.ts).
 */
export function computeVerdict(input: VerdictInput): Verdict {
  const { validatedBursts, globalUserAnalysis, analyzedStars, totalStars } = input;

  const burstSuspiciousStars = validatedBursts
    .filter((b) => b.validation.verdict !== 'organic')
    .reduce((sum: number, b) => {
      if (b.userAnalysis && b.userAnalysis.sampled >= MIN_GLOBAL_SAMPLE) {
        return sum + Math.round(b.stars * b.userAnalysis.suspiciousRatio);
      }
      return sum + b.stars;
    }, 0);

  const globalSuspiciousStars =
    globalUserAnalysis.sampled >= MIN_GLOBAL_SAMPLE
      ? Math.round(analyzedStars * globalUserAnalysis.suspiciousRatio)
      : 0;

  const audienceGated = evaluateAudienceGate(validatedBursts).suppressGlobalSignal;
  const gatedGlobalSuspiciousStars = audienceGated ? 0 : globalSuspiciousStars;

  const suspiciousStars = Math.max(burstSuspiciousStars, gatedGlobalSuspiciousStars);
  const realStars = Math.max(0, totalStars - suspiciousStars);

  // Denominator: trust the global ratio against the WHOLE repo only when
  // we have a real sample AND the gate didn't fire. Otherwise fall back
  // to suspicious/total.
  const trustGlobal = globalUserAnalysis.sampled >= MIN_GLOBAL_SAMPLE && !audienceGated;
  const fakePercent = trustGlobal
    ? globalUserAnalysis.suspiciousRatio * 100
    : totalStars > 0
      ? (suspiciousStars / totalStars) * 100
      : 0;

  let riskLevel: Verdict['riskLevel'] = 'low';
  if (fakePercent / 100 >= RISK_HIGH_THRESHOLD) riskLevel = 'high';
  else if (fakePercent / 100 >= RISK_MEDIUM_THRESHOLD) riskLevel = 'medium';

  const realStarsForDisplay = trustGlobal
    ? Math.round(totalStars * (1 - globalUserAnalysis.suspiciousRatio))
    : realStars;

  return { suspiciousStars, realStarsForDisplay, fakePercent, riskLevel, audienceGated };
}
