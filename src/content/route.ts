/**
 * Parse owner/repo from a GitHub URL. Returns null if the URL isn't a repo
 * home page (we don't want to inject on /settings, /pulls, /issues, etc).
 */
export function parseRepoFromUrl(url: string): { owner: string; name: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // malformed URL → not a repo page, don't inject
  }
  if (parsed.hostname !== 'github.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, name, ...rest] = segments;

  // Filter out reserved GitHub paths
  const reserved = new Set([
    'settings',
    'marketplace',
    'topics',
    'collections',
    'trending',
    'explore',
    'notifications',
    'new',
    'about',
    'pricing',
    'features',
    'enterprise',
    'security',
    'login',
    'signup',
    'logout',
    'organizations',
    'sponsors',
    'codespaces',
    'issues',
    'pulls',
    'search',
  ]);
  if (reserved.has(owner)) return null;

  // Only inject on the repo home page (no extra path segments like /pull/123,
  // /tree/main, /blob/...). We tolerate trailing slashes and hash/query.
  if (rest.length > 0) return null;

  // Sanity check the owner/name shape
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;

  return { owner, name };
}
