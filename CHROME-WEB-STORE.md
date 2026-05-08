# Publishing to Chrome Web Store

How to take real-stars from "load unpacked" to "anyone can install with one
click from the store". This is a one-time setup; future releases just need
a new zip upload.

## Prerequisites

- A Google account (the email becomes the public listing's "developer")
- A credit card or PayPal (one-time **$5 USD** to register as a developer)
- The current build at `dist/` running cleanly via "Load unpacked" in your
  own Chrome — confirm everything works before uploading

## Step 1 — Register as a Chrome Web Store developer

1. Open https://chrome.google.com/webstore/devconsole/register
2. Sign in with the Google account you want to publish under
3. Pay the **$5 one-time** registration fee
4. Verify the email Google sends

Once registered you have a **publisher account** that lives forever.

## Step 2 — Build the release artifact

```bash
cd ~/code/real-stars
git pull   # make sure you're on main
pnpm install
pnpm package
```

This produces `artifacts/real-stars-0.1.0.zip` (~36 KB). The store wants
this exact zip — don't rezip the dist folder yourself.

> **Alternative**: tag `v0.1.0` and let GitHub Actions build it for you.
> The release workflow attaches the zip to a GitHub release automatically.
>
> ```bash
> git tag v0.1.0
> git push origin v0.1.0
> ```
>
> Wait ~1 min, then download the zip from `https://github.com/serenakeyitan/real-stars/releases/tag/v0.1.0`.

## Step 3 — Create the listing in the dev console

1. Open https://chrome.google.com/webstore/devconsole
2. Click **New Item** → upload `real-stars-0.1.0.zip` → wait for parsing
3. Fill out the **Store listing** tab. Suggested copy:

   **Item name** (max 50 chars):

   ```
   real-stars: detect fake GitHub stars
   ```

   **Short description** (max 132 chars):

   ```
   Shows the real star count next to GitHub repo titles by detecting bought stars with statistical anomaly detection.
   ```

   **Detailed description** (suggested, edit as you like):

   ```
   real-stars analyzes the star history of any GitHub repo you visit and
   shows how many of those stars look real, right next to GitHub's official
   star count.

   How it works:
   • Detects statistical anomalies in star history using a sliding-window
     MAD (median absolute deviation) algorithm — the fingerprint of bought
     stars
   • Cross-validates each anomaly against fork activity and traffic
     referrers — real spikes (Hacker News, Reddit, Twitter) leave evidence
     while bought stars don't
   • One-click GitHub OAuth sign-in (no token setup, no copy-pasting)

   Calibration:
   The detection algorithm was validated against StarScout's published
   ground-truth dataset (ICSE 2026 paper, 581 manually-labeled repos).
   Results on repos ≥1000 stars: 90% accuracy. Smaller repos get a "needs
   more data" badge instead of a verdict — we'd rather under-detect than
   libel a real project.

   Source: https://github.com/serenakeyitan/real-stars

   Privacy: real-stars only reads public repo metadata via the GitHub API
   using your own OAuth token. Nothing is sent to any third-party server
   except a small Cloudflare Worker that exchanges the OAuth code for a
   token (the token never leaves your browser after that).
   ```

4. **Category**: Developer Tools

5. **Language**: English (and whatever else you want)

6. **Screenshots** (1280×800 or 640×400; 1-5 of them):
   - Open `https://github.com/torvalds/linux` with the extension active,
     screenshot the badge area
   - Open the popup with "Connected (@username)", screenshot
   - Optional: a small repo showing the "— not enough data" state
   - Use macOS `Cmd+Shift+4` then space-bar to capture window

7. **Promotional images** (optional but recommended for visibility):
   - Small: 440×280
   - Marquee: 1400×560 (Google sometimes features extensions on this)
   - I'd skip these for v0.1.0 and add later if you want featured placement

8. **Icon**: already in the manifest, the dashboard auto-extracts it

## Step 4 — Privacy & Permissions tab

This is where most reviews get held up. Be honest and exact:

**Single purpose**:

```
Detect statistically anomalous star patterns on GitHub repository pages
and display the estimated real star count.
```

**Permissions justifications**:

- **storage**: caches analysis results for 7 days so revisits don't re-hit GitHub API
- **identity**: chrome.identity.launchWebAuthFlow for the OAuth sign-in
- **host: github.com**: content script injects the badge on repo pages
- **host: api.github.com**: reads public repo metadata (stargazers, forks, traffic)
- **host: \*.workers.dev**: posts the OAuth code to the Cloudflare Worker that holds the client_secret

**Remote code use**: select "I am not using remote code"

**Data usage**: select these checkboxes truthfully:

- ☑ "I do not collect personally identifiable information"
- ☑ "I do not collect health information"
- ☑ "I do not collect financial info"
- ☑ "I do not collect authentication info" (your OAuth token stays in chrome.storage.local — not transmitted to us)
- ☑ "I do not collect personal communications"
- ☑ "I do not collect location"
- ☑ "I do not collect web history"
- ☑ "I do not collect user activity"
- ☑ "I do not collect website content"

**Privacy policy URL**: required if you collect anything; for a non-collecting extension you can paste a static page like:

- Option A: link to the README's Privacy section on GitHub (`https://github.com/serenakeyitan/real-stars#privacy`)
- Option B: a one-paragraph privacy.html in the repo

I'd add a Privacy section to README.md saying "real-stars stores your
GitHub OAuth token in chrome.storage.local on your device. It is never
transmitted to any server. The Cloudflare Worker is contacted exactly
once per sign-in to exchange the auth code for a token; after that, all
GitHub API calls go directly from your browser."

## Step 5 — Submit for review

Click **Submit for Review**. Google's review takes anywhere from a few
hours to 7 days. The first submission is usually the slowest (manual
review). Subsequent updates are often automated and ship within an hour.

Common rejection reasons and how to avoid:

- **"Permissions broader than necessary"**: be specific in the
  justifications above. Don't request `<all_urls>` if you don't need it.
  We're already limited to `github.com/*` and `api.github.com/*`.
- **"Privacy policy is missing or generic"**: write a real one in the
  README. Generic boilerplate gets rejected.
- **"Description doesn't match functionality"**: don't make claims you
  can't deliver ("guaranteed 99% accuracy"). Stick to the calibration
  numbers.

## Step 6 — After it ships

You'll get an email from Google with the listing URL like:

```
https://chrome.google.com/webstore/detail/real-stars/<some-id>
```

That `<some-id>` is your **production extension ID**, and it's
**different** from your unpacked dev ID.

⚠️ **Important consequence**: the OAuth callback URL in your GitHub OAuth
App is currently
`https://ohhppnbknaeoflepnfifkegjpgedmnll.chromiumapp.org/` — this is your
**dev** ID. Once published, users installed from the store will have the
**production** ID, and OAuth will fail for them.

Two options:

1. Add the production callback URL to your existing OAuth App. GitHub
   actually only allows one callback URL per OAuth App, so you have to
   either replace it (breaks your dev) or register a second OAuth App
   for production.
2. **Recommended**: register a second OAuth App ("real-stars production")
   with the production callback URL, deploy a second Worker (or update
   the existing one's `GITHUB_CLIENT_ID` secret), and update
   `src/shared/constants.ts` for the production build.

I'd handle this on the first store-side update — by then you'll have the
real production ID.

## Step 7 — Future updates

Subsequent versions:

```bash
# Edit package.json: bump version to 0.1.1
# Edit public/manifest.json: bump version to 0.1.1
git tag v0.1.1
git push origin v0.1.1
# CI release workflow attaches new zip to GitHub release
```

Then in the dev console, click your extension → **Package** → upload the
new zip → click **Submit for Review**. Patch releases usually go through
in under an hour.

## Total time

| Step               | Time                           |
| ------------------ | ------------------------------ |
| 1. Register        | 5 min                          |
| 2. Build artifact  | 1 min                          |
| 3. Listing copy    | 30 min (writing + screenshots) |
| 4. Privacy & perms | 15 min                         |
| 5. Submit          | 1 min                          |
| 6. Wait for review | 1 hour – 7 days                |

So **~1 hour of work**, then waiting on Google.
