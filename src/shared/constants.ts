// Algorithm constants ported from StarGuard
// (https://github.com/m-ahmed-elbeskeri/Starguard, Apache-2.0)
// starguard/analyzers/constants.py

/** MAD threshold: 3.0 * 1.4826 ≈ 3 sigma equivalent under normal distribution */
export const MAD_THRESHOLD = 3.0 * 1.48;

/** Sliding window size in days for MAD computation */
export const WINDOW_SIZE = 28;

/** Minimum cumulative stars before MAD detection kicks in */
export const MIN_STAR_COUNT = 30;

/** Fallback growth threshold (%) for tiny repos */
export const MIN_STARS_GROWTH_PERCENT = 300;

/** Burst classification thresholds for the simplified v1 score */
export const RISK_HIGH_THRESHOLD = 0.3;
export const RISK_MEDIUM_THRESHOLD = 0.1;

/** GitHub API */
export const GITHUB_API_BASE = 'https://api.github.com';
export const STARGAZERS_PER_PAGE = 100;

/** Default cap on stargazers fetched per analysis */
export const DEFAULT_STARGAZER_LIMIT = 5000;

/**
 * Minimum total stars before we issue a verdict.
 *
 * Calibration (CALIBRATION.md, 2026-05-06) showed 90% accuracy on repos
 * with ≥1000 stars but only 56% on the 100-1000 range. Below this
 * threshold the badge displays "needs more data" instead of a verdict.
 *
 * The right long-term fix is per-user heuristics on burst stargazers
 * (planned for v2); for v1 we conservatively gate.
 */
export const MIN_STARS_FOR_VERDICT = 1000;

/** Cache TTL */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Cache schema version. Bump this whenever the analysis pipeline changes
 * in a way that would invalidate previously-cached results — algorithm
 * tweaks, new fields, fixes that change the verdict on the same input.
 *
 * History:
 *   1: initial release
 *   2: fakePercent denominator switched from analyzedStars to total stars
 *      (was producing inflated percentages on large repos)
 *   3: StarScout lookup layer added (later removed for staleness reasons)
 *   4: per-user heuristics added — verdicts now incorporate live account
 *      analysis on burst stargazers (StarGuard's user-scoring approach)
 */
export const CACHE_SCHEMA_VERSION = 4;

/**
 * GitHub OAuth App Client ID. Sourced from build-time env so dev and prod
 * builds use different OAuth apps (and therefore different Web Store /
 * unpacked extension IDs can each have their own registered callback URL).
 *
 * Values come from `.env.production` or `.env.development` depending on
 * `pnpm build` vs `pnpm build:dev`. See SETUP.md.
 *
 * The client_id is public — it ships in every OAuth request URL — so it's
 * fine to commit. The matching client_secret stays in the Cloudflare Worker.
 *
 * We defer the placeholder check to lazy getters so that tests (which
 * import this module but don't exercise OAuth) don't fail at module load.
 * Production code paths that actually use these values get a loud error
 * if they're missing.
 */
function requireEnv(name: 'VITE_GITHUB_CLIENT_ID' | 'VITE_OAUTH_EXCHANGE_URL'): string {
  const v = import.meta.env[name];
  if (!v || v.includes('__DEV_CLIENT_ID__')) {
    throw new Error(
      `${name} is not set or still a placeholder. ` +
        'For prod builds this should never fail. For dev builds, register a ' +
        '"real-stars (dev)" OAuth app at github.com/settings/applications/new ' +
        'and put its client_id in .env.development. See SETUP.md.',
    );
  }
  return v;
}

export const GITHUB_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID ?? '') as string;

/**
 * URL of the deployed Cloudflare Worker that exchanges OAuth codes for
 * access tokens. Prod points at the production worker; dev points at a
 * separate dev worker holding the dev OAuth app's client_secret.
 * See worker/README.md.
 */
export const OAUTH_EXCHANGE_URL = (import.meta.env.VITE_OAUTH_EXCHANGE_URL ?? '') as string;

/**
 * Validate the env values are real (not placeholder/undefined). Call this
 * from the OAuth flow entrypoint before reading GITHUB_CLIENT_ID or
 * OAUTH_EXCHANGE_URL — throws a clear error pointing the developer at
 * .env.development if they haven't set up the dev OAuth app.
 */
export function assertOAuthConfig(): void {
  requireEnv('VITE_GITHUB_CLIENT_ID');
  requireEnv('VITE_OAUTH_EXCHANGE_URL');
}

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** Storage keys */
export const STORAGE_KEY_AUTH = 'real-stars:auth';
export const STORAGE_KEY_CACHE_PREFIX = 'real-stars:cache:';
