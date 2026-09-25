/* ---------- Config ---------- */

// Apps Script web app URL (the /exec one, without ?page=admin)
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';
const POLL_MS = 5000;

// Avatars: put images in /avatars named after the player in lowercase, e.g. avatars/caleb.png
// Missing images fall back to the player's initial.
const AVATAR_DIR = 'avatars/';
const AVATAR_EXT = '.png';

// Offline testing: add ?mock=round-robin, ?mock=bracket or ?mock=complete to the URL
const MOCK = new URLSearchParams(location.search).get('mock');

/* ---------- Bracket layout ---------- */

// Display order matters: it keeps the connector lines from crossing.
const UPPER_COLS = [
  ['Quarter-finals', ['UQF1', 'UQF2', 'UQF3', 'UQF4']],
  ['Semi-finals', ['USF1', 'USF2']],
  ['Upper final', ['UF']],
];
const LOWER_COLS = [
  ['Lower round 1', ['LR1A', 'LR1B']],
  ['Lower round 2', ['LR2B', 'LR2A']],
  ['Lower round 3', ['LR3']],
  ['Lower final', ['LF']],
];
// Winner-advances lines only; drops from upper to lower aren't drawn.
const FEEDS = [
  ['UQF1', 'USF1'], ['UQF2', 'USF1'], ['UQF3', 'USF2'], ['UQF4', 'USF2'],
  ['USF1', 'UF'], ['USF2', 'UF'],
  ['LR1A', 'LR2B'], ['LR1B', 'LR2A'],
  ['LR2A', 'LR3'], ['LR2B', 'LR3'], ['LR3', 'LF'],
  ['UF', 'GF'], ['LF', 'GF', 'up'], // grand final sits directly above the lower final
];
const PLACEHOLDERS = {
  UQF1: ['Seed 1', 'Seed 8'], UQF2: ['Seed 4', 'Seed 5'],
  UQF3: ['Seed 2', 'Seed 7'], UQF4: ['Seed 3', 'Seed 6'],
};

/* ---------- State ---------- */

let state = null;
let lastJson = '';
let lastPhase = null;
let activeTab = 'seeding';

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Loading ---------- */

async function load() {
  if (document.hidden && state) return;
  try {
    const url = MOCK ? `mock/${MOCK}.json` : API_URL;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    setStatus('Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));

    const { updated, ...rest } = data;
    const json = JSON.stringify(rest);
    if (json === lastJson) return;
    lastJson = json;
    state = data;

    // Open the tab for whatever stage is being played; switch when the stage changes.
    if (data.phase !== lastPhase) {
      activeTab = data.phase === 'round-robin' ? 'seeding' : 'bracket';
      lastPhase = data.phase;
    }
    render();
  } catch (err) {
    setStatus(state ? 'Can\'t reach the results right now, retrying…' : 'Couldn\'t load results: ' + err.message);
  }
}

function setStatus(text) { $('#status').textContent = text; }

/* ---------- Shared bits ---------- */

function pill(name, cls = '', placeholder = '') {
  if (!name) return `<span class="pill empty"><span class="name">${esc(placeholder)}</span></span>`;
  const initial = esc(name.charAt(0).toUpperCase());
  const src = AVATAR_DIR + encodeURIComponent(name.toLowerCase()) + AVATAR_EXT;
  return `<span class="pill ${cls}">
    <span class="name">${esc(name)}</span>
    <span class="avatar" data-initial="${initial}"><img src="${src}" alt="" onerror="this.remove()"></span>
  </span>`;
}

function resultClass(m, player) {
  if (!m.winner) return '';
  return m.winner === player ? 'win' : 'lose';
}

/* ---------- Render ---------- */

function render() {
  if (!state) return;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === activeTab)));
  $('#seeding').hidden = activeTab !== 'seeding';
  $('#bracket').hidden = activeTab !== 'bracket';
  renderSeeding();
  renderBracket();
  if (activeTab === 'bracket') requestAnimationFrame(drawLines);
}

function renderSeeding() {
  const rr = state.roundRobin;
  const finished = state.phase !== 'round-robin';
  const next = rr.filter(m => !m.winner).sort((a, b) => a.num - b.num);
  const done = rr.filter(m => m.winner).sort((a, b) => b.num - a.num);

  const rrMatch = m => `<div class="match ${m.winner ? 'done' : ''}">
    <span class="round">Round ${m.round}</span>
    ${pill(m.p1, resultClass(m, m.p1))}<span class="vs">vs</span>${pill(m.p2, resultClass(m, m.p2))}
  </div>`;

  let html = `<h2>Round robin seeding</h2><div class="seeding-grid">`;
  if (!finished) {
    html += `<div class="col-next"><h3>Next matches</h3>${next.map(rrMatch).join('') || '<p class="empty-msg">No matches left.</p>'}</div>`;
  }
  html += `<div class="col-done"><h3>${finished ? 'Match results' : 'Completed matches'}</h3>${done.map(rrMatch).join('') || '<p class="empty-msg">No results yet.</p>'}</div>`;
  html += `<div class="col-standings"><h3>${finished ? 'Final seeding' : 'Current standings'}</h3>${standingsTable(finished)}</div>`;
  html += `</div>`;

  const panel = $('#seeding');
  panel.classList.toggle('finished', finished);
  panel.innerHTML = html;
}

