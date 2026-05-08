import type { AuthState } from '@/shared/types';
import {
  GITHUB_CLIENT_ID,
  GITHUB_AUTHORIZE_URL,
  OAUTH_EXCHANGE_URL,
  STORAGE_KEY_AUTH,
} from '@/shared/constants';

/**
 * GitHub OAuth Web Flow for Chrome extensions.
 *
 * The whole flow lives behind one chrome.identity.launchWebAuthFlow call:
 *
 *   1. Build https://github.com/login/oauth/authorize?client_id=…&redirect_uri=…
 *   2. Chrome opens the GitHub authorization page; user clicks "Authorize"
 *   3. GitHub redirects to chrome.identity.getRedirectURL() with ?code=<auth_code>
 *   4. We POST { code } to the Cloudflare Worker, which exchanges with GitHub
 *      using client_secret and returns the access_token
 *   5. Persist the token in chrome.storage.local
 *
 * The user-visible flow is just ONE click ("Authorize") because the user is
 * already signed into github.com in their browser. No copy-pasting codes.
 */

async function getAuth(): Promise<AuthState> {
  const result = (await chrome.storage.local.get(STORAGE_KEY_AUTH)) as Record<string, AuthState>;
  return result[STORAGE_KEY_AUTH] ?? { status: 'unauthenticated' };
}

async function setAuth(state: AuthState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_AUTH]: state });
}

export async function handleGetAuthState(): Promise<AuthState> {
  return getAuth();
}

export async function handleLogout(): Promise<void> {
  await setAuth({ status: 'unauthenticated' });
}

export async function handleSignIn(): Promise<AuthState> {
  // Defensive check for un-replaced placeholders. These would be caught at
  // typecheck once filled in, but the guard helps if someone clones and
  // doesn't read SETUP.md.
  if ((GITHUB_CLIENT_ID as string).startsWith('__REPLACE_')) {
    throw new Error('GitHub Client ID not configured. See SETUP.md to register an OAuth App.');
  }
  if ((OAUTH_EXCHANGE_URL as string).startsWith('__REPLACE_')) {
    throw new Error(
      'OAuth exchange URL not configured. Deploy the worker (see worker/README.md) and update OAUTH_EXCHANGE_URL.',
    );
  }

  const redirectUri = chrome.identity.getRedirectURL();
  // Random state guards against CSRF on the callback
  const state = crypto.randomUUID();

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'public_repo');
  authorizeUrl.searchParams.set('state', state);

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authorizeUrl.toString(), interactive: true },
      (callbackUrl) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!callbackUrl) {
          return reject(new Error('authorization cancelled'));
        }
        resolve(callbackUrl);
      },
    );
  });

  const callback = new URL(responseUrl);
  const returnedState = callback.searchParams.get('state');
  const code = callback.searchParams.get('code');
  const error = callback.searchParams.get('error');

  if (error) throw new Error(`GitHub returned error: ${error}`);
  if (returnedState !== state) throw new Error('state mismatch — possible CSRF');
  if (!code) throw new Error('no code returned from GitHub');

  // Exchange code for token via the Worker
  const exchangeResp = await fetch(OAUTH_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });

  if (!exchangeResp.ok) {
    const errBody = await exchangeResp.text().catch(() => '');
    throw new Error(`token exchange failed: ${exchangeResp.status} ${errBody}`);
  }

  const tokenData = (await exchangeResp.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };

  if (tokenData.error) throw new Error(`exchange error: ${tokenData.error}`);
  if (!tokenData.access_token) throw new Error('no access_token in exchange response');

  // Fetch login for display
  let login: string | undefined;
  try {
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (userResp.ok) {
      const u = (await userResp.json()) as { login: string };
      login = u.login;
    }
  } catch {
    // ignore — login is cosmetic
  }

  const authenticated: AuthState = {
    status: 'authenticated',
    token: tokenData.access_token,
    login,
    scopes:
      typeof tokenData.scope === 'string' ? tokenData.scope.split(',').filter(Boolean) : undefined,
  };
  await setAuth(authenticated);
  return authenticated;
}

export async function getAuthToken(): Promise<string | null> {
  const auth = await getAuth();
  return auth.status === 'authenticated' ? auth.token : null;
}
