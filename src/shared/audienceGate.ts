/**
 * Audience-aware gate — pure, isolated, unit-tested.
 *
 * Was ~25 lines inline in analyze.ts (and copy-pasted into the dashboard
 * scorer), threaded through three separate expressions via an
 * `audienceLikelyReal` boolean — impossible to test without running the
 * whole pipeline. Extracted here so it has exactly one definition, can be
 * reasoned about in isolation, and is covered by direct unit tests.
 *
 * Rationale and calibration live with the constants in constants.ts.
 */

import {
  GATE_MIN_BURST_STARS,
  GATE_MIN_SIZABLE_BURSTS,
  GATE_MIN_AVG_FORK_RATIO,
} from './constants';
import type { Burst, CrossValidation } from './types';

export interface AudienceGateResult {
  /** When true, the global per-user signal should be suppressed. */
  suppressGlobalSignal: boolean;
  /** Bursts with >= GATE_MIN_BURST_STARS stars (the ones we judged on). */
  sizableBurstCount: number;
  /** Mean fork-ratio across the sizable bursts (0 when none). */
  avgForkRatio: number;
}

/**
 * Decide whether a repo's audience looks like real developers (who fork
 * what they star) rather than a bought-fake / non-developer pool.
 *
 * Fires (suppress = true) only when BOTH:
 *   - there are at least GATE_MIN_SIZABLE_BURSTS sizable bursts, AND
 *   - their average fork-ratio is at least GATE_MIN_AVG_FORK_RATIO.
 *
 * Pure: no I/O, no Date.now(), deterministic in its inputs.
 */
export function evaluateAudienceGate(
  validatedBursts: Array<Burst & { validation: CrossValidation }>,
): AudienceGateResult {
  const sizable = validatedBursts.filter((b) => b.stars >= GATE_MIN_BURST_STARS);
  const avgForkRatio =
    sizable.length > 0
      ? sizable.reduce((sum, b) => sum + b.validation.forkRatio, 0) / sizable.length
      : 0;
  const suppressGlobalSignal =
    sizable.length >= GATE_MIN_SIZABLE_BURSTS && avgForkRatio >= GATE_MIN_AVG_FORK_RATIO;
  return {
    suppressGlobalSignal,
    sizableBurstCount: sizable.length,
    avgForkRatio,
  };
}
