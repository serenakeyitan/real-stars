import type { AnalysisResult } from '@/shared/types';

const BADGE_ID = 'real-stars-badge';

export async function injectBadge(owner: string, repo: string): Promise<void> {
  // Remove any stale badge from a previous turbo navigation
  document.getElementById(BADGE_ID)?.remove();

  const anchor = findAnchor();
  if (!anchor) {
    // GitHub UI changed or we're on a page variant we don't recognize
    return;
  }

  const badge = renderBadge('loading');
  anchor.appendChild(badge);

  let response: AnalysisResult | { error: string } | undefined;
  try {
    response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'analyze-repo', payload: { owner, repo } }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(res);
      });
    });
  } catch (err) {
    badge.replaceWith(renderBadge('error', { message: (err as Error).message }));
    return;
  }

  if (!response) {
    badge.replaceWith(renderBadge('error', { message: 'no response from background' }));
    return;
  }

  if ('error' in response) {
    if (response.error === 'unauthenticated') {
      const signInBadge = renderBadge('unauthenticated');
      signInBadge.addEventListener('click', () => {
        void (async () => {
          signInBadge.textContent = '⏳ opening GitHub…';
          try {
            await new Promise<void>((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'sign-in' }, (res) => {
                if (chrome.runtime.lastError)
                  return reject(new Error(chrome.runtime.lastError.message));
                if (res?.error) return reject(new Error(res.error));
                resolve();
              });
            });
            // After sign-in, restart analysis
            await injectBadge(owner, repo);
          } catch (err) {
            signInBadge.replaceWith(renderBadge('error', { message: (err as Error).message }));
          }
        })();
      });
      badge.replaceWith(signInBadge);
    } else {
      badge.replaceWith(renderBadge('error', { message: response.error }));
    }
    return;
  }

  if (response.insufficientData) {
    badge.replaceWith(renderBadge('insufficient-data', { result: response }));
    return;
  }

  badge.replaceWith(renderBadge('result', { result: response }));
}

/**
 * Find the DOM node we'll inject our badge into. GitHub's repo header has
 * shifted around over the years; we try the modern selector first then fall
 * back to older variants.
 */
function findAnchor(): HTMLElement | null {
  // Modern GitHub (2024+): the star button lives in a flex row at the top right
  const starButton =
    document.querySelector<HTMLElement>('button[data-ga-click*="star button"]') ||
    document.querySelector<HTMLElement>('form[action*="/star"] button') ||
    document.querySelector<HTMLElement>('[aria-label*="star this repository" i]') ||
    document.querySelector<HTMLElement>('[aria-label*="unstar this repository" i]');

  if (starButton) {
    // Walk up to the closest flex container so our badge sits inline
    const container = starButton.closest(
      'ul, .pagehead-actions, .gh-header-actions, .Box-header, .d-flex',
    );
    if (container instanceof HTMLElement) {
      // Wrap in <li> if container is a <ul>
      if (container.tagName === 'UL') {
        const li = document.createElement('li');
        li.style.display = 'inline-flex';
        li.style.marginLeft = '8px';
        container.appendChild(li);
        return li;
      }
      const wrapper = document.createElement('span');
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.marginLeft = '8px';
      container.appendChild(wrapper);
      return wrapper;
    }
  }

  return null;
}

function renderBadge(
  state: 'loading' | 'unauthenticated' | 'error' | 'insufficient-data' | 'result',
  payload?: { message?: string; result?: AnalysisResult },
): HTMLElement {
  const el = document.createElement('span');
  el.id = BADGE_ID;
  el.style.cssText = badgeStyle();

  if (state === 'loading') {
    el.textContent = '⏳ analyzing…';
    el.title = 'real-stars is analyzing this repo';
    return el;
  }

  if (state === 'unauthenticated') {
    el.textContent = '🔒 sign in with GitHub';
    el.style.cursor = 'pointer';
    el.title = 'Click to authorize real-stars (one-time, takes 2 seconds)';
    return el;
  }

  if (state === 'error') {
    el.textContent = '⚠ analysis failed';
    el.title = `real-stars: ${payload?.message ?? 'unknown error'}`;
    return el;
  }

  if (state === 'insufficient-data') {
    const r = payload!.result!;
    el.textContent = '— not enough data';
    el.style.color = '#656d76';
    el.style.borderColor = '#d0d7de';
    el.title = r.warning ?? 'real-stars needs at least 1,000 stars to give a confident verdict.';
    return el;
  }

  // result
  const r = payload!.result!;
  const colorMap: Record<'low' | 'medium' | 'high', string> = {
    low: '#1a7f37',
    medium: '#9a6700',
    high: '#cf222e',
  };
  const color = colorMap[r.riskLevel];
  el.style.borderColor = color;
  el.style.color = color;

  const realFmt = formatStars(r.realStars);
  const pct = Math.round(100 - r.fakePercent);
  el.textContent = `${riskIcon(r.riskLevel)} ${realFmt} real (${pct}%)`;
  el.title = buildTooltip(r);
  return el;
}

function badgeStyle(): string {
  return [
    'display: inline-flex',
    'align-items: center',
    'gap: 4px',
    'padding: 3px 8px',
    'border: 1px solid currentColor',
    'border-radius: 6px',
    'font-size: 12px',
    'font-weight: 500',
    'line-height: 20px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'white-space: nowrap',
  ].join(';');
}

function riskIcon(risk: 'low' | 'medium' | 'high'): string {
  return risk === 'low' ? '✓' : risk === 'medium' ? '⚠' : '🚨';
}

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function buildTooltip(r: AnalysisResult): string {
  const lines = [
    `real-stars analysis for ${r.owner}/${r.repo}`,
    `Analyzed ${r.analyzedStars.toLocaleString()} most recent stargazers`,
    `Detected ${r.bursts.length} suspicious burst(s)`,
    `Estimated suspicious: ${r.suspiciousStars.toLocaleString()} (${r.fakePercent.toFixed(1)}%)`,
    `Risk level: ${r.riskLevel}`,
  ];
  if (r.warning) lines.push('', r.warning);
  return lines.join('\n');
}
