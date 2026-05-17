// Content script entry. Runs on every github.com page; bails out unless we're
// on a repo home page.

import { injectBadge } from './badge';
import { parseRepoFromUrl } from './route';

async function run() {
  const repo = parseRepoFromUrl(location.href);
  if (!repo) return;
  // injectBadge handles its own dedup (removes any existing badge first), so
  // it's safe to call on every navigation event. We deliberately don't gate
  // on "same repo as last time" — Turbo replaces the DOM on every navigation
  // including same-repo sub-pages back to the home, which would orphan the
  // badge if we skipped re-injection.
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
const origPushState = history.pushState.bind(history);
history.pushState = function (...args: Parameters<typeof history.pushState>) {
  origPushState(...args);
  run().catch((err) => console.error('[real-stars] pushState run failed:', err));
};
window.addEventListener('popstate', () => {
  run().catch((err) => console.error('[real-stars] popstate run failed:', err));
});
