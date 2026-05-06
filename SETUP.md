# Setup guide

This is everything you need to do to get real-stars running.

There are three parts:

1. **Register a GitHub OAuth App** — 1 minute, one-time.
2. **Deploy the Cloudflare Worker** — 2 minutes, one-time. Free.
3. **Build and load the extension** — and you're done.

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

## 2. Deploy the Cloudflare Worker

The Worker exchanges the OAuth code for an access token. It needs the
client_secret from step 1, which is why we don't put it directly in the
extension.

```bash
cd worker
pnpm install
pnpm wrangler login                         # opens browser to authorize Cloudflare CLI
pnpm wrangler secret put GITHUB_CLIENT_ID   # paste the Client ID from step 1
pnpm wrangler secret put GITHUB_CLIENT_SECRET # paste the Client Secret from step 1
pnpm deploy
```

The deploy command prints a URL like
`https://real-stars-oauth.<your-subdomain>.workers.dev`. Copy that URL.

---

## 3. Build and load the extension

Open `src/shared/constants.ts` and replace **two** placeholders:

```typescript
// Before
export const GITHUB_CLIENT_ID = '__REPLACE_WITH_REAL_CLIENT_ID__';
export const OAUTH_EXCHANGE_URL = '__REPLACE_WITH_WORKER_URL__/exchange';

// After (using your values from steps 1 and 2)
export const GITHUB_CLIENT_ID = 'Ov23li_your_real_id_here';
export const OAUTH_EXCHANGE_URL = 'https://real-stars-oauth.your-subdomain.workers.dev/exchange';
```

Then:

```bash
pnpm install
pnpm build
```

In Chrome:

1. Open `chrome://extensions`
2. **Developer mode** on (top-right toggle)
3. **Load unpacked** → select `dist/`

That's it. The icon appears in your toolbar.

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

**Badge says "GitHub Client ID not configured"**: you skipped step 3, or
forgot to rebuild after replacing the placeholders. Run `pnpm build`
again and reload the extension at `chrome://extensions`.

**Sign-in popup says "redirect URL mismatch"**: the callback URL you
registered in step 1 doesn't match the extension ID Chrome assigned. Look
up the extension ID at `chrome://extensions` (under the extension card),
go back to your GitHub OAuth App settings, and update the callback URL
to `https://<that-id>.chromiumapp.org/`.

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
pnpm dev          # rebuild on file changes
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright E2E (loads dist/ in headed Chromium)
pnpm format       # prettier
pnpm package      # build + zip → artifacts/real-stars-{version}.zip
```

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
