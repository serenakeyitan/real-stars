import type { AuthState } from '@/shared/types';
import {
  GITHUB_CLIENT_ID,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_VERIFICATION_URI,
  STORAGE_KEY_AUTH,
  DEVICE_FLOW_POLL_INTERVAL_MS,
} from '@/shared/constants';

const DEVICE_FLOW_ALARM = 'real-stars:device-flow-poll';
const DEVICE_FLOW_STATE_KEY = 'real-stars:device-flow-state';

interface DeviceFlowPersistedState {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}

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
  await stopDeviceFlowAlarm();
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

  // Persist polling state and schedule a chrome.alarms-based poll. Using
  // setTimeout in a service worker is unreliable — SWs are evicted after ~30s
  // of idleness, which kills setTimeout chains. Alarms wake the SW back up.
  const intervalMs = Math.max((interval ?? 5) * 1000, DEVICE_FLOW_POLL_INTERVAL_MS);
  const persisted: DeviceFlowPersistedState = {
    deviceCode: device_code,
    intervalMs,
    expiresAt: pendingState.expiresAt,
  };
  await chrome.storage.local.set({ [DEVICE_FLOW_STATE_KEY]: persisted });
  await startDeviceFlowAlarm(intervalMs);

  return pendingState;
}

async function startDeviceFlowAlarm(intervalMs: number): Promise<void> {
  // chrome.alarms minimum period is 30s in production, but periodInMinutes
  // can be sub-1 in unpacked dev mode. Use delayInMinutes for a single tick
  // and re-arm after each poll to honor the upstream interval.
  await chrome.alarms.clear(DEVICE_FLOW_ALARM);
  await chrome.alarms.create(DEVICE_FLOW_ALARM, { delayInMinutes: intervalMs / 60000 });
}

async function stopDeviceFlowAlarm(): Promise<void> {
  await chrome.alarms.clear(DEVICE_FLOW_ALARM);
  await chrome.storage.local.remove(DEVICE_FLOW_STATE_KEY);
}

/**
 * Called by the chrome.alarms listener (registered in background/index.ts).
 * Polls GitHub for the access token and either resolves the auth, retries,
 * or gives up.
 */
export async function tickDeviceFlow(): Promise<void> {
  const state = await chrome.storage.local.get(DEVICE_FLOW_STATE_KEY);
  const persisted: DeviceFlowPersistedState | undefined = state[DEVICE_FLOW_STATE_KEY];
  if (!persisted) return;

  if (Date.now() >= persisted.expiresAt) {
    await setAuth({ status: 'unauthenticated' });
    await stopDeviceFlowAlarm();
    return;
  }

  // Bail out if user manually disconnected
  const current = await getAuth();
  if (current.status === 'unauthenticated') {
    await stopDeviceFlowAlarm();
    return;
  }

  let nextDelayMs = persisted.intervalMs;
  try {
    const tokenResp = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: persisted.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (tokenResp.ok) {
      const data = await tokenResp.json();

      if (data.error === 'slow_down') {
        nextDelayMs = persisted.intervalMs + 5000;
      } else if (data.error === 'expired_token' || data.error === 'access_denied') {
        await setAuth({ status: 'unauthenticated' });
        await stopDeviceFlowAlarm();
        return;
      } else if (data.access_token) {
        await finalizeAuth(data.access_token, data.scope);
        await stopDeviceFlowAlarm();
        return;
      }
      // 'authorization_pending' → just keep going
    } else {
      console.warn('[real-stars] token poll http error:', tokenResp.status);
    }
  } catch (err) {
    console.warn('[real-stars] token poll failed:', err);
  }

  // Re-arm
  await chrome.alarms.create(DEVICE_FLOW_ALARM, { delayInMinutes: nextDelayMs / 60000 });
}

async function finalizeAuth(token: string, scopeField?: string): Promise<void> {
  let login: string | undefined;
  try {
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (userResp.ok) {
      const u = await userResp.json();
      login = u.login;
    }
  } catch {
    // ignore — login is cosmetic
  }

  await setAuth({
    status: 'authenticated',
    token,
    login,
    scopes: typeof scopeField === 'string' ? scopeField.split(',').filter(Boolean) : undefined,
  });
}

export const DEVICE_FLOW_ALARM_NAME = DEVICE_FLOW_ALARM;

export async function getAuthToken(): Promise<string | null> {
  const auth = await getAuth();
  return auth.status === 'authenticated' ? auth.token : null;
}
