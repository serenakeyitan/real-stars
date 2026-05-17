import { describe, it, expect } from 'vitest';
import { evaluateAudienceGate } from '@/shared/audienceGate';
import {
  GATE_MIN_BURST_STARS,
  GATE_MIN_SIZABLE_BURSTS,
  GATE_MIN_AVG_FORK_RATIO,
} from '@/shared/constants';
import type { Burst, CrossValidation } from '@/shared/types';

function vb(stars: number, forkRatio: number): Burst & { validation: CrossValidation } {
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
      verdict: 'suspicious',
      confidence: 0.5,
    },
  };
}

describe('evaluateAudienceGate', () => {
  it('fires when ≥2 sizable bursts have avg fork-ratio ≥ threshold (curated-list case)', () => {
    // awesome-notebookLM-prompts shape: several bursts, healthy fork ratios
    const r = evaluateAudienceGate([vb(100, 0.14), vb(200, 0.16), vb(80, 0.13)]);
    expect(r.suppressGlobalSignal).toBe(true);
    expect(r.sizableBurstCount).toBe(3);
    expect(r.avgForkRatio).toBeCloseTo((0.14 + 0.16 + 0.13) / 3, 6);
  });

  it('does NOT fire when avg fork-ratio is below threshold (LupusLeaks/GaiaNet case)', () => {
    // bought-star repos: multiple bursts but near-zero forks
    const r = evaluateAudienceGate([vb(500, 0.031), vb(300, 0.037), vb(120, 0.02)]);
    expect(r.suppressGlobalSignal).toBe(false);
  });

  it('does NOT fire with only one sizable burst even at high fork-ratio (vscode/linux case)', () => {
    const r = evaluateAudienceGate([vb(5000, 0.4)]);
    expect(r.suppressGlobalSignal).toBe(false);
    expect(r.sizableBurstCount).toBe(1);
  });

  it('ignores sub-threshold bursts when counting sizable ones', () => {
    // Two big-fork bursts but only one is "sizable" (>= GATE_MIN_BURST_STARS)
    const tiny = GATE_MIN_BURST_STARS - 1;
    const r = evaluateAudienceGate([vb(tiny, 0.5), vb(100, 0.5)]);
    expect(r.sizableBurstCount).toBe(1);
    expect(r.suppressGlobalSignal).toBe(false);
  });

  it('handles zero bursts without dividing by zero', () => {
    const r = evaluateAudienceGate([]);
    expect(r.avgForkRatio).toBe(0);
    expect(r.suppressGlobalSignal).toBe(false);
    expect(r.sizableBurstCount).toBe(0);
  });

  it('is exactly on the boundary: count == min AND ratio == min → fires', () => {
    const bursts = Array.from({ length: GATE_MIN_SIZABLE_BURSTS }, () =>
      vb(GATE_MIN_BURST_STARS, GATE_MIN_AVG_FORK_RATIO),
    );
    const r = evaluateAudienceGate(bursts);
    expect(r.suppressGlobalSignal).toBe(true);
  });

  it('just below the ratio boundary → does not fire', () => {
    const bursts = Array.from({ length: GATE_MIN_SIZABLE_BURSTS }, () =>
      vb(GATE_MIN_BURST_STARS, GATE_MIN_AVG_FORK_RATIO - 0.001),
    );
    expect(evaluateAudienceGate(bursts).suppressGlobalSignal).toBe(false);
  });
});
