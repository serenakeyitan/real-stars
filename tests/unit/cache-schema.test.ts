import { describe, it, expect } from 'vitest';
import { CACHE_SCHEMA_VERSION } from '@/shared/constants';
import type { CachedAnalysis } from '@/shared/types';

/**
 * Cache schema version is the canary that prevents users from seeing
 * results computed under a pre-fix algorithm after the extension auto-
 * updates. These tests document the contract.
 */

describe('CACHE_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(CACHE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(CACHE_SCHEMA_VERSION)).toBe(true);
  });

  it('CachedAnalysis type requires schemaVersion', () => {
    // Compile-time check: this object MUST have schemaVersion or tsc would
    // fail. Runtime check: the field exists and has the right type.
    const entry: CachedAnalysis = {
      owner: 'a',
      repo: 'b',
      totalStars: 0,
      analyzedStars: 0,
      bursts: [],
      validatedBursts: [],
      suspiciousStars: 0,
      realStars: 0,
      fakePercent: 0,
      riskLevel: 'low',
      analyzedAt: 0,
      cachedAt: 0,
      ttlMs: 0,
      schemaVersion: CACHE_SCHEMA_VERSION,
    };
    expect(entry.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
  });

  it('current version is at least 4 (per-user heuristics bump)', () => {
    // Schema bumps:
    //   v2: fakePercent denominator fix (vscode 69% → 99%)
    //   v3: StarScout snapshot lookup (later removed — snapshot was stale)
    //   v4: per-user heuristics on burst stargazers (real-time, replaces v3)
    // Reverting below this floor would silently re-expose users to
    // earlier verdicts.
    expect(CACHE_SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  });
});
