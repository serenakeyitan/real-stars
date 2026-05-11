// /trending — GitHub-trending-style leaderboard, with real-stars verdicts.

const $ = (sel) => document.querySelector(sel);

let TRENDING = null;
let SCORED = null;
let period = 'daily';

(async () => {
  const [tResp, sResp] = await Promise.all([
    fetch('/data/trending.json'),
    fetch('/data/trending-scored.json').catch(() => null),
  ]);
  TRENDING = await tResp.json();
  SCORED = sResp && sResp.ok ? await sResp.json() : { scores: {} };

  $('#scoredAt').textContent = SCORED.scoredAt
    ? `scored ${relative(SCORED.scoredAt)}`
    : 'scoring pending';

  wireTabs();
  render();
})();

function ghUrl(repo) {
  return `https://github.com/${repo}`;
}
function fmt(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}
function relative(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function verdictBucket(score) {
  if (!score) return 'unscored';
  if (score.insufficientData) return 'insufficient';
  const pct = score.fakePercent;
  if (pct >= 30) return 'high';
  if (pct >= 10) return 'medium';
  if (pct < 5) return 'low';
  return 'mild';
}

function verdictLabel(bucket, score) {
  switch (bucket) {
    case 'high':
      return `${score.fakePercent}% bought`;
    case 'medium':
      return `${score.fakePercent}% bought`;
    case 'mild':
      return `${score.fakePercent}% borderline`;
    case 'low':
      return `${score.fakePercent}% looks real`;
    case 'insufficient':
      return 'too small';
    case 'unscored':
    default:
      return 'scoring…';
  }
}

// Inline SVG icons (matched to GitHub's octicons)
const ICON_REPO = `<svg class="repo-icon" aria-hidden="true" height="16" viewBox="0 0 16 16" width="16"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"></path></svg>`;
const ICON_STAR = `<svg aria-hidden="true" height="14" viewBox="0 0 16 16" width="14"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>`;
const ICON_FORK = `<svg aria-hidden="true" height="14" viewBox="0 0 16 16" width="14"><path fill="currentColor" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>`;

function rowHtml(r, i) {
  const score = SCORED?.scores?.[r.repo.toLowerCase()];
  const bucket = verdictBucket(score);
  const [owner, name] = r.repo.split('/');
  const todayLabel =
    period === 'daily' ? 'stars today' : period === 'weekly' ? 'this week' : 'this month';

  const builtBy =
    r.builtBy && r.builtBy.length > 0
      ? `<span class="built-by">
          <span class="built-by-label">Built by</span>
          <span class="avatar-stack">
            ${r.builtBy
              .slice(0, 5)
              .map(
                (b) =>
                  `<img src="${b.avatar}" alt="@${b.login}" loading="lazy" referrerpolicy="no-referrer" />`,
              )
              .join('')}
          </span>
        </span>`
      : '';

  const languageBlock = r.language
    ? `<span class="row-meta-item">
        <span class="language-dot" style="background: ${r.languageColor ?? '#ccc'}"></span>
        ${r.language}
      </span>`
    : '';

  const starsBlock = r.totalStars
    ? `<span class="row-meta-item">${ICON_STAR}${fmt(r.totalStars)}</span>`
    : '';
  const forksBlock = r.forks
    ? `<span class="row-meta-item">${ICON_FORK}${fmt(r.forks)}</span>`
    : '';

  return `
    <a class="trending-row" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <div class="row-rank">${i + 1}</div>
      <div class="row-body">
        <p class="row-title">
          ${ICON_REPO}
          <span class="owner">${owner}</span>
          <span class="slash">/</span>
          <span class="name">${name}</span>
        </p>
        ${r.description ? `<p class="row-description">${escapeHtml(r.description)}</p>` : ''}
        <div class="row-meta">
          ${languageBlock}
          ${starsBlock}
          ${forksBlock}
          ${builtBy}
        </div>
      </div>
      <div class="row-verdict">
        <span class="verdict-badge verdict-${bucket}">
          <span class="verdict-dot"></span>
          ${verdictLabel(bucket, score)}
        </span>
        ${
          r.todayStars
            ? `<span class="row-today">${ICON_STAR}+${fmt(r.todayStars)} ${todayLabel}</span>`
            : ''
        }
      </div>
    </a>
  `;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render() {
  const rows = TRENDING[period] ?? [];
  const listEl = $('#trendingList');
  if (rows.length === 0) {
    listEl.innerHTML = `<p class="snapshot-warning" style="margin:20px">No trending repos this period.</p>`;
    return;
  }
  listEl.innerHTML = rows.map((r, i) => rowHtml(r, i)).join('');

  const total = rows.length;
  const scored = rows.filter((r) => SCORED?.scores?.[r.repo.toLowerCase()]).length;
  const pending = total - scored;
  $('#snapshotWarning').textContent =
    pending > 0
      ? `${scored} of ${total} scored. The remaining ${pending} will be scored on the next refresh (every 6h).`
      : `All ${total} repos scored.`;
}

function wireTabs() {
  const tabs = document.querySelectorAll('#trendingTabs .tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      period = tab.dataset.period;
      render();
    });
  });
}
