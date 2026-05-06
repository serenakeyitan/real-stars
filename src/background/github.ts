import { GITHUB_API_BASE, STARGAZERS_PER_PAGE } from '@/shared/constants';
import type { ForkPoint, ReferrerSnapshot, StargazerEvent } from '@/shared/types';

export type { ForkPoint, ReferrerSnapshot };

interface RawStargazer {
  starred_at: string;
  user: { login: string };
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

/**
 * Fetch stargazer timestamps. The `Accept: application/vnd.github.v3.star+json`
 * header opts into the timestamped variant of the response.
 *
 * GitHub paginates from oldest to newest. To prioritize recent stargazers
 * (which is where bought stars cluster), we walk to the last page first.
 */
export async function fetchStargazers(
  owner: string,
  repo: string,
  token: string,
  limit: number,
): Promise<StargazerEvent[]> {
  // First request to get total page count via the Link header
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
  const startPage = Math.max(1, lastPage - pagesNeeded + 1);

  const events: StargazerEvent[] = [];
  if (startPage === 1) {
    pushEvents(events, firstPage);
  }

  for (let page = Math.max(startPage, 2); page <= lastPage; page++) {
    const resp = await gh(
      `/repos/${owner}/${repo}/stargazers?per_page=${STARGAZERS_PER_PAGE}&page=${page}`,
      token,
      { Accept: 'application/vnd.github.star+json' },
    );
    if (!resp.ok) {
      if (resp.status === 403 && resp.headers.get('X-RateLimit-Remaining') === '0') {
        const reset = resp.headers.get('X-RateLimit-Reset');
        const resetAt = reset ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString() : 'soon';
        throw new Error(`rate limit hit; resets at ${resetAt}`);
      }
      throw new Error(`stargazers page ${page}: ${resp.status}`);
    }
    pushEvents(events, (await resp.json()) as RawStargazer[]);
  }

  // If startPage was 1 we already pushed page 1; otherwise we still need it for early-history context
  // — but we cap to limit anyway, so skip.

  events.sort((a, b) => a.starredAt.getTime() - b.starredAt.getTime());
  // Cap to limit, keeping the most recent
  return events.slice(-limit);
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
