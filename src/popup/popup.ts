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
      <p class="muted">real-stars analyzes any GitHub repo page you visit. The badge appears next to the star count.</p>
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

  // unauthenticated
  main.innerHTML = `
    <p class="muted">real-stars detects bought stars on GitHub repos. Sign in once with your GitHub account — we only request read access to public repos.</p>
    <button class="primary" id="signin">Sign in with GitHub</button>
  `;
  document.getElementById('signin')!.addEventListener('click', async () => {
    const btn = document.getElementById('signin') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Opening GitHub…';
    try {
      await send('sign-in');
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign in with GitHub';
      const msg = (err as Error).message;
      // Don't alarm on user-cancelled sign-in
      if (!/cancelled/i.test(msg)) alert(msg);
    }
  });
}

render().catch((err) => {
  main.innerHTML = `<p class="muted">Error: ${(err as Error).message}</p>`;
});
