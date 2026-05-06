import type { AuthState } from '@/shared/types';

const main = document.getElementById('main') as HTMLElement;

async function send<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response as T);
    });
  });
}

async function render() {
  const auth = await send<AuthState>('get-auth-state');
  main.innerHTML = '';

  if (auth.status === 'authenticated') {
    main.innerHTML = `
      <div class="row"><span>Status</span><span class="success">Connected${auth.login ? ` (@${auth.login})` : ''}</span></div>
      <p class="muted">real-stars will analyze any GitHub repo page you visit. The badge appears next to the star count.</p>
      <button id="logout">Disconnect</button>
      <button id="clear-cache">Clear cache</button>
    `;
    document.getElementById('logout')!.addEventListener('click', async () => {
      await send('logout');
      render();
    });
    document.getElementById('clear-cache')!.addEventListener('click', async () => {
      await send('clear-cache');
      const btn = document.getElementById('clear-cache') as HTMLButtonElement;
      btn.textContent = 'Cleared';
      setTimeout(() => (btn.textContent = 'Clear cache'), 1500);
    });
    return;
  }

  if (auth.status === 'pending') {
    const remainingS = Math.max(0, Math.floor((auth.expiresAt - Date.now()) / 1000));
    main.innerHTML = `
      <p class="muted">Enter this code on GitHub to connect:</p>
      <div class="code-display">${auth.userCode}</div>
      <button class="primary" id="open-verify">Open GitHub authorization page</button>
      <p class="muted">Code expires in ${remainingS}s. We're checking every few seconds — when you authorize, this popup will update automatically.</p>
    `;
    document.getElementById('open-verify')!.addEventListener('click', async () => {
      await navigator.clipboard.writeText(auth.userCode).catch(() => undefined);
      chrome.tabs.create({ url: auth.verificationUri });
    });
    return;
  }

  // unauthenticated
  main.innerHTML = `
    <p class="muted">real-stars analyzes GitHub star history to detect bought stars. We need your GitHub authorization to read public repo data on your behalf (no write access).</p>
    <button class="primary" id="connect">Connect GitHub</button>
  `;
  document.getElementById('connect')!.addEventListener('click', async () => {
    try {
      await send('start-device-flow');
      render();
    } catch (err) {
      alert((err as Error).message);
    }
  });
}

render().catch((err) => {
  main.innerHTML = `<p class="muted">Error: ${(err as Error).message}</p>`;
});

// Re-render every second when in pending state to update countdown
setInterval(() => {
  send<AuthState>('get-auth-state').then((auth) => {
    if (auth.status === 'pending' || auth.status === 'authenticated') {
      // Cheap re-render
      render().catch(() => undefined);
    }
  });
}, 2000);
