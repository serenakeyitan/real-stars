import { describe, it, expect } from 'vitest';
import { validateBurst } from '@/shared/validation';
import type { Burst, ForkPoint, ReferrerSnapshot } from '@/shared/types';

function makeBurst(overrides: Partial<Burst> = {}): Burst {
  return {
    startDate: '2026-04-01',
    endDate: '2026-04-03',
    days: 3,
    stars: 200,
    users: [],
    median: 2,
    mad: 1,
    spikeRatio: 8,
    ...overrides,
  };
}

describe('validateBurst', () => {
  it('classifies as organic when fork ratio is healthy', () => {
    const burst = makeBurst({ stars: 200 });
    const forks: ForkPoint[] = [
      { date: '2026-04-01', count: 1 },
      { date: '2026-04-02', count: 2 },
      { date: '2026-04-03', count: 1 },
    ];
    const result = validateBurst(burst, forks, []);
    expect(result.verdict).toBe('organic');
    expect(result.forkDelta).toBe(4);
    expect(result.forkRatio).toBeCloseTo(4 / 200);
  });

  it('classifies as organic when external referrers are present', () => {
    const burst = makeBurst({
      // Make endDate within last 14 days for the referrer signal to count
      startDate: isoDay(daysAgo(2)),
      endDate: isoDay(daysAgo(1)),
    });
    const referrers: ReferrerSnapshot[] = [
      { referrer: 'news.ycombinator.com', count: 1000, uniques: 500 },
    ];
    const result = validateBurst(burst, [], referrers);
    expect(result.verdict).toBe('organic');
    expect(result.hasReferrerEvidence).toBe(true);
    expect(result.topReferrers).toContain('news.ycombinator.com');
  });

  it('classifies as fake when no fork activity AND sharp spike', () => {
    const burst = makeBurst({ stars: 200, spikeRatio: 10 });
    const result = validateBurst(burst, [], []);
    expect(result.verdict).toBe('fake');
    expect(result.forkRatio).toBe(0);
  });

  it('classifies as suspicious when ambiguous (low forks, modest spike)', () => {
    const burst = makeBurst({ stars: 200, spikeRatio: 4 });
    const result = validateBurst(burst, [], []);
    expect(result.verdict).toBe('suspicious');
  });

  it('ignores referrer evidence for old bursts (>14 days)', () => {
    const burst = makeBurst({ startDate: '2026-01-01', endDate: '2026-01-03' });
    const referrers: ReferrerSnapshot[] = [
      { referrer: 'news.ycombinator.com', count: 1000, uniques: 500 },
    ];
    const result = validateBurst(burst, [], referrers);
    expect(result.hasReferrerEvidence).toBe(false);
  });

  it('filters out github.com self-referrers', () => {
    const burst = makeBurst({
      startDate: isoDay(daysAgo(2)),
      endDate: isoDay(daysAgo(1)),
    });
    const referrers: ReferrerSnapshot[] = [{ referrer: 'github.com', count: 1000, uniques: 500 }];
    const result = validateBurst(burst, [], referrers);
    expect(result.hasReferrerEvidence).toBe(false);
    expect(result.topReferrers).toEqual([]);
  });
});

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
