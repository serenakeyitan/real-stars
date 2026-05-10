/**
 * Per-user fake-account scoring (StarGuard-style).
 *
 * For each stargazer in a detected burst, we ask GitHub for their public
 * profile and score a few features that distinguish throwaway/bot accounts
 * from real users:
 *
 *   - account_age_days < 30                  +2.0
 *   - followers < 5                           +1.0
 *   - public_repos < 2                        +1.0
 *   - default avatar (no custom avatar)       +0.5
 *
 * Score >= USER_SUSPICIOUS_THRESHOLD → likely fake account.
 *
 * Constants and weights borrowed from
 * https://github.com/m-ahmed-elbeskeri/Starguard (Apache-2.0). We use a
 * subset that needs only ONE GitHub API call per user (GET /users/{login})
 * — StarGuard's fuller version walks each user's events and starred repos,
 * which would multiply our API consumption by ~3x.
 *
 * Performance:
 *   - 6-way parallel fetch
 *   - 7-day cache in chrome.storage.local — user features rarely change
 *     day-to-day, and the same stargazer often appears across multiple
 *     repos a user analyzes
 *   - sample-only: we don't score every stargazer in a burst, just a
 *     representative sample (default 50). The score generalizes to the
 *     burst as a fraction.
 */

import { GITHUB_API_BASE } from '@/shared/constants';

export const USER_SUSPICIOUS_THRESHOLD = 4.0;
export const USER_SAMPLE_SIZE = 50;
export const USER_FETCH_CONCURRENCY = 6;
export const USER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_CACHE_PREFIX = 'real-stars:user:';

interface RawUser {
  login: string;
  created_at: string;
  followers: number;
  public_repos: number;
  gravatar_id?: string;
  // The avatar URL contains "?v=" or follows a default-avatar pattern. The
  // most reliable signal is `gravatar_id` being empty and the avatar URL
  // hostname being avatars.githubusercontent.com — but GitHub stopped
  // setting gravatar_id years ago, so we infer "default avatar" from URL
  // shape when needed.
  avatar_url?: string;
}

export interface UserScore {
  login: string;
  score: number;
  suspicious: boolean;
  reasons: string[];
  /** When this score was computed (ms epoch). For cache freshness. */
  computedAt: number;
}

interface CachedUserScore extends UserScore {
  expiresAt: number;
}

async function readCache(login: string): Promise<UserScore | null> {
  const key = `${USER_CACHE_PREFIX}${login.toLowerCase()}`;
  try {
    const result = await chrome.storage.local.get(key);
    const entry: CachedUserScore | undefined = result[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeCache(score: UserScore): Promise<void> {
  const key = `${USER_CACHE_PREFIX}${score.login.toLowerCase()}`;
  const entry: CachedUserScore = { ...score, expiresAt: Date.now() + USER_CACHE_TTL_MS };
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch {
    // chrome.storage quota or browser shutdown — non-fatal
  }
}

function scoreFromProfile(user: RawUser): UserScore {
  const reasons: string[] = [];
  let score = 0;

  const ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
  if (ageDays < 30) {
    score += 2.0;
    reasons.push(`new account (${Math.floor(ageDays)} days old)`);
  }

  // Followers — increasingly suspicious as it approaches zero.
  if (user.followers === 0) {
    score += 1.5;
    reasons.push(`zero followers`);
  } else if (user.followers < 5) {
    score += 0.5;
    reasons.push(`few followers (${user.followers})`);
  }

  // Public repos — same shape.
  if (user.public_repos === 0) {
    score += 1.5;
    reasons.push(`zero public repos`);
  } else if (user.public_repos < 2) {
    score += 0.5;
    reasons.push(`few public repos (${user.public_repos})`);
  }

  // Default avatar: gravatar_id is empty AND avatar URL is the GH-generated
  // identicon style (matches "?u=..." absent and contains only the user id).
  // Conservative: require both gravatar_id empty AND avatar_url missing
  // entirely or contains "u=" parameter (custom avatar marker).
  const hasCustomAvatar = !!user.avatar_url && /\?(v=|u=)/.test(user.avatar_url);
  const noGravatar = !user.gravatar_id || user.gravatar_id === '';
  if (!hasCustomAvatar && noGravatar) {
    score += 0.5;
    reasons.push('default avatar');
  }

  // Combination bonus: an aged account with literally zero everything
  // (followers, repos) is a strong farm-account signature even when no
  // single factor is decisive. This catches the pattern StarGuard's
  // longest-inactivity heuristic catches without needing event-history
  // calls.
  if (user.followers === 0 && user.public_repos === 0) {
    score += 1.0;
    reasons.push('account exists but is completely empty');
  }

  return {
    login: user.login,
    score,
    suspicious: score >= USER_SUSPICIOUS_THRESHOLD,
    reasons,
    computedAt: Date.now(),
  };
}

async function fetchAndScore(login: string, token: string): Promise<UserScore | null> {
  // Cache hit?
  const cached = await readCache(login);
  if (cached) return cached;

  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API_BASE}/users/${encodeURIComponent(login)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return null;
  }

  // 404: account deleted (very common for fake-star accounts after GitHub T&S
  // sweep). Treat as MAXIMALLY suspicious — a deleted account that starred
  // this repo is the strongest signal there is.
  if (resp.status === 404) {
    const score: UserScore = {
      login,
      score: 5.0,
      suspicious: true,
      reasons: ['account deleted by GitHub'],
      computedAt: Date.now(),
    };
    await writeCache(score);
    return score;
  }

  if (!resp.ok) return null;

  const user = (await resp.json()) as RawUser;
  const score = scoreFromProfile(user);
  await writeCache(score);
  return score;
}

/**
 * Score a list of usernames in parallel batches. Returns the score for
 * each user that succeeded; users with API errors are silently dropped.
 */
export async function scoreUsers(logins: string[], token: string): Promise<UserScore[]> {
  const results: UserScore[] = [];
  for (let i = 0; i < logins.length; i += USER_FETCH_CONCURRENCY) {
    const batch = logins.slice(i, i + USER_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((login) => fetchAndScore(login, token)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

/**
 * Pick a representative subset for scoring. Prefer randomness over
 * head-of-list to avoid bias from any GitHub ordering. Deterministic seed
 * (the burst's start date) makes repeat analysis stable.
 */
export function sampleUsers(users: string[], n: number, seed: string): string[] {
  if (users.length <= n) return [...users];
  const rng = mulberry32(hashSeed(seed));
  const indices = new Set<number>();
  while (indices.size < n) {
    indices.add(Math.floor(rng() * users.length));
  }
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => users[i]);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
