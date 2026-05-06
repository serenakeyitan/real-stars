# Changelog

All notable changes to real-stars are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Detection

- **MAD burst detection** ported from
  [StarGuard](https://github.com/m-ahmed-elbeskeri/Starguard) (Apache-2.0).
  Sliding 28-day window, 3-sigma equivalent threshold, with a percent-growth
  fallback for tiny new repos. See [ARCHITECTURE.md](ARCHITECTURE.md#the-mad-burst-detection-algorithm).
- **Fork ratio cross-validation** distinguishes real virality from bought
  stars — paid bots star but don't fork.
- **Traffic referrer cross-validation** uses GitHub's traffic API to detect
  external referrer evidence (HN, Reddit, Twitter) for spikes in the last
  14 days. Falls back gracefully when the user lacks push access.

### Auth

- **GitHub Device Flow** authentication. No backend, no Personal Access
  Token setup — users see an 8-character code, jump to github.com/login/device,
  paste it, authorize. The popup auto-detects authorization via background
  polling.

### UI

- **In-page badge** injected next to the GitHub star count on repo home
  pages. Three states: `✓` (low risk), `⚠` (medium), `🚨` (high), with
  color coding and a tooltip showing the full breakdown.
- Popup with connect / disconnect / clear-cache controls. Light/dark mode
  via `prefers-color-scheme`.

### Performance

- 7-day cache in `chrome.storage.local` keyed by owner/repo. A typical
  10k-star repo analysis takes 35-37 GitHub API calls (33 stargazer pages,
  1 fork, 1 traffic, plus link header inspection).
- Stargazer fetching prioritizes recent stars (capped at 5000) since that's
  where bought stars cluster.

### Infrastructure

- **Vite + TypeScript** build, ~36 KB packaged extension.
- **35 unit tests** (vitest) covering algorithm, parser, validation.
- **6 E2E tests** (Playwright) loading the unpacked extension into real
  Chromium, validating message routing, popup rendering, cache round-trips,
  and DOM injection logic.
- **CI**: prettier + typecheck + unit + E2E on every push.
- **Release workflow**: pushing a `v*` tag creates a GitHub release with
  the packaged `.zip` attached.

### Documentation

- [README.md](README.md) — what it is, how it works at a glance.
- [SETUP.md](SETUP.md) — step-by-step install with OAuth App registration.
- [ARCHITECTURE.md](ARCHITECTURE.md) — design rationale, algorithm details,
  what we deliberately cut from v1 and why.

[Unreleased]: https://github.com/serenakeyitan/real-stars/commits/main
