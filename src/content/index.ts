// Content script entry. Runs on every github.com page; bails out unless we're
// on a repo home page.

import { injectBadge } from './badge';
import { parseRepoFromUrl } from './route';

let lastKey = '';

async function run() {
  const repo = parseRepoFromUrl(location.href);
  if (!repo) return;
  const key = `${repo.owner}/${repo.name}`;
  if (key === lastKey) return;
  lastKey = key;
  await injectBadge(repo.owner, repo.name);
}

// Initial run
run().catch((err) => console.error('[real-stars] initial run failed:', err));

// GitHub uses Turbo for SPA navigation between repo pages. Listen for the
// Turbo navigation events instead of relying on full page reloads.
document.addEventListener('turbo:render', () => {
  run().catch((err) => console.error('[real-stars] turbo:render run failed:', err));
});

// Fallback: also re-run on history.pushState/replaceState (some pages don't
// fire turbo:render).
const origPushState = history.pushState;
history.pushState = function (...args) {
  origPushState.apply(this, args);
  run().catch((err) => console.error('[real-stars] pushState run failed:', err));
};
window.addEventListener('popstate', () => {
  run().catch((err) => console.error('[real-stars] popstate run failed:', err));
});
