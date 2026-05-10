// GitHub Hall of Shame — vanilla JS, no framework.
// Loads data/hall-of-shame.json and renders three views:
//   1. Top 18 famous offenders (≥5000 stars, by absolute fake count)
//   2. Top 18 by fake-percent (≥1000 stars)
//   3. Full searchable + sortable table of all 13,499

const $ = (sel) => document.querySelector(sel);

let DATA = null;

(async () => {
  const resp = await fetch('/data/hall-of-shame.json');
  DATA = await resp.json();

  $('#totalCount').textContent = DATA.totalRepos.toLocaleString();
  $('#totalInTable').textContent = DATA.totalRepos.toLocaleString();

  renderFamous(DATA.topByStars.slice(0, 18));
  renderPercent(DATA.topByPercent.slice(0, 18));
  renderTable(DATA.all);
  wireSearch();
  wireSort();
})();

function ghUrl(repo) {
  return `https://github.com/${repo}`;
}

function fmt(n) {
  return n.toLocaleString();
}

function riskClass(pct) {
  if (pct >= 30) return 'red';
  if (pct >= 10) return 'yellow';
  return '';
}

function pctClass(pct) {
  if (pct >= 30) return '';
  if (pct >= 10) return 'medium';
  return 'low';
}

function cardHtml(r) {
  const cls = riskClass(r.fakePercent);
  const badges = r.detectedBy.map((d) => `<span class="badge">${d}</span>`).join('');
  return `
    <a class="card ${cls}" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <div class="repo-name">${r.repo}</div>
      <div class="stats">
        <div class="total">${fmt(r.totalStars)} <span>stars</span></div>
        <div class="percent">${r.fakePercent}%</div>
      </div>
      <div class="fake-count">~${fmt(r.fakeStars)} bought stars</div>
      <div class="badges">${badges}</div>
    </a>
  `;
}

function renderFamous(rows) {
  $('#famousGrid').innerHTML = rows.map(cardHtml).join('');
}

function renderPercent(rows) {
  $('#percentGrid').innerHTML = rows.map(cardHtml).join('');
}

function tableRowHtml(r) {
  return `
    <tr>
      <td><a href="${ghUrl(r.repo)}" target="_blank" rel="noopener">${r.repo}</a></td>
      <td class="num">${fmt(r.totalStars)}</td>
      <td class="num">${fmt(r.fakeStars)}</td>
      <td class="num pct-cell ${pctClass(r.fakePercent)}">${r.fakePercent}%</td>
      <td>${r.detectedBy.join(', ')}</td>
    </tr>
  `;
}

function renderTable(rows) {
  const max = 500; // render at most 500 rows for performance
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
    return mul * (a[col] - b[col]);
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
  // Default sort indicator
  document.querySelector('th[data-sort="fakePercent"]').classList.add('sorted-desc');
}
