import { GITHUB_API_BASE, STARGAZERS_PER_PAGE } from '@/shared/constants';
import type { ForkPoint, ReferrerSnapshot, StargazerEvent } from '@/shared/types';

export type { ForkPoint, ReferrerSnapshot };

interface RawStargazer {
  starred_at: string;
  user: { login: string };
}

/**
 * Fetch repo metadata. We need stargazers_count for the badge — the
 * stargazer-list pagination caps at our DEFAULT_STARGAZER_LIMIT, so
 * stargazers.length is NOT the true total.
 */
export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token: string,
): Promise<{ stargazers_count: number; forks_count: number }> {
  const resp = await gh(`/repos/${owner}/${repo}`, token);
  if (!resp.ok) throw new Error(`repo metadata: ${resp.status} ${resp.statusText}`);
  const data = (await resp.json()) as { stargazers_count: number; forks_count: number };
  return { stargazers_count: data.stargazers_count, forks_count: data.forks_count };
}

async function gh(
  path: string,
  token: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
  });
}

/** Concurrent page fetches per repo. GitHub allows ~10 concurrent before
 * secondary rate limits kick in; 6 leaves headroom and is empirically fast
 * enough (33 pages in ~1s vs ~7s serial). */
const STARGAZER_FETCH_CONCURRENCY = 6;

export type StargazerSamplingStrategy = 'recent' | 'random';

/**
 * Fetch stargazer timestamps. The `Accept: application/vnd.github.v3.star+json`
 * header opts into the timestamped variant of the response.
 *
 * Two strategies (selectable via the `strategy` argument):
 *
 * - 'recent' (legacy): walk the LAST N pages, getting the most recent
 *   stargazers. Fast but biased — for popular repos, the recent slice spans
 *   only days and gives the MAD detector no historical baseline. Empirically
 *   this caused 60-100% false-positive rates on viral organic repos.
 *
 * - 'random' (default): sample N pages uniformly across the repo's full
 *   stargazer history. Always includes page 1 (creation-era baseline) and
 *   the last page (recent activity to catch in-progress fake-star episodes).
 *   The remaining pages are picked deterministically via a seeded RNG so
 *   re-runs against the same repo produce comparable results.
 *
 *   This gives the MAD detector a representative time series spanning the
 *   repo's whole life, so spikes can actually be compared against a
 *   meaningful median.
 *
 * Pages within a batch are fetched in parallel (CONCURRENCY=6).
 */
export async function fetchStargazers(
  owner: string,
  repo: string,
  token: string,
  limit: number,
  // Default 'recent' for v0.1.0. The 'random' mode is implemented but
  // currently produces near-100% false positives because the MAD detector
  // assumes a contiguous daily time series — sparse samples + zero-fill
  // collapse the rolling median to zero. Switching the default to 'random'
  // is gated on a v2 algorithm rewrite that operates on page-density
  // buckets instead of per-day buckets. See CALIBRATION.md.
  strategy: StargazerSamplingStrategy = 'recent',
): Promise<StargazerEvent[]> {
  // First request: serially, to read the Link header so we know lastPage.
  const firstResp = await gh(
    `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=1`,
    token,
    { Accept: 'application/vnd.github.star+json' },
  );
  if (!firstResp.ok) throw new Error(`stargazers: ${firstResp.status} ${firstResp.statusText}`);
  const firstPage = (await firstResp.json()) as RawStargazer[];

  const linkHeader = firstResp.headers.get('Link') ?? '';
  const lastPageMatch = linkHeader.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  const lastPage = lastPageMatch ? parseInt(lastPageMatch[1], 10) : 1;

  const pagesNeeded = Math.ceil(limit / STARGAZERS_PER_PAGE);

  let pagesToFetch: number[];
  let needFirstPage: boolean;

  if (strategy === 'recent' || lastPage <= pagesNeeded) {
    // Recent strategy, or repo small enough that we'd fetch everything anyway.
    const startPage = Math.max(1, lastPage - pagesNeeded + 1);
    pagesToFetch = [];
    for (let p = Math.max(startPage, 2); p <= lastPage; p++) pagesToFetch.push(p);
    needFirstPage = startPage === 1;
  } else {
    // Random uniform-ish sample across the full page range, anchored on
    // page 1 + lastPage. We use a deterministic PRNG seeded on the repo
    // name so repeated runs against the same repo agree.
    const seed = hashStringToSeed(`${owner}/${repo}`);
    const sample = pickEvenlySpacedPages(lastPage, pagesNeeded, seed);
    pagesToFetch = sample.filter((p) => p !== 1 && p !== undefined);
    needFirstPage = sample.includes(1);
    // Always include lastPage (most recent activity)
    if (!pagesToFetch.includes(lastPage) && lastPage !== 1) pagesToFetch.push(lastPage);
  }

  const events: StargazerEvent[] = [];
  if (needFirstPage) {
    pushEvents(events, firstPage);
  }

  // Fetch pages concurrently in CONCURRENCY-sized batches.
  for (let i = 0; i < pagesToFetch.length; i += STARGAZER_FETCH_CONCURRENCY) {
    const batch = pagesToFetch.slice(i, i + STARGAZER_FETCH_CONCURRENCY);
    const responses = await Promise.all(
      batch.map((page) =>
        gh(
          `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=${page}`,
          token,
          { Accept: 'application/vnd.github.star+json' },
        ).then(async (resp) => {
          if (!resp.ok) {
            if (resp.status === 403 && resp.headers.get('X-RateLimit-Remaining') === '0') {
              const reset = resp.headers.get('X-RateLimit-Reset');
              const resetAt = reset
                ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString()
                : 'soon';
              throw new Error(`rate limit hit; resets at ${resetAt}`);
            }
            throw new Error(`stargazers page ${page}: ${resp.status}`);
          }
          return (await resp.json()) as RawStargazer[];
        }),
      ),
    );
    for (const raw of responses) pushEvents(events, raw);
  }

  events.sort((a, b) => a.starredAt.getTime() - b.starredAt.getTime());
  return events;
}

