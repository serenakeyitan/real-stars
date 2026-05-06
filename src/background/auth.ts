import type { AuthState } from '@/shared/types';
import {
  GITHUB_CLIENT_ID,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_VERIFICATION_URI,
  STORAGE_KEY_AUTH,
  DEVICE_FLOW_POLL_INTERVAL_MS,
} from '@/shared/constants';

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

/**
 * Initiate the GitHub Device Flow.
 *
 * Step 1: POST to /login/device/code → get user_code, device_code, verification_uri
 * Step 2: Show user_code to user, they enter it at github.com/login/device
 * Step 3: Poll /login/oauth/access_token until they authorize (or it expires)
 *
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */
export async function handleStartDeviceFlow(): Promise<AuthState> {
  if (GITHUB_CLIENT_ID === '__REPLACE_WITH_REAL_CLIENT_ID__') {
    throw new Error(
      'GitHub Client ID not configured. See SETUP.md for instructions on registering a GitHub OAuth App.',
    );
  }

  const codeResp = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'public_repo',
    }),
  });

  if (!codeResp.ok) {
    throw new Error(`Device code request failed: ${codeResp.status}`);
  }

  const { device_code, user_code, verification_uri, expires_in, interval } = await codeResp.json();

  const pendingState: AuthState = {
    status: 'pending',
    userCode: user_code,
    verificationUri: verification_uri ?? GITHUB_VERIFICATION_URI,
    expiresAt: Date.now() + (expires_in ?? 900) * 1000,
  };
  await setAuth(pendingState);

  // Start polling in the background. This continues even if popup closes.
  pollDeviceFlow(device_code, (interval ?? 5) * 1000, pendingState.expiresAt).catch((err) =>
    console.error('[real-stars] device flow poll failed:', err),
  );

  return pendingState;
}

async function pollDeviceFlow(
  deviceCode: string,
  intervalMs: number,
  expiresAt: number,
): Promise<void> {
  const pollMs = Math.max(intervalMs, DEVICE_FLOW_POLL_INTERVAL_MS);

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, pollMs));

    // Bail out if user manually disconnected during polling
    const current = await getAuth();
    if (current.status === 'unauthenticated') return;

    const tokenResp = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!tokenResp.ok) {
      console.warn('[real-stars] token poll http error:', tokenResp.status);
      continue;
    }

    const data = await tokenResp.json();

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (data.error === 'expired_token' || data.error === 'access_denied') {
      await setAuth({ status: 'unauthenticated' });
      return;
    }

    if (data.access_token) {
      // Fetch login for display purposes
      let login: string | undefined;
      try {
        const userResp = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${data.access_token}`,
            Accept: 'application/vnd.github+json',
          },
        });
        if (userResp.ok) {
          const u = await userResp.json();
          login = u.login;
        }
      } catch {
        // ignore
      }

      await setAuth({
        status: 'authenticated',
        token: data.access_token,
        login,
        scopes: typeof data.scope === 'string' ? data.scope.split(',').filter(Boolean) : undefined,
      });
      return;
    }
  }

  // Expired without authorization
  await setAuth({ status: 'unauthenticated' });
}

export async function getAuthToken(): Promise<string | null> {
  const auth = await getAuth();
  return auth.status === 'authenticated' ? auth.token : null;
}
