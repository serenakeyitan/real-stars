import { describe, it, expect } from 'vitest';
import { bucketByDay, median, mad, detectBursts } from '@/shared/mad';
import type { StargazerEvent } from '@/shared/types';

function event(date: string, username = 'u'): StargazerEvent {
  return { username, starredAt: new Date(`${date}T12:00:00Z`) };
}

/** Build a stream of N stargazers spread across a date range, one per day. */
function steady(startDate: string, days: number, perDay = 1): StargazerEvent[] {
  const out: StargazerEvent[] = [];
  const start = Date.parse(`${startDate}T00:00:00Z`);
  for (let d = 0; d < days; d++) {
    const date = new Date(start + d * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < perDay; i++) out.push(event(date, `u${d}-${i}`));
  }
  return out;
}

describe('median', () => {
  it('handles empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns single element', () => {
    expect(median([5])).toBe(5);
  });

  it('odd-length: middle element', () => {
    expect(median([1, 3, 5, 7, 9])).toBe(5);
    expect(median([5, 1, 9, 3, 7])).toBe(5); // unsorted input
  });

  it('even-length: average of middle two', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('mad', () => {
  it('returns zero for constant series', () => {
    expect(mad([5, 5, 5, 5], 5)).toBe(0);
  });

  it('computes median of absolute deviations', () => {
    // values: [1, 3, 5, 7, 9], median = 5
    // deviations: [4, 2, 0, 2, 4], median = 2
    expect(mad([1, 3, 5, 7, 9], 5)).toBe(2);
  });

  it('handles single deviation', () => {
    expect(mad([10], 10)).toBe(0);
  });
});

describe('bucketByDay', () => {
  it('returns empty for empty input', () => {
    expect(bucketByDay([])).toEqual([]);
  });

  it('groups same-day events into one bucket', () => {
    const result = bucketByDay([event('2026-01-01', 'a'), event('2026-01-01', 'b')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: '2026-01-01', count: 2, users: ['a', 'b'] });
  });

  it('fills date gaps with zero counts', () => {
    const result = bucketByDay([event('2026-01-01'), event('2026-01-04')]);
    expect(result).toHaveLength(4);
    expect(result.map((b) => b.count)).toEqual([1, 0, 0, 1]);
    expect(result.map((b) => b.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('sorts events chronologically before bucketing', () => {
    const result = bucketByDay([event('2026-02-01'), event('2026-01-01')]);
    expect(result[0].date).toBe('2026-01-01');
    expect(result[result.length - 1].date).toBe('2026-02-01');
  });
});

describe('detectBursts', () => {
  it('returns empty for empty input', () => {
    expect(detectBursts([])).toEqual([]);
  });

  it('does NOT flag steady organic growth as a burst', () => {
    // 60 days of 2 stars/day — perfectly stable, should produce no bursts
    const events = steady('2026-01-01', 60, 2);
    const bursts = detectBursts(events);
    expect(bursts).toHaveLength(0);
  });

  it('detects a clear injection spike on top of steady baseline', () => {
    const baseline = steady('2026-01-01', 60, 2);
    // Inject 200 stars on day 60 — way beyond MAD threshold
    const spikeDay = '2026-03-02'; // day 60 from 2026-01-01
    const spike: StargazerEvent[] = Array.from({ length: 200 }, (_, i) =>
      event(spikeDay, `bot${i}`),
    );
    const bursts = detectBursts([...baseline, ...spike]);
    expect(bursts.length).toBeGreaterThanOrEqual(1);
    // The burst should cover the spike day
    expect(bursts.some((b) => b.startDate <= spikeDay && spikeDay <= b.endDate)).toBe(true);
    // Star count in the burst should reflect the injection
    expect(bursts[0].stars).toBeGreaterThanOrEqual(200);
  });

  it('detects multi-day burst (consecutive anomalous days)', () => {
    const baseline = steady('2026-01-01', 60, 2);
    // 3 consecutive injection days, starting *after* the baseline ends
    const inj: StargazerEvent[] = [];
    for (let d = 0; d < 3; d++) {
      const date = new Date(Date.parse('2026-03-05T00:00:00Z') + d * 86400000)
        .toISOString()
        .slice(0, 10);
      for (let i = 0; i < 100; i++) inj.push(event(date, `bot${d}-${i}`));
    }
    const bursts = detectBursts([...baseline, ...inj]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].days).toBe(3);
    expect(bursts[0].stars).toBe(300);
  });

  it('uses growth-percent fallback for tiny new repos', () => {
    // Only 10 stars total spread over 5 days, then a sudden 50-star day
    const events = [
      ...steady('2026-01-01', 5, 2), // 10 stars, days 1-5
      ...Array.from({ length: 50 }, (_, i) => event('2026-01-06', `bot${i}`)),
    ];
    const bursts = detectBursts(events);
    expect(bursts.length).toBeGreaterThanOrEqual(1);
  });

  it('reports spike ratio that scales with severity', () => {
    const baseline = steady('2026-01-01', 60, 2);
    const smallSpike = [
      ...baseline,
      ...Array.from({ length: 30 }, (_, i) => event('2026-03-05', `s${i}`)),
    ];
    const largeSpike = [
      ...baseline,
      ...Array.from({ length: 500 }, (_, i) => event('2026-03-05', `l${i}`)),
    ];

    const small = detectBursts(smallSpike);
    const large = detectBursts(largeSpike);

    expect(small.length).toBeGreaterThan(0);
    expect(large.length).toBeGreaterThan(0);
    expect(large[0].spikeRatio).toBeGreaterThan(small[0].spikeRatio);
  });

  it('captures unique users in each burst', () => {
    const baseline = steady('2026-01-01', 60, 2);
    // Spike with duplicate username
    const spike: StargazerEvent[] = [];
    for (let i = 0; i < 100; i++) spike.push(event('2026-03-02', 'duplicateUser'));
    spike.push(...Array.from({ length: 50 }, (_, i) => event('2026-03-02', `unique${i}`)));

    const bursts = detectBursts([...baseline, ...spike]);
    expect(bursts).toHaveLength(1);
    // 50 unique + 1 duplicate = 51 unique
    expect(bursts[0].users.length).toBe(51);
  });
});