/**
 * Pick `count` page numbers from [1, lastPage] inclusive, distributed
 * evenly with a small deterministic jitter so adjacent samples don't
 * align exactly on multiples. Always includes 1 and lastPage.
 */
function pickEvenlySpacedPages(lastPage: number, count: number, seed: number): number[] {
  if (lastPage <= count) {
    const all: number[] = [];
    for (let p = 1; p <= lastPage; p++) all.push(p);
    return all;
  }
  const rng = mulberry32(seed);
  const picked = new Set<number>([1, lastPage]);
  const stride = lastPage / (count - 1);
  for (let i = 1; i < count - 1; i++) {
    const target = Math.round(i * stride);
    // Add small jitter (up to ±stride/4) to break alignment on regular intervals
    const jitter = Math.floor((rng() - 0.5) * stride * 0.5);
    const p = Math.max(2, Math.min(lastPage - 1, target + jitter));
    picked.add(p);
  }
  // If jitter caused collisions and we lost some samples, fill greedily
  while (picked.size < count) {
    const p = 1 + Math.floor(rng() * lastPage);
    picked.add(p);
  }
  return Array.from(picked).sort((a, b) => a - b);
}

function hashStringToSeed(s: string): number {
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

function pushEvents(out: StargazerEvent[], raw: RawStargazer[]): void {
  for (const item of raw) {
    if (!item.starred_at || !item.user?.login) continue;
    const t = new Date(item.starred_at);
    if (Number.isNaN(t.getTime())) continue;
    out.push({ username: item.user.login, starredAt: t });
  }
}

/**
 * Fetch a daily series of new forks. Used to cross-validate bursts:
 * organic spikes correlate with fork increases; bought-star spikes don't.
 *
 * GitHub's fork list isn't paginated by date. We pull recent forks (sorted
 * desc by created_at) and bucket by day.
 */
export async function fetchForkTimeseries(
  owner: string,
  repo: string,
  token: string,
  maxForks = 1000,
): Promise<ForkPoint[]> {
  const perPage = 100;
  const buckets = new Map<string, number>();
  for (let page = 1; page <= Math.ceil(maxForks / perPage); page++) {
    const resp = await gh(
      `/repos/${owner}/${repo}/forks?per_page=${perPage}&page=${page}&sort=newest`,
      token,
    );
    if (!resp.ok) break;
    const items = (await resp.json()) as Array<{ created_at: string }>;
    if (items.length === 0) break;
    for (const item of items) {
      if (!item.created_at) continue;
      const day = item.created_at.slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    if (items.length < perPage) break;
  }
  return [...buckets.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch top traffic referrers (last 14 days). Real spikes show external
 * referrers like news.ycombinator.com, reddit.com, twitter.com.
 *
 * Note: this endpoint requires push access to the repo. For repos the user
 * doesn't own, the call will 403. We treat that as "no signal" rather than
 * an error.
 */
export async function fetchTrafficReferrers(
  owner: string,
  repo: string,
  token: string,
): Promise<ReferrerSnapshot[]> {
  const resp = await gh(`/repos/${owner}/${repo}/traffic/popular/referrers`, token);
  if (!resp.ok) return [];
  return (await resp.json()) as ReferrerSnapshot[];
}
