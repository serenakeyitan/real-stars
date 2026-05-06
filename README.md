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
- [x] GitHub Device Flow auth (no backend, no PAT setup)
- [x] In-page badge injection
- [ ] Chrome Web Store listing

## Install (developer mode)

See [SETUP.md](SETUP.md).

## License

MIT. See [LICENSE](LICENSE).

The MAD burst-detection algorithm is ported from
[StarGuard](https://github.com/m-ahmed-elbeskeri/Starguard) (Apache-2.0).
