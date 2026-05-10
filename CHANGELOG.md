# Changelog

All notable changes to real-stars are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — 2026-05-09

### Major: live per-user account analysis

The detection pipeline now has TWO independent fake-star signals that
combine via max:

1. **MAD burst detection on the star time series** (existing)
2. **Per-user account scoring on a 200-stargazer global random sample**
   (new) — for each sampled stargazer, GET /users/{login} and score
   account age, follower count, public repo count, default avatar,
   and an "empty profile" combo bonus. Score ≥ 4 → suspicious.

The two signals are orthogonal: burst detection catches "bought a
batch in one day", per-user catches "bought 6,000 throwaway accounts
to drip-star over years". Together they cover the full fake-star
spectrum.

Calibrated against StarScout's published ground truth
([ICSE 2026](https://arxiv.org/abs/2412.13459)):

| Repo              | StarScout (snapshot) | real-stars (live) |
| ----------------- | -------------------- | ----------------- |
| LupusLeaks/EasyFN | 83.5% fake           | **86.5% fake** ✅ |
| microsoft/vscode  | 1.27% fake           | ~1.5% fake ✅     |
| torvalds/linux    | 0.88% fake           | ~1.5% fake ✅     |

Previous release (v0.1.0) missed LupusLeaks/EasyFN entirely (0.0%
verdict) because its fake stars are spread across years rather than
concentrated in bursts. The global per-user signal catches it.

### Fixed

- **fakePercent denominator bug** — was `suspiciousStars / analyzedStars`,
  producing wildly inflated percentages on large repos (vscode showed
  "183.2k real (69%)" with only ~1500 of its 185k stars actually flagged).
  Now uses the true repo total.
- **Cache schema versioning** — old cache entries are invalidated when
  the analysis pipeline changes, so users won't keep seeing pre-fix
  results after auto-update. `CACHE_SCHEMA_VERSION = 4` (bumped for
  per-user analysis schema).
- **Stale TEMPORARY comment** in github.ts replaced with a doc reference
  to the v2 algorithm work.

### Added

- **`engines` field + `.nvmrc`** pinning Node ≥22 / pnpm ≥9. Previously
  fresh clones on Node 16 silently produced confusing crypto errors.
- **`random` stargazer sampling strategy** (opt-in, default `recent`).
  Foundation for future page-density MAD work.
- **`src/background/userScore.ts`** — per-user fake-account scoring with
  7-day chrome.storage.local cache; cross-repo cache hits the same
  stargazer for free.
- **6 new unit tests** (cache schema contract, threshold floors).

### Changed

- Analysis time per repo: ~10s → ~30s on cold cache (cost of the 200
  per-user lookups), <100ms on cache hit.
- Worker bundle stripped back to OAuth-only (no StarScout snapshot
  lookup — that approach was tried and rejected for staleness reasons).

## [0.1.0] — 2026-05-08

First public release.

### Detection

- **MAD burst detection** ported from
  [StarGuard](https://github.com/m-ahmed-elbeskeri/Starguard) (Apache-2.0).
  Sliding 28-day window, 3-sigma equivalent threshold, with a percent-growth
  fallback for tiny new repos and a viral-truncation guard for short
  high-density slices. See
  [ARCHITECTURE.md](ARCHITECTURE.md#the-mad-burst-detection-algorithm).
- **Fork ratio cross-validation** distinguishes real virality from bought
  stars — paid bots star but don't fork.
- **Traffic referrer cross-validation** uses GitHub's traffic API to detect
  external referrer evidence (HN, Reddit, Twitter) for spikes in the last
  14 days. Falls back gracefully when the user lacks push access.
- **Confidence gate at 1000 stars** (`MIN_STARS_FOR_VERDICT`). Calibration
  on a 72-repo StarScout sample showed 90% accuracy on ≥1000-star repos
  but only 56% on 100-1000. Below-gate repos render an "insufficient
  data" badge instead of a verdict.

### Auth

- **GitHub OAuth Web Flow** via `chrome.identity.launchWebAuthFlow`.
  One-click sign-in: the user clicks "🔒 sign in with GitHub" right on the
  badge, GitHub's authorize popup appears (they're already logged in), they
  click "Authorize" — done. No codes to paste, no setup tutorials.
- A tiny **Cloudflare Worker** (in `worker/`) holds the `client_secret`
  and exchanges OAuth codes for tokens. Free tier covers thousands of
  users at $0/month.

### UI

- **In-page badge** injected next to the GitHub star count on repo home
  pages. Five states:
  - `⏳ analyzing…` (loading)
  - `🔒 sign in with GitHub` (unauthenticated; clickable to start OAuth)
  - `✓ X real (Y%)` / `⚠ ...` / `🚨 ...` (verdict, color-coded)
  - `— not enough data` (below 1000-star gate)
  - `⚠ analysis failed` (errors, with details in tooltip)
- Popup with connect / disconnect / clear-cache controls + footer link
  back to the GitHub source. Light/dark mode via `prefers-color-scheme`.

### Performance

- **Parallel API fetching**: stargazer pagination (6-way concurrent), and
  fork + traffic + stargazer batched together via `Promise.allSettled`.
  Typical analysis runs in ~2s end-to-end vs ~10s previously.
- **7-day cache** in `chrome.storage.local` keyed by owner/repo. Cache
  entries carry a schema version so algorithm upgrades automatically
  invalidate stale results.
- **5000-stargazer cap per analysis** so even 100k+ star repos stay
  responsive on rate limits.

### Infrastructure

- **Vite + TypeScript** build, ~37 KB packaged extension.
- **40 unit tests** (vitest) covering MAD algorithm, route parser,
  validation logic, cache schema contract.
- **7 E2E tests** (Playwright) loading the unpacked extension into real
  Chromium, validating message routing, popup rendering, cache round-trips
  including the insufficientData branch, and DOM injection logic.
- **Calibration pipeline** (`pnpm calibrate`) that runs the production
  algorithm against StarScout's published ground-truth labels and emits
  a markdown trend report.
- **CI**: prettier + typecheck + unit + build + E2E on every push.
- **Release workflow**: pushing a `v*` tag builds, packages, and creates
  a GitHub release with the `.zip` attached.

### Documentation

- [README.md](README.md) — what it is + privacy section.
- [SETUP.md](SETUP.md) — step-by-step install with OAuth App registration
  - Worker deploy.
- [ARCHITECTURE.md](ARCHITECTURE.md) — design rationale, algorithm details,
  v2 plan.
- [CALIBRATION.md](CALIBRATION.md) — calibration methodology and
  trend over time.
- [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md) — publishing guide.

[Unreleased]: https://github.com/serenakeyitan/real-stars/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/serenakeyitan/real-stars/releases/tag/v0.2.0
[0.1.0]: https://github.com/serenakeyitan/real-stars/releases/tag/v0.1.0
