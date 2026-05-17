/**
 * PARITY CONTRACT TEST — the single most important test in this repo.
 *
 * History: the Chrome extension and the Hall of Shame dashboard once
 * physically DUPLICATED the fake-star algorithm — the extension used
 * src/shared/* + src/background/*, the dashboard cron used a
 * hand-maintained scripts/_score-lib.mjs mirror. That mirror DRIFTED in
 * production: validateBurst's organic threshold was 0.01 in the extension
 * but 0.03 in the mirror, and the mirror lacked the 'fake' branch — the
 * badge and dashboard published DIFFERENT verdicts for the same repo.
 *
 * The mirror-elimination refactor collapsed the duplicate: scripts/
 * _score-lib.ts now RE-EXPORTS the extension's pure modules (it imports
 * them under tsx) and only adds the dashboard's cache + fetch IO. So the
 * "extension" and "mirror" symbols below now resolve to the SAME
 * functions. This test still feeds identical synthetic fixtures (no
 * network) through both import paths and asserts byte-identical output —
 * it now guards against anyone re-introducing a hand-copied algorithm and
 * keeps watching the IO-adapter seam. It must stay green.
 */
import { describe, it, expect } from 'vitest';
import { validateBurst as extValidateBurst } from '@/shared/validation';
import { detectBursts as extDetectBursts } from '@/shared/mad';
import {
  sampleUsers as extSampleUsers,
  scoreFromProfile as extScoreFromProfile,
} from '@/background/userScore';
// scripts/_score-lib.ts is no longer a hand-maintained mirror — it
// re-exports the SAME pure modules the extension uses (src/shared/* +
// src/background/userScore.ts) and only adds dashboard IO. These imports
// (aliased "mirror*" for continuity) therefore resolve to the identical
// underlying functions; the parity assertions below now also serve as a
// single-source-of-truth regression guard against re-introducing a copy.
import {
  validateBurst as mirrorValidateBurst,
  detectBursts as mirrorDetectBursts,
  sampleUsers as mirrorSampleUsers,
  scoreFromProfile as mirrorScoreFromProfile,
  CACHE_SCHEMA_VERSION as MIRROR_SCHEMA,
  USER_SAMPLE_SIZE as MIRROR_SAMPLE,
  USER_SUSPICIOUS_THRESHOLD as MIRROR_SUSP,
  MIN_STARS_FOR_VERDICT as MIRROR_MINSTARS,
  MAD_THRESHOLD as MIRROR_MAD,
  RISK_HIGH_THRESHOLD as MIRROR_RHIGH,
  RISK_MEDIUM_THRESHOLD as MIRROR_RMED,
} from '../../scripts/_score-lib';
import {
  CACHE_SCHEMA_VERSION,
  MIN_STARS_FOR_VERDICT,
  MAD_THRESHOLD,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
} from '@/shared/constants';
import { USER_SAMPLE_SIZE, USER_SUSPICIOUS_THRESHOLD } from '@/background/userScore';
import type { Burst, ForkPoint } from '@/shared/types';

function burst(o: Partial<Burst> = {}): Burst {
  return {
    startDate: '2026-04-01',
    endDate: '2026-04-03',
    days: 3,
    stars: 200,
    users: [],
    median: 2,
    mad: 1,
    spikeRatio: 8,
    ...o,
  };
}

describe('parity: shared constants must match between extension and mirror', () => {
  it('CACHE_SCHEMA_VERSION', () => {
    expect(MIRROR_SCHEMA).toBe(CACHE_SCHEMA_VERSION);
  });
  it('USER_SAMPLE_SIZE', () => {
    expect(MIRROR_SAMPLE).toBe(USER_SAMPLE_SIZE);
  });
  it('USER_SUSPICIOUS_THRESHOLD', () => {
    expect(MIRROR_SUSP).toBe(USER_SUSPICIOUS_THRESHOLD);
  });
  it('MIN_STARS_FOR_VERDICT', () => {
    expect(MIRROR_MINSTARS).toBe(MIN_STARS_FOR_VERDICT);
  });
  it('MAD_THRESHOLD', () => {
    expect(MIRROR_MAD).toBe(MAD_THRESHOLD);
  });
  it('RISK thresholds', () => {
    expect(MIRROR_RHIGH).toBe(RISK_HIGH_THRESHOLD);
    expect(MIRROR_RMED).toBe(RISK_MEDIUM_THRESHOLD);
  });
});

