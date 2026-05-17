/**
 * Direct tests for computeVerdict — the final fake-star scoring math.
 * This was inline in handleAnalyzeRepo and impossible to unit-test (you
 * had to run the whole network pipeline). The audit flagged it as the
 * core fake-count formula with zero direct coverage. Now isolated + pure.
 */
import { describe, it, expect } from 'vitest';
import { computeVerdict, type ValidatedBurst } from '@/shared/verdict';
import type { UserScoreSummary } from '@/shared/types';

function vb(
  stars: number,
  forkRatio: number,
  verdict: 'organic' | 'suspicious' | 'fake',
  userSusp?: number,
): ValidatedBurst {
  return {
    startDate: '2026-04-01',
    endDate: '2026-04-02',
    days: 2,
    stars,
    users: [],
    median: 1,
    mad: 1,
    spikeRatio: 5,
    validation: {
      forkDelta: Math.round(stars * forkRatio),
      forkRatio,
      hasReferrerEvidence: false,
      topReferrers: [],
      verdict,
      confidence: 0.5,
    },
    ...(userSusp !== undefined
      ? {
          userAnalysis: {
            sampled: 50,
            suspicious: Math.round(50 * userSusp),
            suspiciousRatio: userSusp,
            examples: [],
          },
        }
      : {}),
  };
}

function gua(sampled: number, ratio: number): UserScoreSummary {
  return { sampled, suspicious: Math.round(sampled * ratio), suspiciousRatio: ratio, examples: [] };
}

describe('computeVerdict', () => {
  it('clean repo: no suspicious bursts, low global → LOW, ~0%', () => {
    const v = computeVerdict({
      validatedBursts: [vb(500, 0.2, 'organic')],
      globalUserAnalysis: gua(200, 0.01),
      analyzedStars: 5000,
      totalStars: 50000,
    });
    expect(v.riskLevel).toBe('low');
    expect(v.fakePercent).toBeCloseTo(1, 5);
    expect(v.audienceGated).toBe(false);
  });

  it('heavily bought: high global ratio, no fork defense → HIGH', () => {
    const v = computeVerdict({
      validatedBursts: [vb(4000, 0.001, 'fake')],
      globalUserAnalysis: gua(200, 0.86),
      analyzedStars: 5000,
      totalStars: 6900,
    });
    expect(v.riskLevel).toBe('high');
    expect(v.fakePercent).toBeCloseTo(86, 1);
  });

  it('audience gate fires: ≥2 sizable bursts w/ healthy fork → global suppressed, LOW', () => {
    // curated-list shape: high global suspicious ratio BUT real-dev forks
    const v = computeVerdict({
      validatedBursts: [
        vb(100, 0.14, 'organic'),
        vb(200, 0.16, 'organic'),
        vb(90, 0.13, 'organic'),
      ],
      globalUserAnalysis: gua(200, 0.15),
      analyzedStars: 2800,
      totalStars: 2800,
    });
    expect(v.audienceGated).toBe(true);
    // global (15%) suppressed → falls back to burst-only (all organic = 0)
    expect(v.suspiciousStars).toBe(0);
    expect(v.riskLevel).toBe('low');
  });

  it('max(burst, global): burst signal wins when global is low', () => {
    const v = computeVerdict({
      validatedBursts: [vb(1000, 0, 'fake')], // 1000 suspicious stars
      globalUserAnalysis: gua(200, 0.02), // global ≈ 100 on 5000
      analyzedStars: 5000,
      totalStars: 10000,
    });
    // burst (1000) > global (100) → suspiciousStars = 1000
    expect(v.suspiciousStars).toBe(1000);
  });

  it('low global sample (<10) → global signal disabled, denominator falls back', () => {
    const v = computeVerdict({
      validatedBursts: [vb(300, 0, 'suspicious')],
      globalUserAnalysis: gua(4, 0.9), // sampled < 10 → ignored
      analyzedStars: 300,
      totalStars: 1500,
    });
    // global ignored; suspiciousStars from burst = 300; pct = 300/1500
    expect(v.fakePercent).toBeCloseTo(20, 5);
  });

  it('per-burst user ratio scales the burst contribution', () => {
    const v = computeVerdict({
      validatedBursts: [vb(1000, 0, 'suspicious', 0.4)], // 40% of 1000 = 400
      globalUserAnalysis: gua(4, 0),
      analyzedStars: 1000,
      totalStars: 5000,
    });
    expect(v.suspiciousStars).toBe(400);
  });

  it('risk banding boundaries: exactly 10% → medium, exactly 20% → high', () => {
    const med = computeVerdict({
      validatedBursts: [],
      globalUserAnalysis: gua(200, 0.1),
      analyzedStars: 5000,
      totalStars: 5000,
    });
    expect(med.riskLevel).toBe('medium');
    const high = computeVerdict({
      validatedBursts: [],
      globalUserAnalysis: gua(200, 0.2),
      analyzedStars: 5000,
      totalStars: 5000,
    });
    expect(high.riskLevel).toBe('high');
  });

  it('zero totalStars does not divide by zero', () => {
    const v = computeVerdict({
      validatedBursts: [],
      globalUserAnalysis: gua(0, 0),
      analyzedStars: 0,
      totalStars: 0,
    });
    expect(v.fakePercent).toBe(0);
    expect(v.riskLevel).toBe('low');
    expect(Number.isFinite(v.suspiciousStars)).toBe(true);
  });
});
