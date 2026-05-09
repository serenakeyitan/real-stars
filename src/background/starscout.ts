/**
 * Client for the Worker's /check endpoint — StarScout fake-repo lookup.
 *
 * StarScout (ICSE 2026, https://arxiv.org/abs/2412.13459) published a
 * 250101-snapshot dataset of 13.5k repos flagged via two heuristics:
 *
 *   - low-activity:  the stargazer pool is dominated by accounts that
 *                    only ever starred this one repo (throwaway-account
 *                    fingerprint of cheap fake-star sellers)
 *   - lockstep:      the same group of accounts has hit many repos in
 *                    coordinated time windows (sophisticated farms)
 *
 * 90% of repos StarScout flagged were later deleted by GitHub Trust &
 * Safety — the strongest external validation any fake-star detector has.
 *
 * Calling this layer first, before any heuristic, lets us serve
 * peer-reviewed ground truth when available and fall back to our own
 * burst-detection only on the long tail.
 */

import type { StarScoutVerdict } from '@/shared/types';
import { STARSCOUT_CHECK_URL } from '@/shared/constants';

interface CheckResponse {
  hit: boolean;
  totalStars?: number;
  fakeStars?: number;
  fakeRatio?: number;
  detectedBy?: Array<'low-activity' | 'lockstep'>;
  snapshot?: string;
}

/**
 * Look up `owner/name` in the StarScout dataset via the Worker.
 *
 * Returns null if the repo is not in the dataset (the common case for any
 * repo that doesn't have suspected fake stars), or if the Worker is down
 * (we silently degrade to heuristic-only analysis rather than blocking).
 */
export async function checkStarScout(
  owner: string,
  repo: string,
): Promise<StarScoutVerdict | null> {
  const url = `${STARSCOUT_CHECK_URL}?repo=${encodeURIComponent(`${owner}/${repo}`)}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      // Workers caches at the edge; the same lookup will hit cache.
      // We still want our own chrome.storage.local cache (much closer)
      // but that's handled at the analyze.ts layer.
      method: 'GET',
    });
  } catch (err) {
    // Network failure — gracefully degrade. Don't surface to the user
    // since the heuristic layer can still run.
    console.warn('[real-stars] StarScout lookup network error:', err);
    return null;
  }

  if (!resp.ok) {
    console.warn('[real-stars] StarScout lookup returned', resp.status);
    return null;
  }

  let data: CheckResponse;
  try {
    data = (await resp.json()) as CheckResponse;
  } catch {
    return null;
  }

  if (!data.hit) return null;

  // Defensive: validate the shape before trusting it.
  if (
    typeof data.totalStars !== 'number' ||
    typeof data.fakeStars !== 'number' ||
    typeof data.fakeRatio !== 'number' ||
    !Array.isArray(data.detectedBy) ||
    typeof data.snapshot !== 'string'
  ) {
    console.warn('[real-stars] StarScout response missing fields:', data);
    return null;
  }

  return {
    source: 'starscout',
    totalStarsAtSnapshot: data.totalStars,
    fakeStars: data.fakeStars,
    fakeRatio: data.fakeRatio,
    detectedBy: data.detectedBy,
    snapshot: data.snapshot,
  };
}
