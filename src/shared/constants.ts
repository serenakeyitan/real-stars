// Algorithm constants ported from StarGuard
// (https://github.com/m-ahmed-elbeskeri/Starguard, Apache-2.0)
// starguard/analyzers/constants.py

/**
 * MAD threshold: 3.0 * 1.4826 ≈ 3-sigma equivalent under a normal
 * distribution. 1.4826 = 1/Φ⁻¹(0.75) is the consistency factor that makes
 * MAD a consistent estimator of σ — it is the value StarGuard uses and the
 * value every comment/doc here always cited. Was erroneously 3.0 * 1.48
 * (a rounding mistake) through schema v10, making the detector 0.18% more
 * sensitive than the calibrated port. Corrected in schema v11.
 */
export const MAD_THRESHOLD = 3.0 * 1.4826;

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

/**
 * Audience-aware gate (schema v10, 2026-05-13). The global per-user signal
 * over-flags repos with non-developer audiences (curated lists, prompt
 * collections) — those real-but-non-coder stargazers look profile-
 * identical to bought-fake accounts. Discriminator: bought-fake accounts
 * never fork the repos they star, so when a repo has several sizable
 * bursts with a healthy average fork-ratio, its audience contains real
 * active developers and the global signal is suppressed.
 *
 * Calibration (validated on 11 repos, see ARCHITECTURE.md):
 *   - awesome-notebookLM-prompts: 5 bursts, 14.9% avg fork → gate fires,
 *     18% MEDIUM → 0.2% LOW
 *   - LupusLeaks/EasyFN 3.1%, GaiaNet 3.7% → below ratio, gate doesn't fire
 *   - vscode/linux: single burst → below burst count, gate doesn't fire
 *
 * These are VERDICT GATES — keep named here, never inline as literals
 * (they were the magic numbers 20/2/0.05 buried in analyze.ts).
 */
export const GATE_MIN_BURST_STARS = 20;
export const GATE_MIN_SIZABLE_BURSTS = 2;
export const GATE_MIN_AVG_FORK_RATIO = 0.05;

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
 * Cache schema version. Bump whenever the analysis pipeline changes in a
 * way that would invalidate previously-cached results (algorithm tweaks,
 * new fields, verdict-changing fixes). The bump invalidates stale
 * per-user scores AND per-repo verdicts so the extension badge and the
 * Hall of Shame dashboard never serve a mix of old + new scoring.
 *
 * SINGLE SOURCE OF TRUTH — scripts/_score-lib.ts re-exports this exact
 * constant (no mirror to keep in sync).
 *
 * Current (v11): dual-sampling (burst MAD + global per-user, combined via
 * max) + audience-aware gate + corrected MAD constant + NaN-date scoring
 * fix. Full dated rationale for every version → docs/CACHE-SCHEMA-HISTORY.md
 * (kept there, not here, so this stays readable). Bump procedure is in
 * that doc.
 */
export const CACHE_SCHEMA_VERSION = 11;

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
// AND tsx/raw node (where it's undefined). Scripts like bench-repo.ts and
// _score-lib.ts that import from src/shared/* shouldn't crash just
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
