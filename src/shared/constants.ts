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
 *   3: StarScout lookup layer added — verdicts now incorporate
 *      peer-reviewed ground truth where available
 */
export const CACHE_SCHEMA_VERSION = 3;

/**
 * GitHub OAuth App Client ID.
 *
 * v1 ships with a PLACEHOLDER. Register an OAuth App at
 * https://github.com/settings/applications/new and replace this value.
 * See SETUP.md for step-by-step instructions.
 */
export const GITHUB_CLIENT_ID = 'Ov23liLfCB5Kaulza66T';

/**
 * Base URL of the deployed Cloudflare Worker. The Worker has two endpoints:
 *   POST /exchange — OAuth code-to-token swap
 *   GET  /check?repo=owner/name — StarScout fake-repo lookup
 *
 * See worker/README.md.
 */
export const WORKER_BASE_URL = 'https://real-stars-oauth.peer-claw.workers.dev';
export const OAUTH_EXCHANGE_URL = `${WORKER_BASE_URL}/exchange`;
export const STARSCOUT_CHECK_URL = `${WORKER_BASE_URL}/check`;

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** Storage keys */
export const STORAGE_KEY_AUTH = 'real-stars:auth';
export const STORAGE_KEY_CACHE_PREFIX = 'real-stars:cache:';
