/**
 * real-stars OAuth token-exchange worker.
 *
 * The only reason this server exists: GitHub's OAuth Web Flow requires
 * exchanging the authorization code for an access token using a
 * client_secret, and a client_secret can't be safely embedded in a Chrome
 * extension. This worker holds the secret and acts as the exchange proxy.
 *
 * Endpoints:
 *   POST /exchange   body: { code }
 *                    resp: { access_token, scope, token_type } | { error }
 *   GET  /healthz    resp: { ok: true }
 */

interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    if (url.pathname === '/healthz') {
      return json({ ok: true }, 200, corsHeaders(origin, env));
    }

    if (url.pathname === '/exchange' && request.method === 'POST') {
      return handleExchange(request, env, origin);
    }

    return new Response('not found', { status: 404, headers: corsHeaders(origin, env) });
  },
};

async function handleExchange(request: Request, env: Env, origin: string): Promise<Response> {
  if (!isOriginAllowed(origin, env)) {
    return json({ error: 'origin_not_allowed' }, 403, corsHeaders(origin, env));
  }

  let body: { code?: string; redirect_uri?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, corsHeaders(origin, env));
  }

  if (!body.code || typeof body.code !== 'string') {
    return json({ error: 'missing_code' }, 400, corsHeaders(origin, env));
  }

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code: body.code,
  });
  if (body.redirect_uri) params.set('redirect_uri', body.redirect_uri);

  const resp = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!resp.ok) {
    return json({ error: `github_returned_${resp.status}` }, 502, corsHeaders(origin, env));
  }

  const data = (await resp.json()) as Record<string, unknown>;

  if (data.error) {
    return json({ error: String(data.error) }, 400, corsHeaders(origin, env));
  }
  if (!data.access_token) {
    return json({ error: 'no_token_in_response' }, 502, corsHeaders(origin, env));
  }

  // Forward only the safe fields. We deliberately drop refresh_token even if
  // present — public repos don't need it and the extension can re-auth.
  return json(
    {
      access_token: data.access_token,
      scope: data.scope ?? '',
      token_type: data.token_type ?? 'bearer',
    },
    200,
    corsHeaders(origin, env),
  );
}

function isOriginAllowed(origin: string, env: Env): boolean {
  // Default: any chrome-extension origin (devs and the Chrome Web Store
  // version). For a production deployment, set ALLOWED_ORIGINS to your
  // specific extension ID.
  if (!origin) return false;
  const allowlist = (env.ALLOWED_ORIGINS ?? 'chrome-extension://*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const pattern of allowlist) {
    if (pattern === origin) return true;
    if (pattern === 'chrome-extension://*' && origin.startsWith('chrome-extension://')) return true;
    if (pattern.endsWith('*') && origin.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

function corsHeaders(origin: string, env: Env): HeadersInit {
  return {
    'Access-Control-Allow-Origin': isOriginAllowed(origin, env) ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
