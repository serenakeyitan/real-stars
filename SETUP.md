# Setup guide

> **For end users**: install real-stars from the Chrome Web Store. None of
> this guide applies to you — the extension Just Works. This document is
> for contributors building from source.

There are three parts:

1. **Register a GitHub OAuth App** — 1 minute, one-time.
2. **Deploy the Cloudflare Worker** — 2 minutes, one-time. Free.
3. **Build and load the extension** — and you're done.

## Dev vs. prod OAuth apps — what you need to know first

real-stars uses **two** OAuth apps in production: one for the Chrome Web
Store install (prod), one for unpacked-extension development (dev). They
have different client IDs and different callback URLs.

This document walks you through setting up your **own** dev OAuth app. The
prod OAuth app is owned by the maintainer; you don't need to set it up
unless you're forking and publishing a separate extension.

The split exists because GitHub OAuth apps allow only one callback URL,
and the Web Store and unpacked installs get different extension IDs.

---

## 1. Register a GitHub OAuth App

1. Open https://github.com/settings/applications/new
2. Fill out the form:
   - **Application name**: `real-stars` (or whatever)
   - **Homepage URL**: `https://github.com/serenakeyitan/real-stars`
   - **Authorization callback URL**: this is the tricky one. Run `pnpm build`
     once, load the extension at `chrome://extensions` (Developer mode →
     Load unpacked → select `dist/`), and the extension's ID will appear.
     The callback URL is then:
     ```
     https://<extension-id>.chromiumapp.org/
     ```
     (Yes, `chromiumapp.org` — Chrome's built-in auth-proxy domain.)
3. Click **Register application**.
4. On the next page, click **Generate a new client secret** and copy it
   (you'll need it in step 2). Also copy the **Client ID** — you'll need
   it in step 3.

---

## 2. Deploy the Cloudflare Worker (dev environment)

Each OAuth app needs its own Worker because each Worker holds a
client_secret. We deploy the **dev** worker (`real-stars-oauth-dev`) here;
the prod worker is already deployed.

```bash
cd worker
pnpm install
pnpm wrangler login                                       # opens browser to authorize Cloudflare CLI
pnpm wrangler secret put GITHUB_CLIENT_ID --env dev       # paste the dev Client ID from step 1
pnpm wrangler secret put GITHUB_CLIENT_SECRET --env dev   # paste the dev Client Secret from step 1
pnpm wrangler deploy --env dev                            # → real-stars-oauth-dev.<your-subdomain>.workers.dev
```

> The `--env dev` selects `[env.dev]` in `wrangler.toml`, which only
> overrides `name = "real-stars-oauth-dev"`. Everything else (the code,
> compatibility date) is shared.

The deploy command prints a URL like
`https://real-stars-oauth-dev.<your-subdomain>.workers.dev`. Copy that —
you need it in step 3.

---

## 3. Build and load the extension

The extension reads its OAuth client ID + worker URL from
`.env.development` (committed but with placeholders) at build time.
Replace the placeholders with your values from steps 1 and 2:

```bash
# .env.development
VITE_GITHUB_CLIENT_ID=Ov23li_your_dev_id_here
VITE_OAUTH_EXCHANGE_URL=https://real-stars-oauth-dev.your-subdomain.workers.dev/exchange
VITE_EXTENSION_NAME=real-stars (dev)
VITE_EXTENSION_KEY=  # optional — see below
```

> **Why a separate `(dev)` name?** So your dev install can sit alongside
> the Web Store version in `chrome://extensions` without conflicting.

Then:

```bash
pnpm install
pnpm build:dev    # writes a templated dist/manifest.json with the dev name
                  # and version 0.2.2.99 (the .99 marks it as a dev build)
```

In Chrome:

1. Open `chrome://extensions`
2. **Developer mode** on (top-right toggle)
3. **Load unpacked** → select `dist/`
4. Note the extension ID under the card — this is what goes in your
   GitHub OAuth App's callback URL (step 1)

That's it. The icon appears in your toolbar.

### Optional: pin a stable dev extension ID

By default Chrome derives the extension ID from your local path, so
moving the repo to a different folder changes the ID and you'd have to
update the callback URL on GitHub again. Pin the ID by adding a `key`:

1. `chrome://extensions` → **Pack extension** → select `dist/`, leave key
   blank → click **Pack extension**
2. Chrome writes a `dist.pem` file next to your dist folder
3. Extract the public key from the .pem with:
   ```bash
   openssl rsa -in dist.pem -pubout -outform DER 2>/dev/null | openssl base64 -A
   ```
4. Paste the resulting one-line base64 string into `.env.development`:
   ```
   VITE_EXTENSION_KEY=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
   ```
5. Rebuild with `pnpm build:dev` and reload at `chrome://extensions`

Now the dev extension ID stays the same forever — keep `dist.pem`
private but committed locally, and never paste it into a public place.

---

## 4. Sign in (one click)

Visit any GitHub repo page (e.g. `github.com/torvalds/linux`). The
extension injects a `🔒 sign in with GitHub` badge next to the star
count.

Click the badge → a Chrome popup opens with GitHub's "Authorize real-stars"
page (since you're already logged into GitHub) → click **Authorize** →
done. Badge updates to show the real-star analysis.

You only do this once. After that, real-stars works on every repo
silently.

---

## Troubleshooting

**Background script throws "VITE_GITHUB_CLIENT_ID is not set"**: your
`.env.development` still has `__DEV_CLIENT_ID__` as the placeholder.
Replace it with your real client ID and rebuild with `pnpm build:dev`.

**Sign-in popup says "redirect URL mismatch" or "The redirect_uri is not
associated with this application"**: the callback URL you registered in
step 1 doesn't match the extension ID Chrome assigned. Look up the
extension ID at `chrome://extensions` (under the extension card), go
back to your GitHub OAuth App settings, and update the callback URL to
`https://<that-id>.chromiumapp.org/` (note the trailing `/`).

If your dev extension ID keeps changing between rebuilds, see "Pin a
stable dev extension ID" in step 3.

**Sign-in fails with "token exchange failed: 502"**: the Worker is
configured wrong. Check that both secrets are set:

```bash
cd worker
pnpm wrangler secret list
```

Should show `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. If either is
missing, re-run `wrangler secret put`.

**Rate limit hit**: each user has 5000 GitHub API calls/hour with their
own token. A typical analysis is 35-37 calls, so this comfortably
supports 100+ repo lookups per hour. The 7-day cache means revisits are
free.

---

## Development

```bash
pnpm dev          # development build, rebuild on file changes (--mode development)
pnpm build:dev    # one-off development build
pnpm build        # production build (--mode production); minified, no sourcemaps
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright E2E (loads dist/ in headed Chromium)
pnpm format       # prettier
pnpm package      # build prod + zip → artifacts/real-stars-{version}.zip
```

The mode flag determines which `.env.*` file is read:

- `--mode development` → `.env.development` → dev OAuth app + dev worker
- `--mode production` → `.env.production` → prod OAuth app + prod worker

The mode also flips:
- Manifest `name` → `real-stars (dev)` vs `real-stars`
- Manifest `version` → `0.2.2.99` vs `0.2.2`
- Manifest `host_permissions` worker URL → dev worker vs prod worker
- Manifest `key` → present (if VITE_EXTENSION_KEY set) vs absent
- Sourcemaps + minification → off vs on

After changes you usually need to:

1. `pnpm build` (or run `pnpm dev` in another terminal)
2. Go to `chrome://extensions`, click the reload icon on the real-stars
   card

---

## What about the cost?

Free, forever:

- **Cloudflare Workers**: 100,000 free requests/day. The Worker is hit
  once per user per sign-in. You'd need ~10,000 daily new users before
  hitting the cap.
- **GitHub API**: each authenticated user has their own 5,000/hr quota.
- **OAuth App registration**: free.
- **Chrome Web Store** (when you're ready to publish): one-time $5
  developer registration. Not required to use the extension via "Load
  unpacked".
