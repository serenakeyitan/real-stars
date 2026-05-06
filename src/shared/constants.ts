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

/** Cache TTL */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Device Flow polling */
export const DEVICE_FLOW_POLL_INTERVAL_MS = 5000;

/**
 * GitHub OAuth App Client ID.
 *
 * v1 ships with a PLACEHOLDER. To make Device Flow work, register a GitHub
 * OAuth App at https://github.com/settings/applications/new and replace this
 * value. See SETUP.md for step-by-step instructions.
 */
export const GITHUB_CLIENT_ID = '__REPLACE_WITH_REAL_CLIENT_ID__';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_VERIFICATION_URI = 'https://github.com/login/device';

/** Storage keys */
export const STORAGE_KEY_AUTH = 'real-stars:auth';
export const STORAGE_KEY_CACHE_PREFIX = 'real-stars:cache:';
