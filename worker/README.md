# real-stars OAuth worker

Cloudflare Worker that exchanges a GitHub OAuth code for an access token.
This is the only piece of server-side infrastructure real-stars needs —
the rest of the extension runs entirely client-side.

## Why this exists

GitHub's OAuth Web Flow requires `client_secret` to exchange the
authorization code for a token. A `client_secret` can't be embedded in a
Chrome extension (anyone can unpack a `.crx` and read it). This worker
holds the secret and proxies the exchange.

## Endpoints

- `POST /exchange` — body `{ code: string }`, returns `{ access_token, scope, token_type }`
- `GET /healthz` — returns `{ ok: true }`

## Deploy

```bash
pnpm install
pnpm wrangler login
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
pnpm deploy
```

The worker URL ends up at `https://real-stars-oauth.<your-subdomain>.workers.dev`.
Copy that URL into [`../src/shared/constants.ts`](../src/shared/constants.ts)
as `OAUTH_EXCHANGE_URL`.

## Tighten CORS (optional, after publishing the extension)

By default any `chrome-extension://*` origin can call `/exchange`. Once
you have the real Chrome Web Store extension ID, lock it down:

```bash
pnpm wrangler secret put ALLOWED_ORIGINS
# value: chrome-extension://your-real-extension-id
```

## Cost

Cloudflare Workers free tier: **100,000 requests/day**. The worker is
hit once per user per session (login), so this comfortably supports
thousands of users at $0/month.
