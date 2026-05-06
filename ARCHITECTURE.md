# Architecture

This is the design doc for real-stars v1. Read it to understand *what the
extension does, why it does it that way, and what it deliberately doesn't
do*.

---

## What the extension does (one paragraph)

When you open a GitHub repo page, real-stars pulls the timestamps of the
recent stargazers, runs a statistical anomaly-detection algorithm on the
star history to identify suspicious spikes, cross-validates each spike
against fork activity and traffic referrers, and shows the estimated count
of "real" stars next to GitHub's official star count.

---

## The fake-star detection problem

GitHub stars are bought. The market is real and well-documented:

- The "[Six Million Suspected Fake Stars in GitHub](https://arxiv.org/abs/2412.13459)"
  paper (ICSE 2026) found 4.53M fake stars across 22,915 repositories.
- Sellers offer 50-star minimum orders for $5-$15.
- AI-related repos are the most aggressive buyers (per
  [36kr investigation](https://eu.36kr.com/en/p/3777351039862789)).

There's no API for "is this star real?". You have to *infer* it. The
academic and open-source landscape has converged on three orthogonal
detection strategies:

| Strategy | What it sees | Pros | Cons |
|---|---|---|---|
| **Per-user activity profiling** | Each individual stargazer's account history | Catches throwaway accounts | Slow; needs N API calls for N stars |
| **Burst detection on time series** | The repo's daily star count series | Fast (one timeline call); great UX (visualizable) | Misses gradual buying that mimics organic |
| **Cross-repo lockstep clustering** | Coordinated behavior across many repos | Catches sophisticated farms | Needs full-GitHub data; can't run client-side |

real-stars uses **burst detection** as its primary algorithm because it's
the only one that fits in a Chrome extension's constraints. We add a thin
layer of cross-validation to address burst detection's main weakness
(false-positives from real virality).

---

## The MAD burst-detection algorithm

We port the algorithm from [StarGuard](https://github.com/m-ahmed-elbeskeri/Starguard)
(Apache-2.0). See [src/shared/mad.ts](src/shared/mad.ts) for the implementation.

### Intuition

Real repos grow on a curve with predictable variance — some days a few
stars, occasionally a Hacker News bump, but day-to-day numbers stay within
a band. Bought stars violate this band: a seller delivers 200 stars on the
day you order, leaving an unmistakable spike on the time series.

We detect spikes using **MAD (Median Absolute Deviation)**, a robust
alternative to standard deviation. MAD doesn't get distorted by the same
outliers we're trying to catch.

### The math

For each day `i`, looking back at a `WINDOW_SIZE`-day window:

```
median[i] = median(stars[i-28 ... i-1])
MAD[i]    = median(| stars[i-28 ... i-1] - median[i] |)

today is anomalous IF stars[i] > median[i] + 4.44 * MAD[i]
```

The constant **4.44 = 3.0 × 1.4826** is the normal-distribution-equivalent
of "3 sigma". Under a normal distribution, values that extreme have less
than 0.3% probability of arising from natural variance.

### Edge cases handled

1. **Tiny new repos** (< 30 cumulative stars): MAD on a near-zero series
   becomes meaningless. We fall back to a percent-growth threshold:
   anomalous if `today > 5 AND today/cumulative_so_far > 300%`.

2. **Constant series** (all-zero MAD): if MAD == 0, the threshold collapses
   to just `median + 1`, which would over-flag. We use a separate
   "significant jump" check: anomalous if `today > max(5, median * 2)`.

3. **Multi-day bursts**: consecutive anomalous days are merged into a
   single burst event with `days`, `stars`, `users` totals.

### Algorithm constants (in [src/shared/constants.ts](src/shared/constants.ts))

```typescript
MAD_THRESHOLD          = 3.0 * 1.48  // ≈ 4.44, the 3-sigma equivalent
WINDOW_SIZE            = 28          // 28-day rolling window
MIN_STAR_COUNT         = 30          // below this, use percent-growth fallback
MIN_STARS_GROWTH_PERCENT = 300       // tiny-repo growth threshold
```

These are inherited verbatim from StarGuard. They've been tuned against
the 4.5M-fake-stars paper's labeled set; we have no reason to change them.

---

## Cross-validation: distinguishing real spikes from fake ones

MAD alone has false positives. **A Hacker News front-page hit looks
identical to a 200-star injection on the time series.** We need a way to
tell them apart.

Two cheap signals do most of the work:

### 1. Fork ratio

Real virality drives forks. People who genuinely discover a repo through
HN or a tweet often fork it to try things. **Bought stars don't bring
forks** — paid bots star and disappear.

We compute `forks_in_burst_window / stars_in_burst_window`:

- ≥ 1% → likely organic
- < 0.5% → likely fake (combined with sharp spike)
- in between → ambiguous, marked suspicious

### 2. Traffic referrers

Real spikes leave a referrer footprint: `news.ycombinator.com`,
`reddit.com`, `twitter.com`, news sites. Bought stars come from direct
hits with no upstream story.

GitHub's `/repos/{o}/{r}/traffic/popular/referrers` endpoint exposes the
top 10 external referrers of the last 14 days. We check whether any of
them have ≥ 5 unique visitors during the burst window.

**Important caveat**: the traffic API only goes back 14 days, and it
requires push access. For repos the user doesn't own, the call returns
403. We treat that as "no signal" rather than failure — the verdict just
falls back to the fork-ratio check.

### Verdict logic

```
IF fork_ratio ≥ 1% OR has_referrer_evidence:
  verdict = organic       (we exclude these from the suspicious total)

ELIF fork_ratio < 0.5% AND spike_ratio > 6 sigma:
  verdict = fake          (high confidence)

ELSE:
  verdict = suspicious    (moderate confidence)
```

Implementation: [src/shared/validation.ts](src/shared/validation.ts).

---

## What we deliberately don't do (yet)

These were considered for v1 and explicitly cut. Each has a reason.

### Per-user activity scoring

StarGuard scores each stargazer on 8 dimensions (account age, follower
count, repo count, contribution gini, time-of-day entropy, etc) and flags
users with score ≥ 5. **We don't do this** because each user requires 1-3
API calls (profile + their starred repos), so a 100-star burst would
consume 100-300 calls. With 5000 calls/hour, a user could only analyze
~30 medium repos before hitting the rate limit. The trade-off isn't worth
it for v1.

**Future v2**: optional "click to see suspicious accounts" drill-down that
fetches user profiles on-demand, only when the user explicitly asks.

### Lockstep / DBSCAN clustering

The most accurate detection (StarScout's lockstep heuristic gets 90% of
its flags later deleted by GitHub) finds groups of accounts that *jointly*
attack many repos. **It's impossible to run client-side** because it needs
the full GitHub-wide star event graph (40TB on BigQuery, takes a week to
process).

**Future v2**: query StarScout's published [Zenodo dataset](https://doi.org/10.5281/zenodo.17009694)
via a backend lookup service. Hits the dataset for popular repos, falls
back to MAD for the long tail.

### Backend service

Pure client-side: no backend, no costs, no operational burden. Device Flow
authentication makes this possible (it's the only OAuth variant that
doesn't need a `client_secret`). The cost is a slightly worse user
experience: 4 steps (look at code, open GitHub page, paste code, authorize)
instead of standard OAuth's 3 steps.

---

## Component layout

```
src/
├── shared/         Algorithm code, types, constants. Pure logic, no I/O.
│   ├── mad.ts        MAD burst detection
│   ├── validation.ts Cross-validation logic
│   ├── types.ts      Shared TypeScript types
│   └── constants.ts  Algorithm + API + storage constants
│
├── background/     MV3 service worker. Owns auth, network, cache.
│   ├── index.ts      Message router
│   ├── auth.ts       GitHub Device Flow
│   ├── github.ts     API client (stargazers, forks, traffic)
│   └── analyze.ts    Orchestrates the pipeline + caching
│
├── content/        Content script. Runs on every github.com page.
│   ├── index.ts      Entry + Turbo navigation handler
│   ├── route.ts      Parse owner/repo from URL
│   └── badge.ts      DOM injection + state rendering
│
└── popup/          Browser action popup.
    ├── index.html
    ├── popup.css     GitHub-native styling, light/dark via @media
    └── popup.ts      Auth UI state machine
```

### Why this split

- **shared/** has no Chrome APIs. It's pure functions, easy to unit test.
- **background/** owns all I/O: storage, fetch, auth state. It exposes
  message handlers; nobody else makes API calls directly.
- **content/** does DOM work and delegates to background via
  `chrome.runtime.sendMessage`. This avoids the content-script CORS
  restrictions of MV3.
- **popup/** is independent — talks to background only via messages.

---

## Data flow

When you open `github.com/torvalds/linux`:

```
1. content/index.ts runs (manifest match)
2. content/route.ts parses → { owner: 'torvalds', name: 'linux' }
3. content/badge.ts injects a "⏳ analyzing…" placeholder
4. content sends { type: 'analyze-repo', payload: { owner, repo } }
5. background/index.ts routes to background/analyze.ts
6. analyze.ts checks chrome.storage for cached entry (7-day TTL)
   - Cache hit → return immediately
   - Cache miss → continue
7. analyze.ts calls fetchStargazers (paginated, ~33 calls for 10k stars)
8. analyze.ts calls detectBursts on the timestamps
9. If bursts found, call fetchForkTimeseries + fetchTrafficReferrers
10. analyze.ts maps each burst through validateBurst
11. Sum non-organic burst stars → suspiciousStars; cache the result
12. Response flows back to content/badge.ts
13. badge.ts replaces the placeholder with the final result badge
```

Total API calls per analysis: typically 35-37 (33 stargazer pages, 1 fork,
1 traffic, plus first-page link header inspection).

---

## Caching

`chrome.storage.local` keyed by `real-stars:cache:{owner}/{repo}`, 7-day
TTL. The popup has a "Clear cache" button that wipes all entries.

We don't cache stargazers themselves — the cached entry is the *analysis
result*, which is small (a few KB even for repos with hundreds of bursts).

The 7-day TTL is a guess. Star history doesn't change retroactively, so
older analysis stays valid for older bursts. New bursts in the last 7 days
might be missed by stale cache. If this becomes a real problem, we can
shorten the TTL or add "force refresh" UI.

---

## Testing

Two layers:

### Unit tests (vitest, in `tests/unit/`)

35 tests covering pure logic:
- Median + MAD computation, edge cases
- Day bucketing with gap-filling
- Burst detection across scenarios (steady growth, single-day injection,
  multi-day burst, tiny-repo fallback, threshold scaling)
- URL parsing (reserved paths, sub-paths, malformed input)
- Validation verdicts (organic / fake / suspicious branches)

Runs in ~500ms; no I/O.

### E2E tests (playwright, in `tests/e2e/`)

6 tests against a real Chromium with the unpacked extension loaded:
- Extension loads, manifest is valid
- Background message router responds correctly
- Cache pre-seeding round-trips through chrome.storage
- clear-cache wipes entries
- popup.html renders correctly
- Content script's anchor finder works on a GitHub-shaped DOM

We don't hit real github.com — too flaky, too expensive (rate limits in
CI), and requires auth. Instead, a local HTTP server serves a fixture HTML
with the same DOM structure as a real repo page.

CI runs both suites + typecheck + format check on every push.

---

## What v2 looks like

In rough priority order:

1. **StarScout dataset lookup**: query the published Zenodo data for
   "verified" fake-star repos. When hit, show a stronger label
   ("ICSE 2026 research confirmed") instead of just our heuristic
   guess. Requires a small backend.

2. **Click-to-drill-down on suspicious accounts**: when a burst is
   detected, let the user click to see a sample of suspicious stargazers
   from that burst, with their account-age / follower-count / etc
   highlighted.

3. **Star history sparkline**: render a tiny SVG of the star history
   inline with the badge, with red bands on detected bursts. Most visual
   thing we could add.

4. **Whitelist for known organic spikes**: a curated list of "this repo
   was on HN front page on date X" so we don't have to recompute the
   verdict every time.

5. **Chrome Web Store listing**: when the algorithm has been validated
   against enough real repos to feel confident.
