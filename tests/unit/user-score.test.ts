/**
 * Direct behavioral tests for scoreFromProfile — the per-user account
 * scorer. The audit flagged its weights as untested (only parity-tested
 * for cross-product identity, never for correctness). This asserts the
 * actual scoring contract, including the schema-v11 NaN-date fix.
 */
import { describe, it, expect } from 'vitest';
import { scoreFromProfile } from '@/background/userScore';
import { USER_SUSPICIOUS_THRESHOLD } from '@/background/userScore';

const DAY = 86400000;
const now = Date.now();

function profile(over: Record<string, unknown> = {}) {
  return {
    login: 'u',
    created_at: new Date(now - 1000 * DAY).toISOString(),
    followers: 50,
    public_repos: 20,
    gravatar_id: '',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    ...over,
  } as any;
}

describe('scoreFromProfile — weight contract', () => {
  it('a healthy established account is not suspicious', () => {
    const s = scoreFromProfile(profile());
    expect(s.score).toBe(0);
    expect(s.suspicious).toBe(false);
  });

  it('new account (<30d) adds +2.0', () => {
    const s = scoreFromProfile(profile({ created_at: new Date(now - 5 * DAY).toISOString() }));
    expect(s.score).toBe(2.0);
    expect(s.reasons.some((r) => r.includes('new account'))).toBe(true);
  });

  it('zero-everything throwaway crosses the suspicion threshold', () => {
    const s = scoreFromProfile(
      profile({
        created_at: new Date(now - 3 * DAY).toISOString(),
        followers: 0,
        public_repos: 0,
        avatar_url: '',
      }),
    );
    // new(2.0) + 0 followers(1.5) + 0 repos(1.5) + default avatar(0.5)
    // + empty-combo(1.0) = 6.5
    expect(s.score).toBeGreaterThanOrEqual(USER_SUSPICIOUS_THRESHOLD);
    expect(s.suspicious).toBe(true);
  });

  // ── schema v11 regression: the bug this fixed ──────────────────────
  it('UNPARSEABLE created_at scores +2.0 instead of silently passing', () => {
    const bad = scoreFromProfile(profile({ created_at: 'not-a-date' }));
    expect(bad.score).toBe(2.0);
    expect(bad.reasons.some((r) => /creation date missing|unparseable/i.test(r))).toBe(true);
  });

  it('missing created_at (undefined) also scores +2.0, not 0', () => {
    const missing = scoreFromProfile(profile({ created_at: undefined }));
    expect(missing.score).toBe(2.0);
  });

  it('regression: a malformed-date throwaway is now flagged, not under-counted', () => {
    // Pre-v11 this exact account scored 4.5 (missed the +2.0 age signal
    // because NaN < 30 === false) and could slip under the 4.0 line in
    // borderline mixes. With the fix it scores 6.5 and is unambiguous.
    const s = scoreFromProfile(
      profile({ created_at: 'garbage', followers: 0, public_repos: 0, avatar_url: '' }),
    );
    expect(s.score).toBe(6.5);
    expect(s.suspicious).toBe(true);
  });
});
