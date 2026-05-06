# Setup guide

This is everything you need to do to get real-stars running locally.

There are two parts:

1. **Register a GitHub OAuth App** — 30 seconds, one-time. Replaces the
   placeholder Client ID in the source. **You have to do this yourself** —
   it has to be tied to your own GitHub account.
2. **Build and load the extension** in Chrome.

---

## 1. Register a GitHub OAuth App

The extension uses [GitHub Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
for authentication. Device Flow needs an OAuth App's Client ID (but not the
secret — that's why we don't need a backend).

1. Open https://github.com/settings/applications/new
2. Fill out the form:
   - **Application name**: `real-stars` (or whatever you want)
   - **Homepage URL**: `https://github.com/serenakeyitan/real-stars`
   - **Authorization callback URL**: `https://github.com/serenakeyitan/real-stars`
     (Device Flow ignores this, but GitHub requires the field to be filled.)
3. Click **Register application**.
4. On the next page, **enable Device Flow** by checking the box and saving.
5. Copy the **Client ID** (looks like `Iv1.abc123...` or `Ov23li...`).

Now open `src/shared/constants.ts` in this repo and replace the placeholder:

```ts
// Before
export const GITHUB_CLIENT_ID = '__REPLACE_WITH_REAL_CLIENT_ID__';

// After
export const GITHUB_CLIENT_ID = 'Ov23li_your_real_id_here';
```

You can also create a local-only override that won't be committed:

```bash
# .real-stars-config.local.ts (gitignored)
export const GITHUB_CLIENT_ID = 'Ov23li_your_real_id_here';
```

…but that requires editing `constants.ts` to import from there, so simplest
is to just replace the value (the gitignore won't save you here either way —
just be careful not to commit it).

---

## 2. Build and load the extension

```bash
pnpm install
pnpm build
```

This produces `dist/` containing the loadable extension.

Then in Chrome:

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder

The real-stars icon should appear in your toolbar.

---

## 3. Connect your GitHub account

1. Click the real-stars icon
2. Click **Connect GitHub**
3. The popup shows an 8-character code (e.g. `WDJB-MJHT`) and a button
4. Click the button → opens `github.com/login/device` in a new tab, with the
   code already copied to your clipboard
5. Paste the code, click **Continue**, click **Authorize**
6. Come back to the popup — it should say "Connected"

Now visit any GitHub repo (e.g. `github.com/torvalds/linux`). After a few
seconds, the real-stars badge appears next to the star count.

---

## Troubleshooting

**Badge says "🔒 connect GitHub" but I'm connected**: hard-reload the page
(`Cmd+Shift+R`). The content script caches the auth state per page load.

**Badge says "⚠ analysis failed"**: open the Chrome DevTools, go to the
**Service Worker** for the real-stars extension (chrome://extensions →
"Inspect views: service worker"), and check the console for the actual
error.

**Rate limit hit**: the badge will say "rate limit hit; resets at HH:MM".
Wait until then. The cache means each repo only consumes API quota once
per 7 days.

**Popup says "GitHub Client ID not configured"**: you skipped step 1, or
forgot to rebuild after replacing the placeholder. Run `pnpm build` again
and reload the extension at `chrome://extensions`.

---

## Development

```bash
pnpm dev          # rebuild on file changes
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright E2E (loads dist/ in headed Chromium)
pnpm format       # prettier
```

After changes you usually need to:

1. `pnpm build` (or run `pnpm dev` in another terminal)
2. Go to `chrome://extensions`, click the reload icon on the real-stars
   card
