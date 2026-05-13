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

/** Verdict bucket thresholds.
 *  Tightened 2026-05-11 (was 0.3 → 0.2 for high) — most real-world repos
 *  cluster between 5–20% bought, so 30% was empty in practice. */
export const RISK_HIGH_THRESHOLD = 0.2;
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
 *   5: USER_SAMPLE_SIZE 200 → 400 (±5% → ±3.5% binomial CI); cache TTL
 *      7d → 30d. Results from v4 may differ enough on edge cases to mislead.
 *   6: REVERT — restored 200 / 7d after StarScout benchmark showed the
 *      change moved verdicts by ≤2pp (no real signal, just variance).
 *      Invalidates all v5 cached results so users see fresh 200-sample
 *      verdicts on next visit.
 *   7: Removed global per-user sampling on the whole stargazer pool
 *      (added in v4, was the dominant signal). It over-flagged repos
 *      with non-developer audiences (curated lists, prompt collections,
 *      AI-tool-for-product-people) because their real stargazers look
 *      profile-identical to bought-fake accounts. Algorithm now relies
 *      on burst detection + per-burst per-user analysis only — same
 *      shape that shipped before commit 59ba84a on May 9.
 *   8: Removed per-burst per-user analysis too. Algorithm is now
 *      burst-detection + fork-ratio + traffic-referrer cross-validation
 *      only — same shape that shipped on May 8 (commit 9c5ee18) before
 *      per-user heuristics were introduced. Profile-shape signals
 *      can't distinguish real-new-users from bought-fake accounts;
 *      we rely entirely on behavioral signals (timing, forks,
 *      traffic) that are much harder to fake.
 */
export const CACHE_SCHEMA_VERSION = 8;

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
// Safe accessor — works in both Vite (where import.meta.env is defined)
// AND raw node (where it's undefined). Scripts like calibrate.ts and
// _score-lib.mjs that import from src/shared/* shouldn't crash just
// because they don't go through a Vite build.
function envVar(name: string): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[name] ?? '';
  } catch {
    return '';
  }
}

function requireEnv(name: 'VITE_GITHUB_CLIENT_ID' | 'VITE_OAUTH_EXCHANGE_URL'): string {
  const v = envVar(name);
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

export const GITHUB_CLIENT_ID = envVar('VITE_GITHUB_CLIENT_ID');

/**
 * URL of the deployed Cloudflare Worker that exchanges OAuth codes for
 * access tokens. Prod points at the production worker; dev points at a
 * separate dev worker holding the dev OAuth app's client_secret.
 * See worker/README.md.
 */
export const OAUTH_EXCHANGE_URL = envVar('VITE_OAUTH_EXCHANGE_URL');

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
