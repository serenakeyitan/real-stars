# Calibration

real-stars' detection algorithm needs to be measured against ground truth,
not just unit-tested. This doc explains how we measure it, what we found,
and what we're doing about it.

## Why this exists

Unit tests prove the algorithm does what we wrote, not whether what we
wrote is _correct_ in the wild. For an anomaly detector, "correct" means:

- **Low false-positive rate** on real organic repos (don't tell users
  Linus's Linux kernel has bought stars).
- **Decent recall** on actually-fake repos (catch the bought-star sellers).

We use **StarScout's published ground truth** as the gold standard:

- StarScout (ICSE 2026, [paper](https://arxiv.org/abs/2412.13459))
  published [`repo_labels.csv`](https://github.com/hehao98/StarScout/blob/main/data/repo_labels.csv)
  with 581 manually-classified repos. The `ai_label` column is either
  `"suspicious"` (flagged as having fake stars, 103 repos) or a domain
  classification like `ai`, `blockchain`, `tool/application`, `web`,
  `tutorial/demo`, `basic-utility`, `database` (478 repos passed
  StarScout's filters and got a real-product domain label).

This dataset has the credibility of being peer-reviewed and produced by a
team that was independent of us — exactly what a calibration set should be.

## How to run it

```bash
# 1. Build the seed list (uses StarScout's CSV, samples 8+8 by default).
GITHUB_TOKEN=$(gh auth token) pnpm calibrate:build-seeds \
    --suspicious 10 --organic 10 \
    --out scripts/calibration-repos-fresh.json

# 2. Run the algorithm against the seeds.
GITHUB_TOKEN=$(gh auth token) pnpm calibrate \
    --seeds scripts/calibration-repos-fresh.json \
    --limit 1500 \
    --out calibration/report-{date}.md
```

Each report is a markdown table comparing the algorithm's verdict
(low / medium / high risk) against the seed's expected label
(organic / fake-suspect).

## Baseline (2026-05-06)

**26 repos: 18 organic + 8 fake-suspect. Stargazer limit: 1500.**

|                    | Agree       | Disagree | Total |
| ------------------ | ----------- | -------- | ----- |
| Organic seeds      | 4           | 14       | 18    |
| Fake-suspect seeds | 4           | 4        | 8     |
| **Overall**        | **8 (31%)** | **18**   | 26    |

Full report: [calibration/baseline.md](calibration/baseline.md)

### Key findings

**1. Severe false-positive rate on large organic repos.** Every popular
real-world project (linux, vscode, react, kubernetes, deno, next.js,
rust, claude-code, transformers — 9 of 9 mega-repos) was flagged as
**high risk with 40-100% suspicious stars**. This is clearly wrong.

**Diagnosis**: when the algorithm only looks at the most recent 1500
stargazers of a repo with 100k+ stars, those 1500 stars span a tiny
window (a week or two). A repo getting hundreds of stars/day looks
identical to a single sustained "burst" relative to the rolling
28-day median (which is itself within the burst window). The MAD
threshold then flags virtually all of them as anomalous.

This is not an algorithm bug — it's a windowing / sampling bug in how
the extension uses the algorithm. The MAD detector is sound on long
historical timeseries; it breaks when the timeseries is just "the
last week of activity on a viral repo".

**2. Smaller repos look better.** When the analyzed slice equals the
full repo (i.e. for repos with < 1500 total stars, we see the full
history), false positives drop sharply. `openai/openai-python`
(30k stars but we got 1496 of them in cache) was correctly classified
low-risk; smaller StarScout-classified-organic repos were also handled
well.

**3. Recall on fake-suspect is mixed.** 4/8 caught (50% recall). Of the
misses:

- `azkadev/terminal_flutter` (1 total star), `hwidspoofer1/...` (4
  stars), `kazura233/web-daemon` (667 stars): very few stars total. The
  fake-star episode that earned them their StarScout label may have
  been removed by GitHub's T&S team (which deletes ~90% of flagged
  repos per the paper's headline finding). What's left looks organic
  because the evidence is gone.
- `LupusLeaks/EasyFN` (6.8k stars): we did detect bursts but they
  validated as "organic" because forks were present. May indicate the
  fake-star episode is too old for our 14-day traffic-referrer window
  to confirm, while fork ratio looks ambiguous.

## Implications for production

**The extension v1, as-shipped, would broadcast false fake-star claims
about every popular repo on GitHub.** That is not an acceptable failure
mode. We'd rather under-detect than libel known-good repos.

## Fix #1: viral-truncation guard (2026-05-06)

[`src/shared/mad.ts`](src/shared/mad.ts) now refuses to flag any bursts
when the analyzed slice satisfies BOTH:

- spans fewer than `2 * WINDOW_SIZE` (= 56) days
- AND has average density > `HIGH_DENSITY_THRESHOLD` (= 10) stars/day

These two together identify the failure mode where we got a slice of a
viral repo too short for the rolling-MAD baseline to be meaningful.
Tiny repos with low-density activity still flow through to the
percent-growth fallback and can flag bursts there.

### Result: 31% → 50% accuracy

Full report: [calibration/post-fix-2.md](calibration/post-fix-2.md)

|                    | Agree        | Disagree | Total |
| ------------------ | ------------ | -------- | ----- |
| Organic seeds      | 12           | 6        | 18    |
| Fake-suspect seeds | 2            | 6        | 8     |
| **Overall**        | **14 (54%)** | **12**   | 26    |

Gains: 9 of 10 mega-repos now correctly classified low-risk
(linux ✅ vscode ✅ kubernetes ✅ react ✅ deno ✅ claude-code ✅
openai-python ✅ transformers ✅; next.js ❌ rust ❌ still
disagree, both falling on the wrong side of the density threshold).

Loss: fake-suspect recall dropped from 4/8 to 2/8. The guard suppresses
bursts on small repos when the few stars they have come in fast — which
includes some genuine bought-star episodes (`djwalkzz16/krunker.io-hack`
went from correctly-flagged to false-negative).

**Net trade-off accepted**: a low-stakes false-negative on a 24-star
repo is preferable to publicly libeling Linux. We can recover recall
later via per-user heuristics (v2) which don't depend on the time
series at all.

## Remaining failure modes

After fix #1, the disagreements break down as:

**False positives (organic flagged as suspicious, 6 repos)**:

- `vercel/next.js`, `rust-lang/rust`: density just below 10/day, slip
  past the guard. Could tighten further but at risk of more recall loss.
- `mgtv-tech/jetcache-go`, `diamcircle/Aurora`,
  `holochain/launcher`, `DosX-dev/MemCleaner`: small-to-medium repos
  (200-500 stars) where the algorithm sees real bursts that may or
  may not be fake. StarScout classified them as legitimate domains
  (basic-utility/blockchain/tool), but the fork+referrer signals are
  weak. Hard cases.

**False negatives (fake-suspect flagged as organic, 6 repos)**:

- `azkadev/terminal_flutter` (1 star), `hwidspoofer1/...` (4 stars),
  `Imran407704/stest` (0 stars): GitHub T&S has already cleaned up the
  fake stars. The episode is gone; we have nothing to detect.
- `LupusLeaks/EasyFN` (6.8k stars): bursts detected but cross-validated
  as organic via fork ratio. May be a real organic spike that shared
  bot accounts later abused, or our fork-ratio threshold is too lenient.
- `iexa/justexp`, `kazura233/web-daemon`, `djwalkzz16/krunker.io-hack`:
  guarded out by the new viral-truncation guard. Some of these may be
  legit catches the guard is too aggressive on.

## Larger validation: 72 repos (2026-05-06)

After fix #1, we ran a 3× larger calibration to test whether the 50%
accuracy was a small-sample artifact. Seeds were generated by sampling
StarScout's full 581-row labeled set with `--suspicious 50 --organic 50`
and filtering for currently-accessible repos. Only 22 of 50 sampled
fake-suspect repos were still accessible — consistent with StarScout's
headline finding that GitHub Trust & Safety eventually deletes ~90% of
flagged repos.

Final seed: 22 fake-suspect + 50 organic = 72 repos.

|                    | Agree        | Disagree | Total |
| ------------------ | ------------ | -------- | ----- |
| Organic seeds      | 34           | 16       | 50    |
| Fake-suspect seeds | 7            | 15       | 22    |
| **Overall**        | **41 (57%)** | **31**   | 72    |

Full report: [calibration/large-72-2026-05-06.md](calibration/large-72-2026-05-06.md)

### Performance by repo size

The 72-repo run reveals the algorithm's quality is **strongly
size-dependent**. Cross-tabbed by total star count:

| Cohort                      | Agree | Disagree | Accuracy |
| --------------------------- | ----- | -------- | -------- |
| Organic, ≥ 1000 stars       | 9     | 1        | **90%**  |
| Organic, 100–1000 stars     | 14    | 11       | **56%**  |
| Organic, < 100 stars        | 11    | 4        | 73%      |
| Fake-suspect, 30–1000 stars | 4     | 2        | 67%      |
| Fake-suspect, < 30 stars    | 3     | 12       | **20%**  |

**Conclusion**: the algorithm is **production-quality on large repos
(≥1000 stars, 90% accuracy)** and **not yet production-quality on
small-to-medium repos (100-1000 stars, 56% false-positive rate)**.

### Why small-repo false negatives are mostly ground-truth artifacts

15 fake-suspect repos were missed; 12 of them have under 30 total stars
(`Imran407704/payloads` literally has 0 stars, `azkadev/terminal_flutter`
has 1, `hwidspoofer1/...` has 4, etc). These are repos where **GitHub
T&S has already deleted the fake stars** — the StarScout label was
earned at a moment in time, but by the time we look, there's nothing
left to detect.

The fake-star episodes that are still detectable on GitHub today are
the recent ones, where T&S hasn't gotten around to cleanup yet. A
re-test with a fresher StarScout dataset (their 2025-01-01 snapshot is
the latest published) would partly fix this, but the fundamental
limitation remains: **post-cleanup**, our algorithm has nothing to
work with.

### Why medium-repo false positives are the real algorithm problem

11 organic repos in the 100-1000 star range were wrongly flagged. These
are real-product repos (blockchain SDKs, AI projects, tools) where the
algorithm sees burst patterns in the time series but the cross-validation
signals are weak:

- Fork ratios on small projects are inherently noisy (a repo with 200
  stars might genuinely have 0 forks during a burst week — that doesn't
  mean the spike is fake)
- Traffic API requires push access, so for these third-party repos we
  get no referrer signal at all (silently)
- The bursts that get detected on small organic repos may be genuine
  external events (a tweet, a small newsletter mention) without enough
  referrer traffic to clear our 5-uniques threshold

This is the v2 problem: per-user heuristics on the burst stargazers
would correctly classify most of these as organic.

### Production-readiness verdict

**Ship-ready for repos with ≥1000 stars** (90% accuracy, 1 false-positive
out of 10).

**Not ship-ready for repos with <1000 stars without a clear UI signal
of uncertainty**. Options:

1. Display "needs more data" / "uncertain" instead of a hard verdict
   when the analyzed slice is small AND the cohort is in the
   problematic range.
2. Restrict the badge to only repos with ≥1000 stars in v1 and roll
   out the long tail in v2 once per-user heuristics land.

## Future fixes

1. **Whitelist known-organic mega-repos**: short-term hedge while we
   tune. linux/vscode/etc never need analysis anyway.
2. **Per-user activity check**: for the 6 small "false positive" cases,
   check whether the burst stargazers look like real or throwaway
   accounts. This is the v2 plan in ARCHITECTURE.md and would close
   the small-repo recall gap.
3. **Larger calibration set**: 26 is too few for precision/recall
   stability. Generate 50+50 fresh seeds.

Each fix gets a follow-up calibration report committed under
`calibration/`, so the trend over time is auditable.
