/**
 * Cross-validation layer for detected bursts.
 *
 * A statistical spike alone has too many false positives — Hacker News front
 * page hits look identical to bought-star injections. We add two cheap signals
 * that distinguish real virality from artificial spikes:
 *
 * 1. Fork ratio: real spikes correlate with fork increases (people fork what
 *    they discover via virality). Bought stars don't bring forks.
 * 2. Traffic referrers: real spikes leave referrer evidence (HN, Reddit,
 *    Twitter). Bought stars come from direct hits with no referrer story.
 *
 * The traffic API requires push access to the repo, so we treat its absence
 * as "no signal" rather than failure.
 */

import type { Burst, CrossValidation, ForkPoint, ReferrerSnapshot } from './types';

export function validateBurst(
  burst: Burst,
  forkSeries: ForkPoint[],
  referrers: ReferrerSnapshot[],
): CrossValidation {
  // Fork delta during the burst window
  const startTs = Date.parse(`${burst.startDate}T00:00:00Z`);
  const endTs = Date.parse(`${burst.endDate}T23:59:59Z`);
  const forksInWindow = forkSeries
    .filter((p) => {
      const t = Date.parse(`${p.date}T00:00:00Z`);
      return t >= startTs && t <= endTs;
    })
    .reduce((sum, p) => sum + p.count, 0);
  const forkRatio = burst.stars > 0 ? forksInWindow / burst.stars : 0;

  // Referrer evidence: any non-GitHub referrer with meaningful traffic during
  // the burst window. The traffic API only goes back 14 days, so this only
  // helps for very recent bursts.
  const burstWithin14d = Date.now() - endTs < 14 * 86400 * 1000;
  const externalReferrers = referrers
    .filter((r) => !r.referrer.toLowerCase().includes('github'))
    .filter((r) => r.uniques >= 5);
  const hasReferrerEvidence = burstWithin14d && externalReferrers.length > 0;
  const topReferrers = externalReferrers.slice(0, 5).map((r) => r.referrer);

  // Heuristic verdict:
  //   - If fork ratio is healthy (>= 1%) → likely organic
  //   - If we have referrer evidence → likely organic
  //   - If fork ratio is near zero AND spike was sharp → suspicious/fake
  //   - Otherwise → suspicious by default (we wouldn't have detected the
  //     spike if it weren't anomalous)
  let verdict: CrossValidation['verdict'];
  let confidence: number;

  if (forkRatio >= 0.01 || hasReferrerEvidence) {
    verdict = 'organic';
    confidence = 0.7;
  } else if (forkRatio < 0.005 && burst.spikeRatio > 6) {
    verdict = 'fake';
    confidence = 0.75;
  } else {
    verdict = 'suspicious';
    confidence = 0.5;
  }

  return {
    forkDelta: forksInWindow,
    forkRatio,
    hasReferrerEvidence,
    topReferrers,
    verdict,
    confidence,
  };
}
