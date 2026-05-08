# real-stars

Chrome extension that exposes fake stars on GitHub repositories.

When you open a GitHub repo, real-stars analyzes the star history and shows
how many stars look real next to the official star count.

```
[ ⭐ 12.4k ]  [ 🚨 8.2k real (66%) ]
```

## How it works

real-stars ports the [StarGuard](https://github.com/m-ahmed-elbeskeri/Starguard)
fake-star detection algorithm to run client-side in your browser.

1. Pull stargazer timestamps from the GitHub API
2. Run a sliding-window MAD (Median Absolute Deviation) algorithm to detect
   anomalous spikes in the star history — the statistical fingerprint of bought stars
3. Cross-validate each suspicious burst against fork activity and traffic referrers —
   real spikes (HN, Reddit, Twitter virality) leave evidence; bought stars don't
4. Subtract the suspicious stars and display the estimated real count

## Status

Early development. v1 features:

- [x] MAD burst detection (ported from StarGuard)
- [x] Fork ratio cross-validation
- [x] Traffic referrer cross-validation
- [x] One-click GitHub sign-in (OAuth Web Flow via Cloudflare Worker)
- [x] In-page badge injection
- [x] Confidence gate at 1000 stars — calibrated against StarScout (ICSE 2026) ground truth
- [x] Parallel API fetching (~5x speedup; analysis takes ~2s)
- [ ] Chrome Web Store listing — see [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md)

## Install (developer mode)

See [SETUP.md](SETUP.md).

## Privacy

real-stars is privacy-preserving by design. We do not run any backend that
sees your data:

- **Your GitHub OAuth token** is stored in `chrome.storage.local` on your
  device. It is never transmitted to any server we control.
- **Repository analysis** is computed entirely in your browser. The MAD
  burst-detection algorithm and cross-validation logic run as a local
  service worker.
- **GitHub API calls** go directly from your browser to GitHub's servers
  (`api.github.com`), authenticated with your own token under your own
  rate-limit quota.
- **The only server-side component** is a small [Cloudflare Worker](worker/)
  that exchanges your OAuth code for a token during the one-time sign-in.
  This is required because GitHub's OAuth Web Flow needs a `client_secret`,
  which can't safely live in a Chrome extension. The Worker holds the
  secret and proxies the exchange. Your access token is returned to your
  browser and never logged.
- **No analytics, no telemetry, no third-party scripts.**

The 7-day cache of analysis results lives in `chrome.storage.local`. You
can wipe it any time with the "Clear cache" button in the popup, or
uninstall the extension.

## License

MIT. See [LICENSE](LICENSE).

The MAD burst-detection algorithm is ported from
[StarGuard](https://github.com/m-ahmed-elbeskeri/Starguard) (Apache-2.0).