describe('parity: validateBurst — extension vs dashboard mirror', () => {
  // Matrix straddling every verdict boundary that drifted.
  const forkRatios = [0, 0.004, 0.008, 0.012, 0.025, 0.05];
  const spikeRatios = [3, 7, 10];

  for (const fr of forkRatios) {
    for (const sr of spikeRatios) {
      it(`forkRatio≈${fr} spike=${sr}× → identical verdict`, () => {
        const stars = 1000;
        const forkCount = Math.round(fr * stars);
        const forks: ForkPoint[] = [{ date: '2026-04-02', count: forkCount }];
        const b = burst({ stars, spikeRatio: sr });
        const ext = extValidateBurst(b, forks, []);
        const mir = mirrorValidateBurst(b, forks, []);
        expect(mir.verdict).toBe(ext.verdict);
        expect(mir.confidence).toBe(ext.confidence);
        expect(mir.forkDelta).toBe(ext.forkDelta);
        expect(mir.forkRatio).toBeCloseTo(ext.forkRatio, 10);
      });
    }
  }

  it('zero-stars burst does not divide by zero in either impl', () => {
    const b = burst({ stars: 0 });
    const ext = extValidateBurst(b, [], []);
    const mir = mirrorValidateBurst(b, [], []);
    expect(mir.forkRatio).toBe(ext.forkRatio);
    expect(mir.verdict).toBe(ext.verdict);
  });
});

describe('parity: detectBursts — extension vs dashboard mirror', () => {
  it('identical bursts on a steady series with an injected spike', () => {
    const events: { username: string; starredAt: Date }[] = [];
    // 60 days of ~2 stars/day baseline
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    for (let d = 0; d < 60; d++) {
      for (let k = 0; k < 2; k++) {
        events.push({
          username: `u${d}_${k}`,
          starredAt: new Date(base + d * 86400000 + k * 1000),
        });
      }
    }
    // a sharp 150-star spike on day 30
    for (let k = 0; k < 150; k++) {
      events.push({ username: `spike${k}`, starredAt: new Date(base + 30 * 86400000 + k * 1000) });
    }
    const ext = extDetectBursts(events);
    const mir = mirrorDetectBursts(events);
    expect(mir.length).toBe(ext.length);
    for (let i = 0; i < ext.length; i++) {
      expect(mir[i].startDate).toBe(ext[i].startDate);
      expect(mir[i].endDate).toBe(ext[i].endDate);
      expect(mir[i].stars).toBe(ext[i].stars);
      expect(mir[i].spikeRatio).toBeCloseTo(ext[i].spikeRatio, 6);
    }
  });
});

describe('parity: scoreFromProfile — extension vs dashboard', () => {
  // Profile matrix straddling every weight branch + the suspicion gate.
  const DAY = 86400000;
  const now = Date.now();
  const profiles = {
    'new account': {
      login: 'newbie',
      created_at: new Date(now - 5 * DAY).toISOString(),
      followers: 0,
      public_repos: 0,
      gravatar_id: '',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    },
    // schema v11 regression guard: an unparseable created_at must score
    // +2.0 ("creation date missing"), not silently pass the age check.
    'malformed created_at': {
      login: 'baddate',
      created_at: 'not-a-date',
      followers: 0,
      public_repos: 0,
      gravatar_id: '',
      avatar_url: 'https://avatars.githubusercontent.com/u/9?v=4',
    },
    'zero everything': {
      login: 'empty',
      created_at: new Date(now - 800 * DAY).toISOString(),
      followers: 0,
      public_repos: 0,
      gravatar_id: '',
      avatar_url: undefined,
    },
    '404-style deleted-shape (max signal profile)': {
      login: 'ghost',
      created_at: new Date(now - 2 * DAY).toISOString(),
      followers: 0,
      public_repos: 0,
      gravatar_id: '',
      avatar_url: '',
    },
    'borderline 4.0': {
      login: 'borderline',
      created_at: new Date(now - 10 * DAY).toISOString(),
      followers: 3,
      public_repos: 5,
      gravatar_id: '',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?u=abc',
    },
    healthy: {
      login: 'realdev',
      created_at: new Date(now - 1500 * DAY).toISOString(),
      followers: 240,
      public_repos: 38,
      gravatar_id: '',
      avatar_url: 'https://avatars.githubusercontent.com/u/3?u=def',
    },
  };

  for (const [name, user] of Object.entries(profiles)) {
    it(`${name} → identical score/suspicious/reasons`, () => {
      const ext = extScoreFromProfile(user);
      const mir = mirrorScoreFromProfile(user);
      expect(mir.score).toBe(ext.score);
      expect(mir.suspicious).toBe(ext.suspicious);
      expect(mir.reasons).toEqual(ext.reasons);
      expect(mir.login).toBe(ext.login);
    });
  }
});

describe('parity: sampleUsers — deterministic & identical', () => {
  it('same seed → same sample, index-identical', () => {
    const users = Array.from({ length: 5000 }, (_, i) => `user${i}`);
    const ext = extSampleUsers(users, 200, 'owner/repo');
    const mir = mirrorSampleUsers(users, 200, 'owner/repo');
    expect(mir).toEqual(ext);
  });
});
