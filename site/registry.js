// /registry — the StarScout dataset: top-30 wall + searchable table.

const $ = (sel) => document.querySelector(sel);

let DATA = null;

(async () => {
  const resp = await fetch('/data/hall-of-shame.json');
  DATA = await resp.json();

  $('#totalCount').textContent = DATA.totalRepos.toLocaleString();
  $('#totalInTable').textContent = DATA.totalRepos.toLocaleString();

  renderTombstones(DATA.topByShame);
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

// ─────────── SEARCH TABLE ───────────
function pctClass(pct) {
  if (pct >= 30) return '';
  if (pct >= 10) return 'medium';
  return 'low';
}

function tableRowHtml(r) {
  return `
    <tr>
      <td><a href="${ghUrl(r.repo)}" target="_blank" rel="noopener" title="${r.repo}">${r.repo}</a></td>
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
