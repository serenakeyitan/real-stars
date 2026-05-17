# scripts/research/

One-off / exploratory scripts. **Not part of the product or CI.** Kept
in-repo for reference and reproducibility, but nothing (package.json,
workflows, the extension, the dashboard) depends on them.

Production scripts live in `scripts/` directly:

- `fetch-trending.mjs` — scrape github.com/trending (cron)
- `score-trending.ts` — score trending repos (cron, runs via tsx)
- `_score-lib.ts` — shared scoring library used by score-trending
- `bench-repo.ts` — `pnpm bench` benchmark tool
- `diagnose-repo.ts` — `pnpm diagnose` single-repo burst diagnostic
- `pack.mjs` — `pnpm package` extension zip builder

The files here were investigative: `study-github.mjs` /
`study-banners.mjs` (one-time DOM/structure probes), `mobile-audit.mjs`
(responsive checks), `diff-trending.mjs` (ad-hoc trending diffing),
`screenshot-for-store.sh` (Chrome Web Store asset capture). If one of
these becomes load-bearing, promote it back to `scripts/` and wire it
into package.json so the boundary stays honest.