function standingsTable(finished) {
  let rows = state.standings;
  // Once seeded, follow the seed order from the sheet (it may have been adjusted by hand for ties).
  if (finished && state.seeds.every(Boolean)) {
    rows = state.seeds.map((p, i) => Object.assign({}, state.standings.find(s => s.player === p) || { player: p, wins: 0, losses: 0 }, { rank: i + 1 }));
  }

  const record = player => state.roundRobin
    .filter(m => m.p1 === player || m.p2 === player)
    .sort((a, b) => a.num - b.num)
    .map(m => {
      const opp = m.p1 === player ? m.p2 : m.p1;
      const cls = !m.winner ? '' : m.winner === player ? 'w' : 'l';
      const label = !m.winner ? `vs ${opp}: not played` : `vs ${opp}: ${cls === 'w' ? 'won' : 'lost'}`;
      return `<span class="sq ${cls}" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
    }).join('');

  return `<div class="standings"><table>
    <tr><th></th><th></th><th class="num">Wins</th><th class="num">Losses</th><th>Record</th></tr>
    ${rows.map(r => `<tr>
      <td class="rank">${r.rank}</td>
      <td>${pill(r.player)}</td>
      <td class="num">${r.wins}</td>
      <td class="num">${r.losses}</td>
      <td><div class="record">${record(r.player)}</div></td>
    </tr>`).join('')}
  </table></div>`;
}

function renderBracket() {
  const byId = {};
  state.bracket.forEach(m => { byId[m.key] = m; });

  const bMatch = id => {
    const m = byId[id];
    const ph = PLACEHOLDERS[id] || ['', ''];
    return `<div class="bmatch" data-id="${id}" title="${esc(m.name)}">
      ${pill(m.p1, resultClass(m, m.p1), ph[0])}<span class="vs">vs</span>${pill(m.p2, resultClass(m, m.p2), ph[1])}
    </div>`;
  };

  const column = (title, ids, col, row) => `<div class="round-col" style="grid-column:${col};grid-row:${row}">
    <h3>${title}</h3><div class="slots">${ids.map(bMatch).join('')}</div>
  </div>`;

  let html = `<h2>Bracket</h2><div class="bracket-scroll"><div class="board"><svg></svg>`;
  UPPER_COLS.forEach(([t, ids], i) => { html += column(t, ids, i + 1, 1); });
  LOWER_COLS.forEach(([t, ids], i) => { html += column(t, ids, i + 1, 2); });
  html += `<div class="round-col gf-col"><h3>Grand final</h3><div class="slots"><div>
    ${state.champion ? `<p class="champion">Champion<strong>${esc(state.champion)}</strong></p>` : ''}
    ${bMatch('GF')}
  </div></div></div>`;
  html += `</div></div>`;

  $('#bracket').innerHTML = html;
}

function drawLines() {
  const board = $('#bracket .board');
  if (!board || $('#bracket').hidden) return;
  const svg = board.querySelector('svg');
  const b = board.getBoundingClientRect();
  svg.setAttribute('width', b.width);
  svg.setAttribute('height', b.height);

  svg.innerHTML = FEEDS.map(([from, to, dir]) => {
    const a = board.querySelector(`[data-id="${from}"]`);
    const t = board.querySelector(`[data-id="${to}"]`);
    if (!a || !t) return '';
    const ra = a.getBoundingClientRect();
    const rt = t.getBoundingClientRect();
    if (dir === 'up') {
      const x = ra.left + ra.width / 2 - b.left;
      const top = a.closest('.round-col').getBoundingClientRect().top; // start above the column heading
      return `<path d="M${x} ${top - b.top - 4} V${rt.bottom - b.top + 4}"/>`;
    }
    const x1 = ra.right - b.left + 4;
    const y1 = ra.top + ra.height / 2 - b.top;
    const x2 = rt.left - b.left - 4;
    const y2 = rt.top + rt.height / 2 - b.top;
    const mx = x2 - 24;
    return `<path d="M${x1} ${y1} H${mx} V${y2} H${x2}"/>`;
  }).join('');
}

/* ---------- Events ---------- */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    render();
  });
});

window.addEventListener('resize', () => requestAnimationFrame(drawLines));
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

load();
setInterval(load, POLL_MS);
