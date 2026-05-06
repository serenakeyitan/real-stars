/**
 * Sliding-window MAD (Median Absolute Deviation) burst detection.
 *
 * Ported from StarGuard
 * (https://github.com/m-ahmed-elbeskeri/Starguard, Apache-2.0):
 *   starguard/analyzers/burst_detector.py :: BurstDetector.detect_bursts
 *
 * Algorithm:
 *   1. Bucket stargazer events by UTC day → daily count series.
 *   2. For each day i ≥ WINDOW_SIZE, compute the rolling median and MAD of
 *      the previous WINDOW_SIZE days.
 *   3. Flag day i as anomalous if today_count > median + MAD_THRESHOLD * MAD.
 *      The MAD_THRESHOLD constant (3.0 * 1.4826 ≈ 4.44) is the normal-
 *      distribution-equivalent of "3 sigma" — values that extreme have <0.3%
 *      probability of arising from natural variance.
 *   4. For tiny repos that haven't accumulated MIN_STAR_COUNT yet, fall back
 *      to a percent-growth threshold (MIN_STARS_GROWTH_PERCENT).
 *   5. Group consecutive anomalous days into bursts.
 */

import { MAD_THRESHOLD, WINDOW_SIZE, MIN_STAR_COUNT, MIN_STARS_GROWTH_PERCENT } from './constants';
import type { Burst, DailyBucket, StargazerEvent } from './types';

export function bucketByDay(events: StargazerEvent[]): DailyBucket[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.starredAt.getTime() - b.starredAt.getTime());
  const map = new Map<string, { count: number; users: string[] }>();
  for (const ev of sorted) {
    const day = isoDay(ev.starredAt);
    const entry = map.get(day) ?? { count: 0, users: [] };
    entry.count++;
    entry.users.push(ev.username);
    map.set(day, entry);
  }

  // Fill date gaps with zero-count days so the rolling window is contiguous
  const minDay = isoDay(sorted[0].starredAt);
  const maxDay = isoDay(sorted[sorted.length - 1].starredAt);
  const result: DailyBucket[] = [];
  let cursor = parseDay(minDay);
  const end = parseDay(maxDay);
  while (cursor <= end) {
    const date = isoDay(new Date(cursor));
    const entry = map.get(date);
    result.push({ date, count: entry?.count ?? 0, users: entry?.users ?? [] });
    cursor += 86400000;
  }
  return result;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

export interface DetectOptions {
  windowSize?: number;
  madThreshold?: number;
  minStarCount?: number;
  minGrowthPercent?: number;
}

export function detectBursts(events: StargazerEvent[], opts: DetectOptions = {}): Burst[] {
  const windowSize = opts.windowSize ?? WINDOW_SIZE;
  const madThreshold = opts.madThreshold ?? MAD_THRESHOLD;
  const minStarCount = opts.minStarCount ?? MIN_STAR_COUNT;
  const minGrowthPercent = opts.minGrowthPercent ?? MIN_STARS_GROWTH_PERCENT;

  const buckets = bucketByDay(events);
  if (buckets.length === 0) return [];

  // Minimum-baseline guard for high-density slices.
  //
  // A viral repo getting hundreds of stars/day fills our stargazer cap in
  // a few days, so the analyzed slice spans a tiny window that's all
  // "spike" by definition. The rolling median/MAD has no historical
  // baseline to compare against — every day looks anomalous because the
  // 28-day window is itself part of the burst.
  //
  // We refuse to call bursts when the slice covers fewer than 2 * windowSize
  // days AND has a high average stars/day (indicating viral truncation,
  // not a genuinely tiny repo). Tiny repos with low density still fall
  // through to the percent-growth fallback and can flag bursts there.
  //
  // See CALIBRATION.md for the empirical motivation.
  const MIN_BASELINE_DAYS = windowSize * 2;
  const totalStars = buckets.reduce((s, b) => s + b.count, 0);
  const avgStarsPerDay = totalStars / buckets.length;
  const HIGH_DENSITY_THRESHOLD = 10; // stars/day — calibrated against StarScout ground truth (see CALIBRATION.md, 2026-05-06)
  if (buckets.length < MIN_BASELINE_DAYS && avgStarsPerDay > HIGH_DENSITY_THRESHOLD) return [];

  // Cumulative star count up to *before* each day
  const cumulative: number[] = [];
  let runningTotal = 0;
  for (const b of buckets) {
    cumulative.push(runningTotal);
    runningTotal += b.count;
  }

  const flags: boolean[] = new Array(buckets.length).fill(false);
  const stats: Array<{ median: number; mad: number; spikeRatio: number }> = [];

  for (let i = 0; i < buckets.length; i++) {
    const today = buckets[i].count;
    const cumBefore = cumulative[i];

    let med = 0;
    let m = 0;

    if (i >= windowSize) {
      const window = buckets.slice(i - windowSize, i).map((b) => b.count);
      med = median(window);
      m = mad(window, med);
    }

    let isAnomaly = false;
    let spikeRatio = 0;

    if (cumBefore >= minStarCount && m > 0.001 && i >= windowSize) {
      const threshold = med + madThreshold * m;
      if (today > threshold && today > med + 1) {
        isAnomaly = true;
        spikeRatio = m > 0 ? (today - med) / m : Infinity;
      }
    } else if (today > 0) {
      // Fallback for tiny repos / zero-MAD periods
      const pct = (today / Math.max(1, cumBefore)) * 100;
      const significantJump = today > Math.max(5, med * 2);
      if ((pct > minGrowthPercent && today > 5) || significantJump) {
        isAnomaly = true;
        spikeRatio = pct;
      }
    }

    flags[i] = isAnomaly;
    stats.push({ median: med, mad: m, spikeRatio });
  }

  // Group consecutive anomalous days into bursts
  const bursts: Burst[] = [];
  let cursor = 0;
  while (cursor < buckets.length) {
    if (!flags[cursor]) {
      cursor++;
      continue;
    }
    const start = cursor;
    let end = cursor;
    while (end + 1 < buckets.length && flags[end + 1]) end++;

    const slice = buckets.slice(start, end + 1);
    const stars = slice.reduce((sum, b) => sum + b.count, 0);
    const users = ([] as string[]).concat(...slice.map((b) => b.users));

    bursts.push({
      startDate: slice[0].date,
      endDate: slice[slice.length - 1].date,
      days: slice.length,
      stars,
      users: Array.from(new Set(users)),
      median: stats[start].median,
      mad: stats[start].mad,
      spikeRatio: Math.max(...slice.map((_, idx) => stats[start + idx].spikeRatio)),
    });

    cursor = end + 1;
  }

  return bursts;
}

function isoDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDay(s: string): number {
  return Date.parse(`${s}T00:00:00Z`);
}
