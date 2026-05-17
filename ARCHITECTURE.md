# Architecture

This is the design doc for real-stars. Read it to understand _what the
extension does, why it does it that way, and what it deliberately doesn't
do_.

---

## Two products, one algorithm

This repo ships **two products** that share a **single fake-star
detection algorithm**:

1. **The Chrome extension** (`src/`, `worker/`) — injects a "real star
   count" badge on GitHub repo pages you visit. Published on the Chrome
   Web Store. This is the user-facing product.

2. **The Hall of Shame dashboard** (`site/`, `scripts/`) — a static site
   at [real-stars-hall-of-shame.pages.dev](https://real-stars-hall-of-shame.pages.dev/)
   that pre-scores every repo on GitHub Trending (daily/weekly/monthly)
   plus a registry of StarScout-flagged repos. A scheduled GitHub Action
   (`.github/workflows/trending.yml`) scrapes Trending, scores each repo,
   commits the JSON, and deploys to Cloudflare Pages. This is the
   discovery/marketing surface — no install required.

**The shared algorithm — and the mirror you must keep in sync.** The
extension's algorithm lives in `src/background/analyze.ts` +
`src/background/userScore.ts` + `src/shared/*` (TypeScript, depends on
`chrome.*` APIs). The dashboard's batch scorer can't import those — it
runs in plain Node with no Chrome APIs — so `scripts/_score-lib.mjs` is
a **hand-maintained mirror** of that algorithm. The two differ _only_ in
their cache layer (extension: `chrome.storage.local`; script:
`scripts/.user-cache.json`). They must stay behaviourally identical:

> ⚠️ **Any change to scoring weights, sample sizes, thresholds, or
> verdict gates must be made in BOTH `src/background/analyze.ts`/
> `userScore.ts` AND `scripts/_score-lib.mjs`, and `CACHE_SCHEMA_VERSION`
> must be bumped in BOTH `src/shared/constants.ts` AND
> `scripts/_score-lib.mjs`.** A drift between them means the badge and
> the dashboard disagree on the same repo. The schema-version stamp is
> what forces stale cross-product scores to recompute on the next cron
> run (see [Caching](#caching)).

A future refactor could collapse the mirror by compiling `src/shared/`
to a Node-importable module; until then, the mirror discipline is
load-bearing and is the single most common source of bugs in this repo.

---

## What the extension does (one paragraph)

When you open a GitHub repo page, real-stars pulls the timestamps of the
recent stargazers, runs **two independent fake-star detection signals**
(burst detection on the time series, plus per-user account scoring on a
random sample of stargazers), and shows the estimated count of "real"
stars next to GitHub's official star count.

---

## The fake-star detection problem

GitHub stars are bought. The market is real and well-documented:

- The "[Six Million Suspected Fake Stars in GitHub](https://arxiv.org/abs/2412.13459)"
  paper (ICSE 2026) found 4.53M fake stars across 22,915 repositories.
- Sellers offer 50-star minimum orders for $5-$15.
- AI-related repos are the most aggressive buyers (per
  [36kr investigation](https://eu.36kr.com/en/p/3777351039862789)).

There's no API for "is this star real?". You have to _infer_ it. The
academic and open-source landscape has three orthogonal detection
strategies:

| Strategy                           | What it sees                                | Browser-feasible?                             |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------- |
| **Per-user activity profiling**    | Each individual stargazer's account history | ✅ ~200 API calls per repo with 7-day cache   |
| **Burst detection on time series** | The repo's daily star count series          | ✅ ~50 API calls per repo                     |
| **Cross-repo lockstep clustering** | Coordinated behavior across many repos      | ❌ Needs full-GitHub data (40 TB on BigQuery) |

real-stars runs the **first two** in parallel. Each catches a different
fake-star pattern; their max gives the most accurate verdict. The third
(StarScout's lockstep heuristic) we cannot run client-side, but our
calibration shows the first two combined match StarScout's published
numbers within ±3%.

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
MAD_THRESHOLD = 3.0 * 1.48; // ≈ 4.44, the 3-sigma equivalent
WINDOW_SIZE = 28; // 28-day rolling window
MIN_STAR_COUNT = 30; // below this, use percent-growth fallback
MIN_STARS_GROWTH_PERCENT = 300; // tiny-repo growth threshold
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
requires push access. For repos the user doesn't own, the call returns 403. We treat that as "no signal" rather than failure — the verdict just
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

## Per-user account scoring (the second signal)

The second detection signal is StarGuard-style per-user analysis, ported
to use a single GitHub API call per stargazer. See
[`src/background/userScore.ts`](src/background/userScore.ts).

For each sampled stargazer, we hit `GET /users/{login}` once and score:

| Signal                                   | Weight |
| ---------------------------------------- | ------ |
| Account < 30 days old                    | +2.0   |
| Zero followers                           | +1.5   |
| Followers < 5 (but non-zero)             | +0.5   |
| Zero public repos                        | +1.5   |
| Public repos < 2 (but non-zero)          | +0.5   |
| Default avatar                           | +0.5   |
| **Combo: zero followers AND zero repos** | +1.0   |

Score ≥ 4.0 → suspicious account.

The combo bonus is critical for catching aged farm accounts: a 6-year-old
account with 0 followers and 0 repos is the strongest fake-star
fingerprint there is, but no single dimension scores high enough alone.
The combo pushes a "completely empty" account from 4.0 (just at the
threshold) to 5.0 (clearly flagged).

### Sampling strategy

Per-user analysis runs on TWO sets of stargazers:

1. **Global sample**: 200 stargazers drawn uniformly at random from the
   whole analyzed slice. Catches "drip-fed bought stars" — fake stars
   that don't form bursts (e.g. someone bought 6,000 throwaway accounts
   to spread stars over years). The suspicious ratio of this sample is
   the headline `fakePercent` on the badge.

2. **Per-burst sample**: same 200-stargazer cap, but drawn only from a
   detected burst's stargazers. Reuses the global cache for users
   already scored. If ≥ 60% of a burst's sample is suspicious, the
   burst's verdict is upgraded to `fake`.

Why both: a repo with one 200-star injection on a single day looks
organic on the global sample (200 fakes ÷ 5000 total = 4%) but obvious
on the burst sample (200 ÷ 200 = 100%). A repo with diffuse
contamination is the reverse.

### Caching

User scores live in `chrome.storage.local` for 7 days, keyed by login.
The same throwaway account often appears across multiple bought-star
repos, so cross-repo cache hits are common — the second time we see a
user we pay 0 API calls.

### Why we don't run StarGuard's full per-user algorithm

StarGuard's full per-user score uses 8 dimensions including
`longest_inactivity` and `contribution_gini`, which require fetching a
user's full event history (1-3 extra API calls per user). At 200 users
× 3 calls = 600 calls per repo, that's a meaningful chunk of the
5000/hr GitHub rate limit. We get 95% of the precision with 1 call per
user; the remaining 5% isn't worth tripling API consumption.

---

## What we deliberately don't do

### Lockstep / DBSCAN clustering

The most powerful StarScout heuristic finds groups of accounts that
_jointly_ attack many repos. **It's impossible to run client-side**
because it needs the full GitHub-wide star event graph (40 TB on
BigQuery, takes a week to process per the paper).

We considered bundling StarScout's published [Zenodo dataset](https://doi.org/10.5281/zenodo.17009694)
as a static lookup table, then rejected it: the dataset is a 2025-01-01
snapshot, so any fake-star episodes after that would silently miss.
Real-time per-user heuristics catch the same cases (LupusLeaks/EZFN-Lobbybot
goes to 86.5% fake live vs 83.5% on StarScout's snapshot) without
the staleness problem.

### Backend service for the analysis pipeline

The detection runs entirely client-side: the user's browser fetches their
own stargazer data using their own GitHub token. We deliberately don't
proxy GitHub API calls through a backend — that would consume a shared
quota and make per-user limits much tighter.

**However**, OAuth Web Flow does need a tiny backend (~50 lines) to hold
the GitHub `client_secret` and exchange auth codes for tokens. This lives
in [`worker/`](worker/) and runs on Cloudflare Workers' free tier (100k
requests/day; we use ~1 request per user per session). It's the only
piece of server-side infrastructure in the project.

We considered Device Flow (which doesn't need `client_secret`, hence no
backend) but the user-visible flow is 4 steps (look at code, open GitHub
page, paste code, authorize) instead of OAuth Web Flow's 1 step (just
"Authorize"). Worth the worker.

---

## Component layout

```
src/
├── shared/         Algorithm code, types, constants. Pure logic, no I/O.
│   ├── mad.ts        MAD burst detection
│   ├── validation.ts Cross-validation logic (fork ratio + referrers)
│   ├── types.ts      Shared TypeScript types
│   └── constants.ts  Algorithm + API + storage constants
│
├── background/     MV3 service worker. Owns auth, network, cache.
│   ├── index.ts      Message router
│   ├── auth.ts       GitHub OAuth Web Flow via chrome.identity
│   ├── github.ts     API client (stargazers, forks, traffic, repo meta)
│   ├── userScore.ts  Per-user account scoring + per-user cache
│   └── analyze.ts    Orchestrates the pipeline + caching
│
├── content/        Content script. Runs on every github.com page.
│   ├── index.ts      Entry + Turbo navigation handler
│   ├── route.ts      Parse owner/repo from URL
│   └── badge.ts      DOM injection + state rendering + clickable sign-in
│
├── popup/          Browser action popup (alternative sign-in entry).
│   ├── index.html
│   ├── popup.css     GitHub-native styling, light/dark via @media
│   └── popup.ts      Auth UI
│
worker/             Cloudflare Worker — only server-side piece.
├── src/index.ts      OAuth code-to-token exchange endpoint
├── wrangler.toml
└── README.md         Deploy instructions

── Product 2: the Hall of Shame dashboard ──────────────────────────────

site/               Static site, deployed to Cloudflare Pages.
├── index.html        Trending leaderboard (daily/weekly/monthly)
├── registry.html     Searchable StarScout-flagged repo registry
├── app.js            Renders leaderboard from site/data/*.json
├── style.css
└── data/
    ├── trending.json         Scraped Trending lists (cron-written)
    ├── trending-scored.json  Per-repo verdicts (cron-written)
    └── *.csv                 StarScout ground-truth datasets

scripts/            Node batch jobs (run by GitHub Actions, not shipped).
├── fetch-trending.mjs   Scrape github.com/trending → trending.json
├── score-trending.mjs   Score each repo → trending-scored.json
├── _score-lib.mjs       ⚠️ MIRROR of analyze.ts + userScore.ts
├── bench-repo.ts        Local benchmark tool (pnpm bench)
└── diagnose-repo.ts     Single-repo burst diagnostic (pnpm diagnose)

.github/workflows/
└── trending.yml      Twice-daily cron: scrape → score → commit → deploy
```

### Why this split

- **shared/** has no Chrome APIs. It's pure functions, easy to unit test.
- **background/** owns all I/O: storage, fetch, auth state. It exposes
  message handlers; nobody else makes API calls directly.
- **content/** does DOM work and delegates to background via
  `chrome.runtime.sendMessage`. This avoids the content-script CORS
  restrictions of MV3.
- **popup/** is independent — talks to background only via messages.
- **site/ + scripts/** are the dashboard product. `site/` is pure static
  files (no build step); `scripts/` pre-computes the data the site reads.
  The site never calls the GitHub API at view time — all scoring happens
  ahead of time in the cron, so visitors load instantly and we never
  spend a visitor's rate limit. `site/data/*.json` is cron-generated and
  is in `.prettierignore` (rewritten every run; formatting it just
  breaks CI on the next push).

---

## Data flow

When you open `github.com/torvalds/linux`:

```
1. content/index.ts runs (manifest match)
2. content/route.ts parses → { owner: 'torvalds', name: 'linux' }
3. content/badge.ts injects a "⏳ analyzing…" placeholder
4. content sends { type: 'analyze-repo', payload: { owner, repo } }
5. background/index.ts routes to background/analyze.ts
6. analyze.ts checks chrome.storage for cached entry (7-day TTL +
   schema-version match)
   - Cache hit → return immediately
   - Cache miss → continue
7. fetchRepoMetadata (1 call) — gets stargazers_count for the gate
8. If stargazers_count < 1000 → return insufficientData verdict
9. Run in parallel:
   - fetchStargazers (~50 calls for 5000 stars, 6-way concurrent)
   - fetchForkTimeseries (1 call)
   - fetchTrafficReferrers (1 call, may 403 for repos user doesn't own)
10. detectBursts on the timestamps
11. Cross-validate each burst (fork ratio + referrer evidence)
12. **Global per-user analysis**: sample 200 stargazers, score them via
    userScore.ts (~200 calls, 6-way concurrent, 7-day cached cross-repo)
13. **Per-burst per-user analysis**: for each burst, sample its
    stargazers and reuse global cache; fresh-score the rest
14. Combine signals: suspiciousStars = max(burst-derived, global-derived)
15. Compute fakePercent = global suspicious ratio × 100 (when ≥10
    samples), else burst-derived; cache the result
16. Response flows back to content/badge.ts
17. badge.ts replaces the placeholder with the final result badge
```

Total API calls per analysis: typically 250-300 (cold cache).
Cache-hit path: 0 calls, ~100ms.

---

## Caching

Two caches in `chrome.storage.local`, both with 7-day TTL:

1. **Per-repo analysis cache**: keyed by `real-stars:cache:{owner}/{repo}`.
   Stores the full `AnalysisResult`. Hit returns the badge state instantly.

2. **Per-user score cache**: keyed by `real-stars:user:{login}`. Stores
   the suspicious-account score for one stargazer. Cross-repo: when the
   same throwaway account appears in multiple bought-star repos a single
   user analyzes, we pay 0 API calls the second time onwards.

Both caches carry a `schemaVersion` field. When the analysis pipeline
changes in a way that affects past verdicts, we bump
`CACHE_SCHEMA_VERSION` in [`src/shared/constants.ts`](src/shared/constants.ts);
the read paths treat mismatched entries as stale, so users get fresh
results immediately on auto-update without manual cache clearing.

The popup has a "Clear cache" button that wipes both layers.

---

## Testing

Two layers:

### Unit tests (vitest, in `tests/unit/`)

40 tests covering pure logic:

- Median + MAD computation, edge cases
- Day bucketing with gap-filling
- Burst detection across scenarios (steady growth, single-day injection,
  multi-day burst, tiny-repo fallback, threshold scaling)
- URL parsing (reserved paths, sub-paths, malformed input)
- Validation verdicts (organic / fake / suspicious branches)
- Cache schema version contract (floor enforcement)

Runs in ~500ms; no I/O.

### E2E tests (playwright, in `tests/e2e/`)

7 tests against a real Chromium with the unpacked extension loaded:

- Extension loads, manifest is valid
- Background message router responds correctly
- Cache pre-seeding round-trips through chrome.storage
- clear-cache wipes entries
- popup.html renders correctly
- analyze-repo returns insufficientData verdict for small repos
- Content script's anchor finder works on a GitHub-shaped DOM

We don't hit real github.com — too flaky, too expensive (rate limits in
CI), and requires auth. Instead, a local HTTP server serves a fixture HTML
with the same DOM structure as a real repo page.

### Calibration (scripts/calibrate.ts)

Runs the production pipeline against curated seeds and emits a markdown
report. Compares verdicts against StarScout's published ground-truth
labels. See [CALIBRATION.md](CALIBRATION.md) for the trend over time —
we went from 31% accuracy at baseline to 100% on the ≥1000-star test
set after the per-user heuristics landed.

CI runs unit + E2E + typecheck + format check on every push.

---

## Future work

Things on the maybe-someday list:

1. **Click-to-drill-down on suspicious accounts**: when a burst is
   detected, let the user click to see the actual sampled stargazers
   with their account-age / follower-count / score reasons. The data
   is already in `validatedBursts[*].userAnalysis.examples` — just
   needs UI.

2. **Star history sparkline**: render a tiny SVG of the star history
   inline with the badge, with red bands on detected bursts. Visual
   evidence beats numbers.

3. **Whitelist for known organic spikes**: a curated list of "this
   repo was on HN front page on date X" to suppress false-positive
   bursts. Per-user analysis already handles most of this, but a
   whitelist could remove the few remaining false positives on
   small-but-organic repos.

4. **Page-density MAD**: the `random` stargazer sampling strategy in
   [`src/background/github.ts`](src/background/github.ts) is wired up
   but disabled by default because the current MAD detector assumes a
   contiguous daily series. Rewriting MAD to operate on
   page-density buckets would let us analyze the whole repo lifetime
   in one pass instead of capping at 5000 most-recent stars.

5. **Chrome Web Store listing**: in review — see
   [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md).
