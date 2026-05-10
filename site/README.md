# GitHub Hall of Shame

Static website that visualizes the StarScout (ICSE 2026) fake-star dataset.

- **Live**: https://hall-of-shame.pages.dev (after deploy)
- **Source data**: [StarScout/data/250101/](https://github.com/hehao98/StarScout/tree/main/data/250101)
- **Paper**: https://arxiv.org/abs/2412.13459

## Stack

- Static HTML + CSS + vanilla JS, zero framework
- `data/hall-of-shame.json` (~1.5 MB, 13,499 repos) built from StarScout's CSVs
- Hosted on Cloudflare Pages (free tier)

## Build

```bash
# Regenerate the data JSON from the StarScout CSVs in data/
node site/build-data.mjs
```

## Local dev

```bash
cd site
python3 -m http.server 4567
open http://localhost:4567
```

## Deploy

```bash
cd worker  # reuse the same wrangler setup
pnpm wrangler pages deploy ../site --project-name=real-stars-hall-of-shame
```

First deploy creates the project on Cloudflare; later deploys just push new files.

## Updating data

When StarScout publishes a new snapshot:

1. Replace `data/starscout-low.csv` and `data/starscout-clustered.csv`
2. Re-run `node build-data.mjs`
3. Re-deploy
