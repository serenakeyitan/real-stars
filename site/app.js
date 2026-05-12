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

  const fresh = $('#leaderboardFreshness');
  if (fresh) {
    fresh.textContent = SCORED.scoredAt
      ? `Last refreshed ${relative(SCORED.scoredAt)}`
      : '';
  }

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
// Compact short-form: 15476 → "15.4k", 184500 → "184k", 1_200_000 → "1.2M"
// Matches the Chrome extension badge formatting.
function fmtCompact(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
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
  // Thresholds tightened 2026-05-11 (was 30/10/5) — most trending repos
  // cluster between 5–20% bought, so the 30% red threshold was empty in
  // practice. 20% is the new "suspicious" line.
  if (pct >= 20) return 'high';
  if (pct >= 10) return 'medium';
  if (pct < 5) return 'low';
  return 'mild';
}

// Extension-style framing: tell users how many stars are REAL, not how many
// are fake. "15.4k real (82%)" is the dashboard counterpart to the extension's
// yellow-bordered badge.
function verdictLabel(bucket, score) {
  if (bucket === 'unscored') return 'scoring…';
  if (bucket === 'insufficient') return 'too small to verdict';
  const real = score.realStars ?? Math.round(score.totalStars * (1 - score.fakePercent / 100));
  const realPct = Math.round(100 - score.fakePercent);
  return `${fmtCompact(real)} real (${realPct}%)`;
}

// Inline SVG icons (matched to GitHub's octicons)
const ICON_REPO = `<svg class="repo-icon" aria-hidden="true" height="16" viewBox="0 0 16 16" width="16"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"></path></svg>`;
const ICON_WARN = `<svg class="verdict-icon" aria-hidden="true" height="14" viewBox="0 0 16 16" width="14"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>`;
const ICON_CHECK = `<svg class="verdict-icon" aria-hidden="true" height="14" viewBox="0 0 16 16" width="14"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
const ICON_HOURGLASS = `<svg class="verdict-icon" aria-hidden="true" height="14" viewBox="0 0 16 16" width="14"><path fill="currentColor" d="M2.5 2A0.5 0.5 0 0 1 3 1.5h10a.5.5 0 0 1 0 1H12V4a4 4 0 0 1-2.667 3.771V8.23A4 4 0 0 1 12 12v1.5h1a.5.5 0 0 1 0 1H3a.5.5 0 0 1 0-1h1V12a4 4 0 0 1 2.667-3.771V7.77A4 4 0 0 1 4 4V2.5H3A.5.5 0 0 1 2.5 2Z"></path></svg>`;

function verdictIcon(bucket) {
  switch (bucket) {
    case 'high':
    case 'medium':
      return ICON_WARN;
    case 'mild':
      return ICON_WARN;
    case 'low':
      return ICON_CHECK;
    case 'insufficient':
    case 'unscored':
    default:
      return ICON_HOURGLASS;
  }
}
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
          ${verdictIcon(bucket)}
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
  // Show only repos that have a verdict. Repos without scores don't appear
  // until the next cron run picks them up — the user always sees clean data,
  // never "scoring…" placeholders. Freshness is communicated by the single
  // "scored Xh ago" timestamp at the top of the page.
  const allRows = TRENDING[period] ?? [];
  const rows = allRows.filter((r) => SCORED?.scores?.[r.repo.toLowerCase()]);
  const listEl = $('#trendingList');
  if (rows.length === 0) {
    listEl.innerHTML = `<p class="snapshot-warning" style="margin:20px">No verdicts available for this period yet. Check back in a few hours.</p>`;
    $('#snapshotWarning').textContent = '';
    return;
  }
  listEl.innerHTML = rows.map((r, i) => rowHtml(r, i)).join('');

  // Show a quiet count so the page doesn't feel arbitrary.
  $('#snapshotWarning').textContent =
    `${rows.length} repositories shown · this list updates every six hours.`;
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
