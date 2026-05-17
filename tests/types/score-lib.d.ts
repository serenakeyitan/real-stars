/**
 * Ambient declaration for scripts/_score-lib.mjs — the hand-maintained
 * dashboard mirror of the extension algorithm. It is intentionally plain
 * untyped JS (the whole point of the in-progress mirror-elimination
 * refactor is to delete it). This shim exists ONLY so the parity contract
 * test (tests/unit/parity.test.ts) can import it from TypeScript without
 * tripping noImplicitAny. Loosely typed on purpose — the parity test
 * compares its output structurally against the strongly-typed extension
 * implementation, which is where the real type safety lives.
 *
 * When the mirror is eliminated, delete this file and the parity test's
 * mirror import along with it.
 */
declare module '*/scripts/_score-lib.mjs' {
  export function validateBurst(
    burst: unknown,
    forkSeries: unknown,
    referrers: unknown,
  ): {
    forkDelta: number;
    forkRatio: number;
    hasReferrerEvidence: boolean;
    topReferrers: string[];
    verdict: 'organic' | 'suspicious' | 'fake';
    confidence: number;
  };
  export function detectBursts(events: unknown): Array<{
    startDate: string;
    endDate: string;
    stars: number;
    spikeRatio: number;
    [k: string]: unknown;
  }>;
  export function sampleUsers(users: string[], n: number, seed: string): string[];
  export const CACHE_SCHEMA_VERSION: number;
  export const USER_SAMPLE_SIZE: number;
  export const USER_SUSPICIOUS_THRESHOLD: number;
  export const MIN_STARS_FOR_VERDICT: number;
  export const MAD_THRESHOLD: number;
  export const RISK_HIGH_THRESHOLD: number;
  export const RISK_MEDIUM_THRESHOLD: number;
}
