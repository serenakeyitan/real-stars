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

## Fixes in flight

In rough order of impact:

1. **Fix the windowing bug**: fetch stargazers across a fixed _time_
   window (e.g. last 90 days) rather than a fixed _count_, so the
   detector has a representative baseline. Or: extend the analyzed
   slice to N stargazers AND require the slice to span ≥ 60 days, so
   the rolling window has signal.

2. **Add a "minimum baseline" guard**: if the analyzed slice's total
   span is shorter than 2× WINDOW_SIZE days, skip MAD detection and
   either say "needs more history" or fall back to the percent-growth
   heuristic only.

3. **Whitelist of known-good large repos**: torvalds/linux,
   microsoft/vscode, etc. Pragmatic short-term mitigation; doesn't fix
   the algorithm but limits the public-embarrassment risk while we fix
   it.

4. **Curate a richer test set**: 26 repos isn't enough for a
   precision/recall calculation. After the fixes above, generate fresh
   seeds with `pnpm calibrate:build-seeds --suspicious 50 --organic 50`
   and re-measure.

Each fix gets a follow-up calibration report committed under
`calibration/`, so the trend over time is auditable.
