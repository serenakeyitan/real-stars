// Hall of Shame v2 — tombstone wall + live trending cross-check.
// Vanilla JS, no framework. Loads two JSON files (dataset + trending snapshot).

const $ = (sel) => document.querySelector(sel);

let DATA = null;
let TRENDING = null;
let trendingPeriod = 'daily';

(async () => {
  const [dataResp, trendingResp] = await Promise.all([
    fetch('/data/hall-of-shame.json'),
    fetch('/data/trending.json').catch(() => null),
  ]);
  DATA = await dataResp.json();
  TRENDING = trendingResp && trendingResp.ok ? await trendingResp.json() : null;

  $('#totalCount').textContent = DATA.totalRepos.toLocaleString();
  $('#totalInTable').textContent = DATA.totalRepos.toLocaleString();

  renderTombstones(DATA.topByShame);
  renderTrending();
  wireTrendingTabs();
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

// ─────────── TOMBSTONES (THE WALL) ───────────
function tombstoneHtml(r, i) {
  const tier = i < 3 ? 'tier-1' : '';
  return `
    <a class="tombstone ${tier}" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <span class="rank">#${i + 1}</span>
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

// ─────────── TRENDING CERTIFICATES ───────────
function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function certHtml(r, period) {
  const todayLabel = period === 'daily' ? 'today' : 'this week';
  const todayStr = r.todayStars ? `+${fmt(r.todayStars)} ${todayLabel}` : '';
  const lang = r.language ? `<span>${r.language}</span>` : '<span>—</span>';

  let stamp;
  if (r.inDataset) {
    stamp = `
      <div class="cert-stamp shame">
        <span class="stamp-icon">🚨</span>
        <span class="stamp-text">
          <strong>Certified shame</strong>
          ${r.fakePercent}% bought · ${fmt(r.fakeStars)} fake of ${fmt(r.totalStars)}
        </span>
      </div>
    `;
  } else {
    stamp = `
      <div class="cert-stamp clean">
        <span class="stamp-icon">○</span>
        <span class="stamp-text">
          <strong>No record</strong>
          Not flagged in the 2025-01-01 snapshot
        </span>
      </div>
    `;
  }

  return `
    <a class="cert" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <div class="cert-head">
        <p class="repo">${r.repo}</p>
        <p class="today">${todayStr}</p>
      </div>
      ${stamp}
      <div class="cert-meta">
        ${lang}
        <span>github.com/trending</span>
      </div>
    </a>
  `;
}

function renderTrending() {
  const grid = $('#trendingGrid');
  if (!TRENDING) {
    grid.innerHTML = `<p class="snapshot-warning">Trending data unavailable.</p>`;
    return;
  }
  const rows = TRENDING[trendingPeriod] || [];
  if (rows.length === 0) {
    grid.innerHTML = `<p class="snapshot-warning">No trending repos this period.</p>`;
    return;
  }
  grid.innerHTML = rows.map((r) => certHtml(r, trendingPeriod)).join('');
}

function wireTrendingTabs() {
  const tabs = document.querySelectorAll('#trendingTabs .tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      trendingPeriod = tab.dataset.period;
      renderTrending();
    });
  });
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
