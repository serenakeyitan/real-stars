// Hall of Shame — homepage.
// Renders: shame wall (top 30), trending preview (top 6 most-suspect scored
// trending repos, linking to /trending), and the full searchable registry.

const $ = (sel) => document.querySelector(sel);

let DATA = null;
let TRENDING = null;
let SCORED = null;

(async () => {
  const [dataResp, trendingResp, scoredResp] = await Promise.all([
    fetch('/data/hall-of-shame.json'),
    fetch('/data/trending.json').catch(() => null),
    fetch('/data/trending-scored.json').catch(() => null),
  ]);
  DATA = await dataResp.json();
  TRENDING = trendingResp && trendingResp.ok ? await trendingResp.json() : null;
  SCORED = scoredResp && scoredResp.ok ? await scoredResp.json() : null;

  $('#totalCount').textContent = DATA.totalRepos.toLocaleString();
  $('#totalInTable').textContent = DATA.totalRepos.toLocaleString();

  renderTombstones(DATA.topByShame);
  renderTrendingPreview();
  renderTable(DATA.all);
  wireSearch();
  wireSort();
})();

function ghUrl(repo) {
  return `https://github.com/${repo}`;
}

function fmt(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

// ─────────── REPO CARDS (THE WALL) ───────────
function tombstoneHtml(r, i) {
  return `
    <a class="tombstone" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <p class="rank">#${i + 1}</p>
      <p class="repo-name">${r.repo}</p>
      <p class="pct">${r.fakePercent}%</p>
      <p class="pct-label">bought stars</p>
      <div class="breakdown">
        <span><strong>${fmt(r.totalStars)}</strong> stars</span>
        <span><strong>${fmt(r.fakeStars)}</strong> bought</span>
      </div>
    </a>
  `;
}

function renderTombstones(rows) {
  $('#tombstones').innerHTML = rows.map(tombstoneHtml).join('');
}

// ─────────── TRENDING PREVIEW (top 6 most suspect) ───────────
function fmtCompact(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function verdictBucket(score) {
  if (!score || score.insufficientData) return 'insufficient';
  const pct = score.fakePercent;
  if (pct >= 30) return 'high';
  if (pct >= 10) return 'medium';
  if (pct < 5) return 'low';
  return 'mild';
}

// "15.4k real (82%)" framing — matches the Chrome extension badge.
function verdictLabel(bucket, score) {
  if (bucket === 'unscored') return 'scoring…';
  if (bucket === 'insufficient') return 'too small to verdict';
  const real = score.realStars ?? Math.round(score.totalStars * (1 - score.fakePercent / 100));
  const realPct = Math.round(100 - score.fakePercent);
  return `${fmtCompact(real)} real (${realPct}%)`;
}

const ICON_WARN_SMALL = `<svg aria-hidden="true" height="12" viewBox="0 0 16 16" width="12"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>`;
const ICON_CHECK_SMALL = `<svg aria-hidden="true" height="12" viewBox="0 0 16 16" width="12"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;

function previewVerdictIcon(bucket) {
  return bucket === 'low' ? ICON_CHECK_SMALL : ICON_WARN_SMALL;
}

function previewCardHtml(r, score) {
  const bucket = score ? verdictBucket(score) : 'unscored';
  const today = r.todayStars ? `+${fmt(r.todayStars)} today` : '';
  return `
    <a class="trend-card verdict-${bucket}" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <div class="card-head">
        <p class="repo">${r.repo}</p>
        <p class="today">${today}</p>
      </div>
      <span class="verdict-badge verdict-${bucket}">
        ${previewVerdictIcon(bucket)}
        ${verdictLabel(bucket, score)}
      </span>
      <div class="card-foot">
        <span>${r.language ?? ''}</span>
        <span>github.com/trending</span>
      </div>
    </a>
  `;
}

function renderTrendingPreview() {
  const grid = $('#previewGrid');
  if (!grid) return;
  if (!TRENDING) {
    grid.innerHTML = `<p class="meta">Trending data unavailable.</p>`;
    return;
  }

  // Pull daily + weekly + monthly, dedup, attach scores
  const allTrending = [];
  const seen = new Set();
  for (const period of ['daily', 'weekly', 'monthly']) {
    for (const r of TRENDING[period] ?? []) {
      const key = r.repo.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      allTrending.push(r);
    }
  }

  const scored = SCORED?.scores ?? {};
  const enriched = allTrending.map((r) => ({
    ...r,
    score: scored[r.repo.toLowerCase()] ?? null,
  }));

  // Rank: scored with verdicts first (by fakePercent desc), then unscored, then insufficient
  enriched.sort((a, b) => {
    const sa = a.score,
      sb = b.score;
    const pa = sa && !sa.insufficientData ? sa.fakePercent : -1;
    const pb = sb && !sb.insufficientData ? sb.fakePercent : -1;
    return pb - pa;
  });

  const top = enriched.slice(0, 6);
  if (top.length === 0) {
    grid.innerHTML = `<p class="meta">No trending data.</p>`;
    return;
  }
  grid.innerHTML = top.map((r) => previewCardHtml(r, r.score)).join('');
}

// ─────────── SEARCH TABLE ───────────
function pctClass(pct) {
  if (pct >= 30) return '';
  if (pct >= 10) return 'medium';
  return 'low';
}

function tableRowHtml(r) {
  return `
    <tr>
      <td><a href="${ghUrl(r.repo)}" target="_blank" rel="noopener">${r.repo}</a></td>
      <td class="num">${fmt(r.totalStars)}</td>
      <td class="num">${fmt(r.fakeStars)}</td>
      <td class="num pct-cell ${pctClass(r.fakePercent)}">${r.fakePercent}%</td>
      <td class="num">${fmt(r.shameScore)}</td>
    </tr>
  `;
}

function renderTable(rows) {
  const max = 500;
  const visible = rows.slice(0, max);
  $('#tableBody').innerHTML = visible.map(tableRowHtml).join('');
  $('#shownCount').textContent =
    rows.length > max ? `${max} of ${fmt(rows.length)}` : fmt(rows.length);
}

function wireSearch() {
  const input = $('#searchInput');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.toLowerCase().trim();
      const filtered = q ? DATA.all.filter((r) => r.repo.toLowerCase().includes(q)) : DATA.all;
      renderTable(applySort(filtered));
    }, 100);
  });
}

let sortState = { col: 'fakePercent', dir: 'desc' };

function applySort(rows) {
  const { col, dir } = sortState;
  const mul = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (typeof a[col] === 'string') {
      return mul * a[col].localeCompare(b[col]);
    }
    return mul * ((a[col] ?? 0) - (b[col] ?? 0));
  });
}

function wireSort() {
  const ths = document.querySelectorAll('th[data-sort]');
  ths.forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc';
      } else {
        sortState = { col, dir: col === 'repo' ? 'asc' : 'desc' };
      }
      ths.forEach((t) => t.classList.remove('sorted-asc', 'sorted-desc'));
      th.classList.add(sortState.dir === 'desc' ? 'sorted-desc' : 'sorted-asc');
      const q = $('#searchInput').value.toLowerCase().trim();
      const filtered = q ? DATA.all.filter((r) => r.repo.toLowerCase().includes(q)) : DATA.all;
      renderTable(applySort(filtered));
    });
  });
  document.querySelector('th[data-sort="fakePercent"]').classList.add('sorted-desc');
}
