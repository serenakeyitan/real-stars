// /trending — GitHub Trending with real-stars verdicts.

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
  if (!score || score.insufficientData) return 'insufficient';
  const pct = score.fakePercent;
  if (pct >= 30) return 'high';
  if (pct >= 10) return 'medium';
  if (pct < 5) return 'low';
  return 'mild';
}

function verdictLabel(bucket, score) {
  switch (bucket) {
    case 'high':
      return `${score.fakePercent}% bought · likely fake`;
    case 'medium':
      return `${score.fakePercent}% bought · suspicious`;
    case 'mild':
      return `${score.fakePercent}% bought · borderline`;
    case 'low':
      return `${score.fakePercent}% bought · looks real`;
    case 'insufficient':
      return 'too few stars for verdict';
    case 'unscored':
    default:
      return 'scoring in progress…';
  }
}

function cardHtml(r, period) {
  const score = SCORED?.scores?.[r.repo.toLowerCase()];
  const bucket = score ? verdictBucket(score) : 'unscored';

  const todayLabel = period === 'daily' ? 'today' : period === 'weekly' ? 'this week' : 'this month';
  const todayStr = r.todayStars ? `+${fmt(r.todayStars)} ${todayLabel}` : '';
  const lang = r.language ? r.language : '';

  let bottom = '';
  if (score && !score.insufficientData) {
    const sample = score.sampleSize ?? 0;
    const bursts = score.bursts ?? 0;
    bottom = `
      <div class="card-stats">
        <span>${fmt(score.totalStars)} stars</span>
        <span>${fmt(score.suspiciousStars)} suspect</span>
        <span>${sample}-sample · ${bursts} burst${bursts === 1 ? '' : 's'}</span>
      </div>
    `;
  } else if (score?.insufficientData) {
    bottom = `<div class="card-stats"><span>${fmt(score.totalStars)} stars</span><span>—</span><span>below verdict threshold</span></div>`;
  } else {
    bottom = `<div class="card-stats"><span>—</span><span>—</span><span>not yet scored</span></div>`;
  }

  return `
    <a class="trend-card verdict-${bucket}" href="${ghUrl(r.repo)}" target="_blank" rel="noopener">
      <div class="card-head">
        <p class="repo">${r.repo}</p>
        <p class="today">${todayStr}</p>
      </div>
      <div class="verdict-row">
        <span class="verdict-dot"></span>
        <span class="verdict-text">${verdictLabel(bucket, score)}</span>
      </div>
      ${bottom}
      <div class="card-foot">
        <span>${lang}</span>
        <span>github.com/trending</span>
      </div>
    </a>
  `;
}

function render() {
  const rows = TRENDING[period] ?? [];
  $('#trendingGrid').innerHTML = rows.length
    ? rows.map((r) => cardHtml(r, period)).join('')
    : `<p class="snapshot-warning">No trending repos this period.</p>`;

  const noteEl = $('#periodNote');
  const periodCopy = {
    daily: "Today's",
    weekly: "This week's",
    monthly: "This month's",
  }[period];
  noteEl.innerHTML = `${periodCopy} top trending repos from <a href="https://github.com/trending?since=${period}" target="_blank" rel="noopener">github.com/trending</a>, ranked as GitHub ranks them.`;

  // Show how many are scored vs pending
  const total = rows.length;
  const scored = rows.filter((r) => SCORED?.scores?.[r.repo.toLowerCase()]).length;
  const pending = total - scored;
  $('#snapshotWarning').textContent =
    pending > 0
      ? `${scored} of ${total} scored. The remaining ${pending} will be scored on the next refresh cycle (every 6h).`
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
