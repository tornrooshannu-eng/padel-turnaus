'use strict';
/* Padel-turnaus: Americano & Mexicano.
   - Nykyinen turnaus: localStorage 'padel-turnaus-v1'
   - Tietokanta (tallennetut pelaajat, listat, turnaushistoria): localStorage 'padel-db-v1' */

const STORAGE_KEY = 'padel-turnaus-v1';
const DB_KEY = 'padel-db-v1';
const POINT_PRESETS = [16, 21, 24, 32];

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaultState = () => ({
  phase: 'setup',            // 'setup' | 'play'
  format: 'americano',       // 'americano' | 'mexicano'
  points: 24,
  players: [],               // [{id, name}]
  rounds: [],                // [{matches:[{court,a:[id,id],b:[id,id],sa,sb}], byes:[id]}]
  nextId: 1,
  roundsTarget: null,        // asetetaan turnauksen alussa automaattisesti
  baseTarget: null,
  tid: null,                 // historiamerkinnän tunniste
  startedAt: null,
  view: 'matches',           // 'matches' | 'table'
  shownRound: 0,
  page: 'tournament',        // 'tournament' | 'history'
  historyOpen: null,
  seriesId: null,            // valittu vakioturnaus
  statsOpen: null,           // avoinna oleva tilastosivu
  statsBack: 'tournament',
  playerOpen: null,          // pelaajakortti
  playerFilter: null,
  playerBack: 'players',
  seasonYear: null,          // kauden pistepörssin vuosi
  seed: 'random',            // Mexicanon 1. kierros: random | rating
  schedule: null,            // Americano: koko ohjelma etukäteen
});
const defaultDb = () => ({ players: [], lists: [], history: [], series: [] });

let state = load();
let db = loadDb();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* ei tallennusta */ }
  return defaultState();
}
function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = Object.assign(defaultDb(), JSON.parse(raw));
      if (Array.isArray(d.players) && Array.isArray(d.lists) && Array.isArray(d.history)) return d;
    }
  } catch (e) { /* ei tallennusta */ }
  return defaultDb();
}
function migrate() {
  delete state.courts;
  state.players.forEach(p => rememberPlayer(p.name));
  if (state.phase === 'play' && !state.tid) { state.tid = newId(); state.startedAt = new Date().toISOString(); }
  save();
}
function saveDb() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* ei tallennusta */ }
  if (window.PadelCloud) window.PadelCloud.notifyLocalChange();
}
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ei tallennusta */ }
  syncHistory();
}

/* Tulokset tallentuvat historiaan automaattisesti jokaisen muutoksen yhteydessä. */
function syncHistory() {
  if (state.phase === 'play' && state.tid && state.rounds.length) {
    const entry = {
      id: state.tid,
      date: state.startedAt,
      format: state.format,
      points: state.points,
      courts: activeCourts(),
      roundsTarget: state.roundsTarget,
      baseTarget: state.baseTarget,
      schedule: state.schedule || null,
      players: state.players.map(p => ({ id: p.id, name: p.name })),
      rounds: state.rounds.map(r => ({ matches: r.matches.map(m => ({ court: m.court, a: m.a, b: m.b, sa: m.sa, sb: m.sb })), byes: r.byes })),
      finished: finished(),
      seriesId: state.seriesId || null,
    };
    const i = db.history.findIndex(h => h.id === state.tid);
    const old = i >= 0 ? db.history[i] : null;
    // aikaleima vaihtuu vain, kun sisältö oikeasti muuttuu (ei turhia pilvikirjoituksia)
    const strip = h => { const { updated, ...rest } = h; return stable(rest); };
    if (old && strip(old) === strip(entry)) { saveDb(); return; }
    entry.updated = new Date().toISOString();
    if (i >= 0) db.history[i] = entry; else db.history.unshift(entry);
  }
  saveDb();
}

/* ---------- apufunktiot ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => a.toLocaleLowerCase('fi') === b.toLocaleLowerCase('fi');
const byName = (a, b) => a.localeCompare(b, 'fi');
const nameIn = (players, id) => (players.find(p => p.id === id) || { name: '?' }).name;
const nameOf = id => nameIn(state.players, id);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }) +
    ' klo ' + d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
}
function rememberPlayer(name) {
  if (!db.players.some(n => same(n, name))) db.players.push(name);
}

/* Kentät: 4 pelaajaa per kenttä. Kierrokset: niin monta, että jokainen ehtii pelata
   jokaisen kanssa parina (parien määrä / pareja per kierros, pyöristettynä ylös). */
const courtsFor = n => Math.floor(n / 4);
function roundsFor(n) {
  const c = courtsFor(n);
  return c ? Math.ceil((n * (n - 1) / 2) / (2 * c)) : 0;
}
const activeCourts = () => courtsFor(state.players.length);

function isScored(m, pts = state.points) {
  return Number.isInteger(m.sa) && Number.isInteger(m.sb) && m.sa >= 0 && m.sb >= 0 && m.sa + m.sb === pts;
}
const roundComplete = (r, pts = state.points) => r.matches.every(m => isScored(m, pts));
const finished = () => state.rounds.length >= state.roundsTarget && state.rounds.every(r => roundComplete(r));

/* ---------- sarjataulukko ---------- */
function computeStandings(players, rounds, pts) {
  const s = new Map();
  for (const p of players) s.set(p.id, { id: p.id, name: p.name, pts: 0, against: 0, played: 0, w: 0, d: 0, l: 0, byes: 0 });
  for (const r of rounds) {
    for (const id of r.byes) if (s.has(id)) s.get(id).byes++;
    for (const m of r.matches) {
      if (!isScored(m, pts)) continue;
      const add = (ids, own, opp) => ids.forEach(id => {
        const x = s.get(id); if (!x) return;
        x.pts += own; x.against += opp; x.played++;
        if (own > opp) x.w++; else if (own < opp) x.l++; else x.d++;
      });
      add(m.a, m.sa, m.sb);
      add(m.b, m.sb, m.sa);
    }
  }
  return [...s.values()].sort((x, y) =>
    y.pts - x.pts || y.w - x.w || (y.pts - y.against) - (x.pts - x.against) || byName(x.name, y.name));
}
const standings = () => computeStandings(state.players, state.rounds, state.points);

/* ---------- taukojen valinta ---------- */
function pickByes(count, order, rounds = state.rounds) {
  // order = pelaajat etusijajärjestyksessä (tasatilanteessa). Tauolle ne, joilla vähiten taukoja.
  if (count <= 0) return [];
  const byeCount = new Map(state.players.map(p => [p.id, 0]));
  const lastBye = new Map();
  rounds.forEach((r, i) => r.byes.forEach(id => { byeCount.set(id, (byeCount.get(id) || 0) + 1); lastBye.set(id, i); }));
  const idx = new Map(order.map((id, i) => [id, i]));
  const sorted = [...order].sort((a, b) =>
    byeCount.get(a) - byeCount.get(b) ||
    (lastBye.has(a) ? lastBye.get(a) : -1) - (lastBye.has(b) ? lastBye.get(b) : -1) ||
    idx.get(a) - idx.get(b));
  return sorted.slice(0, count);
}

/* ---------- Americano: mahdollisimman tasainen kumppani/vastustajajako ---------- */
function pairCounts(rounds = state.rounds) {
  const partner = new Map(), opp = new Map();
  const k = (a, b) => a < b ? a + '-' + b : b + '-' + a;
  const inc = (map, a, b) => map.set(k(a, b), (map.get(k(a, b)) || 0) + 1);
  for (const r of rounds) for (const m of r.matches) {
    inc(partner, m.a[0], m.a[1]); inc(partner, m.b[0], m.b[1]);
    for (const x of m.a) for (const y of m.b) inc(opp, x, y);
  }
  return { partner, opp, k };
}

function americanoRound(rounds = state.rounds, restarts = 60) {
  const courts = activeCourts();
  const ids = state.players.map(p => p.id);
  const { partner, opp, k } = pairCounts(rounds);
  const pc = (a, b) => partner.get(k(a, b)) || 0;
  const oc = (a, b) => opp.get(k(a, b)) || 0;
  // Tauolle: vähiten taukoja; tasatilanteessa mieluiten ne, joilla on vähiten uusia pareja jäljellä
  const unmet = id => ids.filter(o => o !== id && pc(id, o) === 0).length;
  const byes = pickByes(ids.length - courts * 4, shuffle([...ids]).sort((a, b) => unmet(a) - unmet(b)), rounds);
  const active = ids.filter(id => !byes.includes(id));
  // järjestys: [a0,a1,b0,b1, a0,a1,b0,b1, ...]
  const cost = arr => {
    let c = 0;
    for (let i = 0; i < arr.length; i += 4) {
      const [a0, a1, b0, b1] = arr.slice(i, i + 4);
      const p1 = pc(a0, a1), p2 = pc(b0, b1);
      c += 1000 * (p1 * p1 + p2 * p2);
      for (const x of [a0, a1]) for (const y of [b0, b1]) { const o = oc(x, y); c += 10 * o * o; }
    }
    return c;
  };
  let best = null, bestCost = Infinity;
  for (let t = 0; t < restarts && bestCost > 0; t++) {
    const arr = shuffle([...active]);
    let c = cost(arr), improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        if ((i >> 2) === (j >> 2) && ((i & 2) === (j & 2))) continue; // sama joukkue: ei muutosta
        [arr[i], arr[j]] = [arr[j], arr[i]];
        const nc = cost(arr);
        if (nc < c) { c = nc; improved = true; } else { [arr[i], arr[j]] = [arr[j], arr[i]]; }
      }
    }
    if (c < bestCost) { bestCost = c; best = [...arr]; }
  }
  const matches = [];
  for (let i = 0; i < courts; i++) {
    const g = best.slice(i * 4, i * 4 + 4);
    matches.push({ court: i + 1, a: [g[0], g[1]], b: [g[2], g[3]], sa: null, sb: null });
  }
  return { matches, byes };
}

/* Koko Americano-ohjelma etukäteen: useita yrityksiä, paras talteen.
   Tavoite: jokainen pelaa jokaisen kanssa parina, tauot tasan, vastustajat tasaisesti. */
function americanoSchedule(R, budgetMs = 1500) {
  const n = state.players.length, allPairs = n * (n - 1) / 2;
  const t0 = performance.now();
  let best = null, bestScore = -Infinity;
  for (let attempt = 0; attempt === 0 || performance.now() - t0 < budgetMs; attempt++) {
    const rounds = [];
    for (let r = 0; r < R; r++) rounds.push(americanoRound(rounds, 12));
    const { partner, opp } = pairCounts(rounds);
    const b = new Map(state.players.map(p => [p.id, 0]));
    rounds.forEach(r => r.byes.forEach(id => b.set(id, b.get(id) + 1)));
    const byeSpread = Math.max(...b.values()) - Math.min(...b.values());
    const oppMax = Math.max(0, ...opp.values());
    const score = partner.size * 1000 - byeSpread * 100 - oppMax;
    if (score > bestScore) { bestScore = score; best = rounds; }
    if (partner.size === Math.min(allPairs, R * activeCourts() * 2) && byeSpread <= 1 && oppMax <= 2) break;
  }
  return best;
}

/* ---------- Mexicano: 1. kierros satunnainen, sitten sarjataulukon mukaan 1+4 vs 2+3 ---------- */
function mexicanoRound() {
  const courts = activeCourts();
  let order;
  if (state.rounds.length) order = standings().map(x => x.id);
  else if (state.seed === 'rating') {
    // 1. kierros rankingin mukaan: kentälle 1 vahvimmat, parit 1.+4. vs 2.+3.
    const ratings = computeRatings();
    order = shuffle(state.players.map(p => p.id)).sort((a, b) => ratingOf(ratings, nameOf(b)) - ratingOf(ratings, nameOf(a)));
  } else order = shuffle(state.players.map(p => p.id));
  // Tasatilanteessa tauolle mieluummin taulukon alapäästä (käännetty järjestys)
  const byes = pickByes(state.players.length - courts * 4, [...order].reverse());
  const active = order.filter(id => !byes.includes(id));
  const matches = [];
  for (let i = 0; i < courts; i++) {
    const [p1, p2, p3, p4] = active.slice(i * 4, i * 4 + 4);
    matches.push({ court: i + 1, a: [p1, p4], b: [p2, p3], sa: null, sb: null });
  }
  return { matches, byes };
}

function addRound() {
  let r;
  if (state.format === 'mexicano') r = mexicanoRound();
  else if (state.schedule && state.schedule[state.rounds.length]) r = JSON.parse(JSON.stringify(state.schedule[state.rounds.length]));
  else r = americanoRound(); // lisäkierros valmiin ohjelman jälkeen
  state.rounds.push(r);
  state.shownRound = state.rounds.length - 1;
  state.view = 'matches';
  save(); render(); window.scrollTo(0, 0);
}

/* ---------- näkymät ---------- */
const app = document.getElementById('app');
const picker = document.getElementById('picker');
let setupError = '';

/* ---------- teema (vaalea / tumma), liukukytkin yläkulmassa ---------- */
const themeToggle = document.getElementById('themeToggle');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeToggle.checked = t === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0d0d10' : '#1849b8');
}
applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
themeToggle.addEventListener('change', () => {
  const t = themeToggle.checked ? 'dark' : 'light';
  applyTheme(t);
  try { localStorage.setItem('padel-theme', t); } catch (e) { /* ei tallennusta */ }
});

document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => {
  state.page = b.dataset.page;
  if (state.page === 'history') state.historyOpen = null;
  save(); render(); window.scrollTo(0, 0);
});

function render() {
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === state.page || (state.page === 'player' && b.dataset.page === 'players')));
  if (state.page === 'stats') renderStats();
  else if (state.page === 'players') renderPlayers();
  else if (state.page === 'player') renderPlayer();
  else if (state.page === 'history') renderHistory();
  else if (state.phase === 'setup') renderSetup();
  else renderPlay();
}

/* ---------- aloitusnäkymä ---------- */
function renderSetup() {
  const n = state.players.length;
  const c = courtsFor(n), rounds = roundsFor(n);
  const byes = n - c * 4;
  const custom = !POINT_PRESETS.includes(state.points);
  const savable = db.players.length > 0;
  const series = [...db.series].sort((a, b) => byName(a.name, b.name));
  const cur = state.seriesId && seriesById(state.seriesId);
  const changed = cur && (cur.players.length !== n || cur.players.some(name => !isSelected(name)));
  const live = cloudOn() ? liveTournaments() : [];
  app.innerHTML = `
  ${installCardHtml()}
  ${live.map(h => `
  <div class="info install live">
    <span>🔴 <b>Käynnissä nyt:</b> ${esc(h.seriesId && seriesById(h.seriesId) ? seriesById(h.seriesId).name : fmtName(h.format))} · ${h.players.length} pelaajaa · kierros ${h.rounds.length}/${Math.max(h.roundsTarget || 0, h.rounds.length)}</span>
    <button class="primary" data-joinlive="${h.id}">Liity</button>
  </div>`).join('')}
  ${series.length ? `
  <section class="card">
    <h2>⭐ Vakioturnaukset</h2>
    <div class="lists" style="margin:0">
      ${series.map(s => `
      <div class="listrow">
        <button class="use ${cur === s ? 'on-series' : ''}" data-series="${s.id}">${esc(s.name)}
          <span class="muted small">· ${s.players.length} pelaajaa · ${seriesTournaments(s.id).length} turnausta</span></button>
        <button class="icon" data-stats="${s.id}" aria-label="Tilastot: ${esc(s.name)}" title="Tilastot">📊</button>
      </div>`).join('')}
    </div>
    <p class="muted small" style="margin-bottom:0">Valinta tuo vakio-osallistujat, turnausmuodon ja pistemäärän. Pelaajia voi vielä muuttaa.</p>
  </section>` : ''}
  ${cur ? `
  <div class="info series-banner">
    <span>⭐ Vakioturnaus: <b>${esc(cur.name)}</b></span>
    <button class="icon" id="clearSeries" aria-label="Poista vakioturnauksen valinta">✕</button>
  </div>
  ${changed ? '<button id="updateSeriesPlayers" class="small-btn">Tallenna nykyiset pelaajat vakio-osallistujiksi</button>' : ''}` : ''}
  <section class="card">
    <h2>Pelaajat (${n})</h2>
    <form id="addForm" class="row">
      <input id="nameInput" class="grow" type="text" placeholder="Uusi pelaaja (useampi pilkulla)" autocomplete="off" enterkeyhint="done">
      <button class="primary" type="submit">Lisää</button>
    </form>
    <div class="chips">
      ${state.players.map(p => `<span class="chip">${esc(p.name)}<button data-remove="${p.id}" aria-label="Poista ${esc(p.name)}">×</button></span>`).join('') || '<span class="muted">Ei vielä pelaajia. Tarvitaan vähintään 4.</span>'}
    </div>
    <div class="btnrow">
      <button id="pickBtn" ${savable ? '' : 'disabled'}>📋 Valitse tallennetuista</button>
      ${n ? '<button id="saveListBtn">💾 Tallenna listaksi</button>' : ''}
    </div>
    ${savable ? '' : '<p class="muted small">Lisätyt pelaajat tallentuvat, ja voit myöhemmin valita heidät listasta.</p>'}
  </section>

  <section class="card">
    <h2>Turnausmuoto</h2>
    <div class="seg">
      <button data-format="americano" class="${state.format === 'americano' ? 'on' : ''}">Americano</button>
      <button data-format="mexicano" class="${state.format === 'mexicano' ? 'on' : ''}">Mexicano</button>
    </div>
    <p class="muted">${state.format === 'americano'
      ? 'Parit vaihtuvat joka kierroksella niin, että jokainen pelaa mahdollisimman tasaisesti eri parien kanssa ja eri vastustajia vastaan.'
      : 'Kentät muodostetaan sarjataulukon mukaan: 1.+4. vs 2.+3. jokaisella kentällä.'}</p>
    ${state.format === 'mexicano' ? `
    <p class="section-label" style="margin-top:10px">Ensimmäinen kierros</p>
    <div class="seg">
      <button data-seed="random" class="${state.seed !== 'rating' ? 'on' : ''}">🎲 Arvonta</button>
      <button data-seed="rating" class="${state.seed === 'rating' ? 'on' : ''}">🏅 Rankingin mukaan</button>
    </div>` : ''}
  </section>

  <section class="card">
    <h2>Kentät ja kierrokset</h2>
    ${n < 4 ? '<p class="muted">Määräytyvät automaattisesti pelaajamäärän mukaan. Lisää vähintään 4 pelaajaa.</p>' : `
    <div class="info">
      <b>${c} kenttä${c === 1 ? '' : 'ä'}</b> · <b>${rounds} kierrosta</b>${byes ? ` · ${byes} tauolla / kierros` : ''}
    </div>
    <p class="muted small">Kenttiä on yksi jokaista neljää pelaajaa kohden. Kierroksia on niin monta, että jokainen ehtii pelata jokaisen kanssa ristiin.</p>`}
  </section>

  <section class="card">
    <h2>Pisteet per ottelu</h2>
    <div class="seg">
      ${POINT_PRESETS.map(p => `<button data-points="${p}" class="${state.points === p ? 'on' : ''}">${p}</button>`).join('')}
      <button data-points="custom" class="${custom ? 'on' : ''}">Muu</button>
    </div>
    ${custom ? `<div class="row" style="margin-top:8px"><input id="pointsInput" type="number" inputmode="numeric" min="2" max="99" value="${state.points}"> <span class="muted">pistettä</span></div>` : ''}
    <p class="muted">Joka ottelussa pelataan yhteensä ${state.points} pistettä. Jokainen pelaaja saa joukkueensa pisteet.</p>
  </section>

  <button id="startBtn" class="primary big" ${n < 4 ? 'disabled' : ''}>Aloita turnaus</button>
  ${setupError ? `<p class="err">${esc(setupError)}</p>` : ''}
  `;

  document.getElementById('addForm').onsubmit = e => {
    e.preventDefault();
    const input = document.getElementById('nameInput');
    const names = input.value.split(/[,\n;]/).map(s => s.trim().slice(0, 40)).filter(Boolean);
    setupError = '';
    for (const name of names) {
      if (state.players.some(p => same(p.name, name))) { setupError = `Nimi "${name}" on jo listalla.`; continue; }
      const saved = db.players.find(x => same(x, name));
      state.players.push({ id: state.nextId++, name: saved || name });
      rememberPlayer(name);
    }
    save(); render();
    document.getElementById('nameInput').focus();
  };
  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    state.players = state.players.filter(p => p.id !== +b.dataset.remove);
    save(); render();
  });
  const pick = document.getElementById('pickBtn');
  pick.onclick = openPicker;
  const sl = document.getElementById('saveListBtn');
  if (sl) sl.onclick = saveCurrentAsList;
  bindInstallCard();
  app.querySelectorAll('[data-joinlive]').forEach(b => b.onclick = () => joinTournament(b.dataset.joinlive));
  app.querySelectorAll('[data-series]').forEach(b => b.onclick = () => { selectSeries(b.dataset.series); save(); render(); });
  app.querySelectorAll('[data-stats]').forEach(b => b.onclick = () => openStats(b.dataset.stats, 'tournament'));
  const cs = document.getElementById('clearSeries');
  if (cs) cs.onclick = () => { state.seriesId = null; save(); render(); };
  const usp = document.getElementById('updateSeriesPlayers');
  if (usp) usp.onclick = () => {
    if (!confirm(`Tallennetaanko nykyiset ${n} pelaajaa vakioturnauksen "${cur.name}" vakio-osallistujiksi?`)) return;
    cur.players = state.players.map(p => p.name); saveDb(); render();
  };
  app.querySelectorAll('[data-seed]').forEach(b => b.onclick = () => { state.seed = b.dataset.seed; save(); render(); });
  app.querySelectorAll('[data-format]').forEach(b => b.onclick = () => { state.format = b.dataset.format; save(); render(); });
  app.querySelectorAll('[data-points]').forEach(b => b.onclick = () => {
    if (b.dataset.points === 'custom') { if (POINT_PRESETS.includes(state.points)) state.points = 20; }
    else state.points = +b.dataset.points;
    save(); render();
  });
  const pi = document.getElementById('pointsInput');
  if (pi) pi.onchange = () => { const v = parseInt(pi.value, 10); if (v >= 2 && v <= 99) state.points = v; save(); render(); };
  const startBtn = document.getElementById('startBtn');
  startBtn.onclick = () => {
    if (state.players.length < 4 || startBtn.disabled) return;
    startBtn.disabled = true;
    startBtn.textContent = state.format === 'americano' ? 'Arvotaan otteluohjelmaa…' : 'Arvotaan…';
    setTimeout(startTournament, 30); // näytä teksti ennen laskentaa
  };
}

function startTournament() {
  state.roundsTarget = state.baseTarget = roundsFor(state.players.length);
  state.phase = 'play';
  state.rounds = [];
  state.tid = newId();
  state.startedAt = new Date().toISOString();
  state.schedule = state.format === 'americano' ? americanoSchedule(state.roundsTarget) : null;
  addRound();
}

function saveCurrentAsList() {
  const name = (prompt('Listan nimi (esim. "Tiistain vuoro"):', '') || '').trim().slice(0, 40);
  if (!name) return;
  const names = state.players.map(p => p.name);
  const existing = db.lists.find(l => same(l.name, name));
  if (existing) {
    if (!confirm(`Lista "${existing.name}" on jo olemassa. Korvataanko se?`)) return;
    existing.players = names;
  } else {
    db.lists.push({ id: newId(), name, players: names });
  }
  names.forEach(rememberPlayer);
  saveDb();
  alert(`Lista "${name}" tallennettu (${names.length} pelaajaa).`);
}

/* ---------- pelaajavalitsin (valintaikkuna) ---------- */
function openPicker() {
  renderPicker();
  if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
}
function closePicker() {
  if (typeof picker.close === 'function') picker.close(); else picker.removeAttribute('open');
}
picker.addEventListener('close', () => render());
picker.addEventListener('click', e => { if (e.target === picker) closePicker(); }); // klikkaus taustaan sulkee

function isSelected(name) { return state.players.some(p => same(p.name, name)); }
function setSelected(name, on) {
  if (on && !isSelected(name)) state.players.push({ id: state.nextId++, name });
  if (!on) state.players = state.players.filter(p => !same(p.name, name));
  save();
}

function renderPicker(filter = '') {
  const lists = [...db.lists].sort((a, b) => byName(a.name, b.name));
  const players = [...db.players].sort(byName);
  picker.innerHTML = `
  <div class="dlg">
    <div class="dlg-head">
      <h2 id="pickerTitle">Valitse pelaajat</h2>
      <button class="icon" id="pkClose" aria-label="Sulje">✕</button>
    </div>
    <div class="dlg-body">
      ${lists.length ? `
      <p class="section-label">Valmiit listat</p>
      <div class="lists">
        ${lists.map(l => `
        <div class="listrow">
          <button class="use" data-uselist="${l.id}">${esc(l.name)} <span class="muted">(${l.players.length})</span></button>
          <button class="icon" data-dellist="${l.id}" aria-label="Poista lista ${esc(l.name)}">🗑</button>
        </div>`).join('')}
      </div>
      <p class="muted small" style="margin-top:-6px">Listan valinta korvaa nykyisen pelaajavalinnan.</p>` : ''}
      <p class="section-label">Tallennetut pelaajat (${players.length})</p>
      <input id="pkSearch" type="text" placeholder="Hae nimellä" autocomplete="off" style="width:100%;margin-bottom:6px" value="${esc(filter)}">
      <div class="btnrow" style="margin:0 0 6px"><button id="pkAll">Valitse kaikki</button><button id="pkNone">Tyhjennä valinta</button></div>
      <div class="plist">
        ${players.map(name => `
        <div class="prow" data-name="${esc(name.toLocaleLowerCase('fi'))}">
          <label><input type="checkbox" data-pick="${esc(name)}" ${isSelected(name) ? 'checked' : ''}> ${esc(name)}</label>
          <button class="icon" data-delplayer="${esc(name)}" aria-label="Poista ${esc(name)} tallennetuista">🗑</button>
        </div>`).join('') || '<p class="muted">Ei tallennettuja pelaajia.</p>'}
      </div>
    </div>
    <div class="dlg-foot"><button id="pkDone" class="primary big">Valmis (<span id="pkCount">${state.players.length}</span> valittu)</button></div>
  </div>`;

  const search = document.getElementById('pkSearch');
  const applyFilter = () => {
    const q = search.value.trim().toLocaleLowerCase('fi');
    picker.querySelectorAll('.prow').forEach(r => { r.hidden = !!q && !r.dataset.name.includes(q); });
  };
  search.oninput = applyFilter;
  applyFilter();
  const count = () => { document.getElementById('pkCount').textContent = state.players.length; };
  picker.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => { setSelected(cb.dataset.pick, cb.checked); count(); });
  document.getElementById('pkAll').onclick = () => {
    picker.querySelectorAll('.prow:not([hidden]) [data-pick]').forEach(cb => { cb.checked = true; setSelected(cb.dataset.pick, true); });
    count();
  };
  document.getElementById('pkNone').onclick = () => {
    state.players = []; save();
    picker.querySelectorAll('[data-pick]').forEach(cb => { cb.checked = false; });
    count();
  };
  picker.querySelectorAll('[data-uselist]').forEach(b => b.onclick = () => {
    const l = db.lists.find(x => x.id === b.dataset.uselist); if (!l) return;
    state.players = l.players.map(name => ({ id: state.nextId++, name }));
    save(); renderPicker(search.value);
  });
  picker.querySelectorAll('[data-dellist]').forEach(b => b.onclick = () => {
    const l = db.lists.find(x => x.id === b.dataset.dellist); if (!l) return;
    if (!confirm(`Poistetaanko lista "${l.name}"? Pelaajat säilyvät tallennetuissa.`)) return;
    db.lists = db.lists.filter(x => x !== l); saveDb(); renderPicker(search.value);
  });
  picker.querySelectorAll('[data-delplayer]').forEach(b => b.onclick = () => {
    const name = b.dataset.delplayer;
    if (!confirm(`Poistetaanko ${name} tallennetuista pelaajista? Hän poistuu myös listoilta (turnaushistoria säilyy).`)) return;
    db.players = db.players.filter(x => !same(x, name));
    db.lists.forEach(l => { l.players = l.players.filter(x => !same(x, name)); });
    setSelected(name, false);
    saveDb(); renderPicker(search.value);
  });
  document.getElementById('pkClose').onclick = closePicker;
  document.getElementById('pkDone').onclick = closePicker;
}

/* ---------- turnausnäkymä ---------- */
function renderPlay() {
  const tabs = `
    <p class="muted subtitle">${cloudDotHtml()} ${state.seriesId && seriesById(state.seriesId) ? `⭐ ${esc(seriesById(state.seriesId).name)} · ` : ''}${state.format === 'americano' ? 'Americano' : 'Mexicano'} · ${state.points} p · ${state.players.length} pelaajaa · ${activeCourts()} kenttä${activeCourts() === 1 ? '' : 'ä'}</p>
    <div class="tabs">
      <button data-view="matches" class="${state.view === 'matches' ? 'on' : ''}">Ottelut</button>
      <button data-view="table" class="${state.view === 'table' ? 'on' : ''}">Sarjataulukko</button>
    </div>`;
  const body = state.view === 'matches'
    ? matchesHtml()
    : tableHtml(state.players, state.rounds, state.points, Math.max(state.roundsTarget, state.rounds.length));
  app.innerHTML = tabs + body + `
    <div class="actions"><button id="resetBtn" class="danger">Uusi turnaus</button></div>`;

  app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; save(); render(); window.scrollTo(0, 0); });
  document.getElementById('resetBtn').onclick = () => {
    const msg = finished()
      ? 'Aloitetaanko uusi turnaus? Tämä turnaus on tallessa historiassa.'
      : 'Aloitetaanko uusi turnaus? Keskeneräinen turnaus jää historiaan nykyisillä tuloksilla.';
    if (!confirm(msg)) return;
    state.phase = 'setup'; state.rounds = []; state.view = 'matches'; state.shownRound = 0;
    state.roundsTarget = state.baseTarget = null; state.tid = null; state.startedAt = null; state.schedule = null; state.seriesId = null;
    save(); render(); window.scrollTo(0, 0);
  };
  if (state.view === 'matches') bindMatches();
}

function matchesHtml() {
  const ri = Math.min(state.shownRound, state.rounds.length - 1);
  const r = state.rounds[ri];
  const isLast = ri === state.rounds.length - 1;
  const chips = state.rounds.map((x, i) =>
    `<button data-round="${i}" class="${i === ri ? 'on' : ''} ${roundComplete(x) ? 'done' : ''}">K${i + 1}</button>`).join('');
  const matches = r.matches.map((m, mi) => {
    const scored = isScored(m);
    const val = v => Number.isInteger(v) ? v : '';
    return `
    <div class="match">
      <div class="court">Kenttä ${m.court}</div>
      <div class="team ${scored && m.sa > m.sb ? 'win' : ''}">
        <span class="names">${esc(nameOf(m.a[0]))} &amp; ${esc(nameOf(m.a[1]))}</span>
        <input type="number" inputmode="numeric" min="0" max="${state.points}" data-m="${mi}" data-side="a" value="${val(m.sa)}" aria-label="Pisteet ${esc(nameOf(m.a[0]))} ja ${esc(nameOf(m.a[1]))}">
      </div>
      <div class="vs">vs</div>
      <div class="team ${scored && m.sb > m.sa ? 'win' : ''}">
        <span class="names">${esc(nameOf(m.b[0]))} &amp; ${esc(nameOf(m.b[1]))}</span>
        <input type="number" inputmode="numeric" min="0" max="${state.points}" data-m="${mi}" data-side="b" value="${val(m.sb)}" aria-label="Pisteet ${esc(nameOf(m.b[0]))} ja ${esc(nameOf(m.b[1]))}">
      </div>
    </div>`;
  }).join('');
  const byes = r.byes.length ? `<p class="muted bye">Tauolla: ${r.byes.map(id => esc(nameOf(id))).join(', ')}</p>` : '';
  const complete = roundComplete(r);
  let actions = '';
  if (isLast) {
    if (finished()) {
      const top = standings();
      actions = `
      <div class="card podium">
        <div class="muted">Turnaus päättyi · tallennettu historiaan</div>
        <div class="winner">🏆 ${esc(top[0].name)}</div>
        <div class="muted">${top[0].pts} pistettä${top[1] ? ` · 2. ${esc(top[1].name)} (${top[1].pts})` : ''}${top[2] ? ` · 3. ${esc(top[2].name)} (${top[2].pts})` : ''}</div>
      </div>
      ${state.seriesId && seriesById(state.seriesId)
        ? `<div class="info series-banner"><span>⭐ Tallennettu vakioturnaukseen <b>${esc(seriesById(state.seriesId).name)}</b></span></div>
           <button id="seriesStatsBtn">📊 Vakioturnauksen tilastot</button>`
        : '<button id="seriesSaveBtn">⭐ Tallenna vakioturnaukseksi</button>'}
      <button id="shareBtn" class="primary big">📤 Jaa tulokset</button>
      <button id="tableBtn">Näytä lopputulokset</button>
      <button id="nextBtn">Pelaa lisäkierros</button>`;
    } else {
      actions = `<button id="nextBtn" class="primary big" ${complete ? '' : 'disabled'}>${complete ? 'Seuraava kierros →' : 'Syötä kaikki tulokset'}</button>`;
    }
    actions += `<button id="undoBtn" class="danger">Poista kierros ${ri + 1}</button>`;
  }
  return `
  <div class="rounds">${chips}</div>
  <section class="card">
    <h2>Kierros ${ri + 1} / ${Math.max(state.roundsTarget, state.rounds.length)}</h2>
    ${matches}
    ${byes}
    <p class="muted small">Syötä toisen joukkueen pisteet, niin toisen pisteet täydentyvät automaattisesti (yhteensä ${state.points}). Tulokset tallentuvat automaattisesti.</p>
  </section>
  <div class="actions">${actions}</div>`;
}

function bindMatches() {
  const ri = Math.min(state.shownRound, state.rounds.length - 1);
  const cur = () => state.rounds[ri]; // haetaan aina tuoreena (pilvi voi korvata kierrokset)
  app.querySelectorAll('[data-round]').forEach(b => b.onclick = () => { state.shownRound = +b.dataset.round; save(); render(); });
  app.querySelectorAll('input[data-m]').forEach(inp => {
    inp.addEventListener('input', () => {
      const r = cur(); if (!r) return;
      const m = r.matches[+inp.dataset.m];
      const side = inp.dataset.side, other = side === 'a' ? 'b' : 'a';
      const otherInp = app.querySelector(`input[data-m="${inp.dataset.m}"][data-side="${other}"]`);
      const v = parseInt(inp.value, 10);
      if (inp.value === '' || isNaN(v)) {
        m['s' + side] = null; m['s' + other] = null; otherInp.value = '';
      } else {
        const c = Math.max(0, Math.min(state.points, v));
        m['s' + side] = c; m['s' + other] = state.points - c;
        otherInp.value = state.points - c;
        if (c !== v) inp.value = c;
      }
      save();
      refreshRoundStatus(r, ri);
    });
    inp.addEventListener('focus', () => inp.select());
  });
  const next = document.getElementById('nextBtn');
  if (next) next.onclick = () => {
    if (finished()) state.roundsTarget = state.rounds.length + 1;
    addRound();
  };
  const shb = document.getElementById('shareBtn');
  if (shb) shb.onclick = () => shareResults(state.tid);
  const ssb = document.getElementById('seriesSaveBtn');
  if (ssb) ssb.onclick = () => openSeriesDialog(state.tid);
  const stb = document.getElementById('seriesStatsBtn');
  if (stb) stb.onclick = () => openStats(state.seriesId, 'tournament');
  const tb = document.getElementById('tableBtn');
  if (tb) tb.onclick = () => { state.view = 'table'; save(); render(); window.scrollTo(0, 0); };
  const undo = document.getElementById('undoBtn');
  if (undo) undo.onclick = () => {
    const r = cur();
    if (!r || ri !== state.rounds.length - 1) return render();
    const hasScores = r.matches.some(m => Number.isInteger(m.sa));
    if (hasScores && !confirm(`Poistetaanko kierros ${ri + 1} tuloksineen?`)) return;
    state.rounds.pop();
    state.roundsTarget = Math.max(state.baseTarget || 1, state.rounds.length); // lisäkierroksen poisto palauttaa tavoitteen
    if (state.rounds.length === 0) {
      db.history = db.history.filter(h => h.id !== state.tid);
      state.phase = 'setup'; state.tid = null; state.startedAt = null;
    }
    state.shownRound = state.rounds.length - 1;
    save(); render();
  };
}

function refreshRoundStatus(r, ri) {
  const next = document.getElementById('nextBtn');
  const chip = app.querySelector(`[data-round="${ri}"]`);
  if (chip) chip.classList.toggle('done', roundComplete(r));
  // voittajakorostus ilman uudelleenpiirtoa (fokus säilyy)
  r.matches.forEach((m, mi) => {
    const a = app.querySelector(`input[data-m="${mi}"][data-side="a"]`);
    const b = app.querySelector(`input[data-m="${mi}"][data-side="b"]`);
    const s = isScored(m);
    if (a) a.parentElement.classList.toggle('win', s && m.sa > m.sb);
    if (b) b.parentElement.classList.toggle('win', s && m.sb > m.sa);
  });
  if (next && !finished() && ri === state.rounds.length - 1) {
    const c = roundComplete(r);
    next.disabled = !c;
    next.textContent = c ? 'Seuraava kierros →' : 'Syötä kaikki tulokset';
  }
  if (finished() && !document.getElementById('tableBtn')) render();
}

function tableHtml(players, rounds, pts, total) {
  const rows = computeStandings(players, rounds, pts);
  const played = rounds.filter(r => roundComplete(r, pts)).length;
  const anyDraw = rows.some(x => x.d > 0);
  return `
  <section class="card">
    <h2>Sarjataulukko</h2>
    <p class="muted small">Pelattu ${played} / ${total} kierrosta</p>
    <table>
      <thead><tr><th>#</th><th>Pelaaja</th><th>Pist.</th><th>O</th><th>V</th>${anyDraw ? '<th>T</th>' : ''}<th>H</th><th>+/−</th></tr></thead>
      <tbody>
      ${rows.map((x, i) => {
        const diff = x.pts - x.against;
        return `<tr>
          <td><span class="rank ${i < 3 && x.played ? 'r' + (i + 1) : ''}">${i + 1}</span></td>
          <td>${playerLink(x.name)}${x.byes ? ` <span class="muted small">(${x.byes} tauko${x.byes > 1 ? 'a' : ''})</span>` : ''}</td>
          <td class="pts">${x.pts}</td><td>${x.played}</td><td>${x.w}</td>${anyDraw ? `<td>${x.d}</td>` : ''}<td>${x.l}</td>
          <td>${diff > 0 ? '+' : ''}${diff}</td></tr>`;
      }).join('')}
      </tbody>
    </table>
    <p class="muted small">Pist. = kokonaispisteet, O = pelatut ottelut, V = voitot, ${anyDraw ? 'T = tasapelit, ' : ''}H = häviöt, +/− = piste-ero. Järjestys: pisteet, voitot, piste-ero.</p>
  </section>`;
}

/* ---------- historia ---------- */
function renderHistory() {
  const h = state.historyOpen && db.history.find(x => x.id === state.historyOpen);
  if (h) return renderHistoryDetail(h);
  const items = [...db.history].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  app.innerHTML = `
  <section class="card">
    <h2>Turnaushistoria (${items.length})</h2>
    <p class="muted small">Turnaukset ja tulokset tallentuvat tähän automaattisesti. ${cloudOn() ? 'Tiedot jaetaan porukan kesken ja säilyvät myös tällä laitteella.' : 'Tiedot säilyvät tämän laitteen selaimessa.'}</p>
  </section>
  ${cloudCardHtml()}
  ${items.map(x => {
    const top = computeStandings(x.players, x.rounds, x.points)[0];
    const played = x.rounds.filter(r => roundComplete(r, x.points)).length;
    return `
    <button class="hist card" data-open="${x.id}">
      <div class="top"><span>${esc(fmtDate(x.date))}</span>
        <span class="tag ${x.finished ? '' : 'open'}">${x.finished ? 'Valmis' : 'Kesken'}</span></div>
      ${x.seriesId && seriesById(x.seriesId) ? `<div>⭐ ${esc(seriesById(x.seriesId).name)}</div>` : ''}
      <div class="muted">${x.format === 'americano' ? 'Americano' : 'Mexicano'} · ${x.points} p · ${x.players.length} pelaajaa · ${played}/${Math.max(x.roundsTarget || 0, x.rounds.length)} kierrosta</div>
      ${top && top.played ? `<div>${x.finished ? '🏆' : 'Johdossa:'} <b>${esc(top.name)}</b> (${top.pts} p)</div>` : ''}
    </button>`;
  }).join('') || '<p class="muted">Ei vielä tallennettuja turnauksia.</p>'}
  <section class="card">
    <h2>Varmuuskopio</h2>
    <p class="muted small">Vie kaikki tiedot (pelaajat, listat, vakioturnaukset ja historia) tiedostoon, tai tuo ne toiselle laitteelle.</p>
    <div class="btnrow">
      <button id="exportBtn">⬇ Vie tiedostoon</button>
      <button id="importBtn">⬆ Tuo tiedostosta</button>
    </div>
    <input id="importFile" type="file" accept="application/json,.json" hidden>
  </section>`;
  app.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { state.historyOpen = b.dataset.open; save(); render(); window.scrollTo(0, 0); });
  bindCloudCard();
  document.getElementById('exportBtn').onclick = exportDb;
  const file = document.getElementById('importFile');
  document.getElementById('importBtn').onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) importDb(file.files[0]); };
}

function renderHistoryDetail(h) {
  const isCurrent = state.phase === 'play' && state.tid === h.id;
  const nm = id => esc(nameIn(h.players, id));
  const total = Math.max(h.roundsTarget || 0, h.rounds.length);
  const hs = h.seriesId && seriesById(h.seriesId);
  app.innerHTML = `
  <div class="actions" style="margin:0 0 12px"><button id="backBtn">← Takaisin historiaan</button></div>
  <section class="card">
    <h2>${esc(fmtDate(h.date))} <span class="tag ${h.finished ? '' : 'open'}">${h.finished ? 'Valmis' : 'Kesken'}</span></h2>
    <p class="muted" style="margin:0">${h.format === 'americano' ? 'Americano' : 'Mexicano'} · ${h.points} p · ${h.courts} kenttä${h.courts === 1 ? '' : 'ä'}</p>
    <p style="margin:8px 0 0"><b>Osallistujat (${h.players.length}):</b> ${h.players.map(p => esc(p.name)).sort(byName).join(', ')}</p>
    ${hs ? `
    <div class="info series-banner" style="margin-top:10px"><span>⭐ Vakioturnaus: <b>${esc(hs.name)}</b></span></div>
    <div class="btnrow"><button id="hStatsBtn">📊 Tilastot</button><button id="hUnlinkBtn">Irrota vakioturnauksesta</button></div>`
    : '<div class="btnrow"><button id="hSeriesBtn">⭐ Tallenna vakioturnaukseksi</button></div>'}
  </section>
  ${tableHtml(h.players, h.rounds, h.points, total)}
  <section class="card">
    <h2>Ottelut</h2>
    ${h.rounds.map((r, i) => `
      <p class="section-label" style="margin-top:${i ? 12 : 0}px">Kierros ${i + 1}</p>
      ${r.matches.map(m => {
        const s = isScored(m, h.points);
        const A = `${nm(m.a[0])} &amp; ${nm(m.a[1])}`, B = `${nm(m.b[0])} &amp; ${nm(m.b[1])}`;
        return `<div class="rres">${s && m.sa > m.sb ? `<b>${A}</b>` : A} ${s ? `${m.sa}–${m.sb}` : '–'} ${s && m.sb > m.sa ? `<b>${B}</b>` : B}</div>`;
      }).join('')}
      ${r.byes.length ? `<div class="muted small">Tauolla: ${r.byes.map(nm).join(', ')}</div>` : ''}`).join('')}
  </section>
  <div class="actions">
    ${isCurrent ? '<button id="continueBtn" class="primary big">Jatka turnausta</button>' : ''}
    ${!isCurrent && !h.finished ? '<button id="joinBtn" class="primary big">▶ Liity turnaukseen ja syötä tuloksia</button>' : ''}
    ${h.rounds.some(r => r.matches.some(m => isScored(m, h.points))) ? `<button id="shareHistBtn" ${isCurrent ? '' : 'class="primary big"'}>📤 Jaa ${h.finished ? 'tulokset' : 'tilanne'}</button>` : ''}
    ${canDeleteTour(h) ? '<button id="delHistBtn" class="danger">Poista turnaus historiasta</button>' : '<p class="muted small" style="text-align:center">Vain porukan ylläpitäjä voi poistaa valmiin turnauksen.</p>'}
  </div>`;
  document.getElementById('backBtn').onclick = () => { state.historyOpen = null; save(); render(); };
  const jb = document.getElementById('joinBtn');
  if (jb) jb.onclick = () => joinTournament(h.id);
  const shh = document.getElementById('shareHistBtn');
  if (shh) shh.onclick = () => shareResults(h.id);
  const hsb = document.getElementById('hSeriesBtn');
  if (hsb) hsb.onclick = () => openSeriesDialog(h.id);
  const hst = document.getElementById('hStatsBtn');
  if (hst) hst.onclick = () => openStats(hs.id, 'history');
  const hun = document.getElementById('hUnlinkBtn');
  if (hun) hun.onclick = () => {
    if (!confirm(`Irrotetaanko turnaus vakioturnauksesta "${hs.name}"? Se ei enää näy sen tilastoissa.`)) return;
    linkToSeries(h.id, null); render();
  };
  const cont = document.getElementById('continueBtn');
  if (cont) cont.onclick = () => { state.page = 'tournament'; state.historyOpen = null; save(); render(); window.scrollTo(0, 0); };
  const dhb = document.getElementById('delHistBtn');
  if (dhb) dhb.onclick = () => {
    const msg = isCurrent
      ? 'Tämä on käynnissä oleva turnaus. Poistetaanko se historiasta ja lopetetaanko turnaus? Tätä ei voi perua.'
      : 'Poistetaanko turnaus historiasta? Tätä ei voi perua.';
    if (!confirm(msg)) return;
    db.history = db.history.filter(x => x.id !== h.id);
    if (isCurrent) {
      state.phase = 'setup'; state.rounds = []; state.tid = null; state.startedAt = null;
      state.roundsTarget = state.baseTarget = null; state.view = 'matches'; state.shownRound = 0; state.schedule = null;
    }
    state.historyOpen = null;
    save(); render();
  };
}

/* ---------- vakioturnaukset ---------- */
const seriesById = id => db.series.find(s => s.id === id);
const seriesTournaments = id => db.history.filter(h => h.seriesId === id && h.finished)
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
const fmtDay = iso => new Date(iso).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtShort = iso => new Date(iso).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });

function openStats(id, back) {
  state.statsOpen = id; state.statsBack = back || state.page; state.page = 'stats';
  save(); render(); window.scrollTo(0, 0);
}

function linkToSeries(hid, sid) {
  const h = db.history.find(x => x.id === hid);
  if (h) h.seriesId = sid;
  if (state.tid === hid) state.seriesId = sid;
  save();
}

/* Valintaikkuna: tallenna turnaus uudeksi vakioturnaukseksi tai lisää olemassa olevaan. */
function openSeriesDialog(hid) {
  const h = db.history.find(x => x.id === hid);
  if (!h) return;
  const existing = [...db.series].sort((a, b) => byName(a.name, b.name));
  picker.innerHTML = `
  <div class="dlg">
    <div class="dlg-head">
      <h2 id="pickerTitle">Tallenna vakioturnaukseksi</h2>
      <button class="icon" id="sdClose" aria-label="Sulje">✕</button>
    </div>
    <div class="dlg-body">
      <p class="section-label">Uusi vakioturnaus</p>
      <form id="sdForm" class="row">
        <input id="sdName" class="grow" type="text" placeholder="Nimi, esim. Tiistain americano" maxlength="40" autocomplete="off" required>
        <button class="primary" type="submit">Tallenna</button>
      </form>
      <p class="muted small">Vakio-osallistujiksi tallentuvat tämän turnauksen ${h.players.length} pelaajaa: ${h.players.map(p => esc(p.name)).sort(byName).join(', ')}.</p>
      ${existing.length ? `
      <p class="section-label" style="margin-top:16px">Tai lisää olemassa olevaan</p>
      <div class="lists">
        ${existing.map(s => `<button class="use" data-addto="${s.id}" style="text-align:left">${esc(s.name)} <span class="muted">(${seriesTournaments(s.id).length} turnausta)</span></button>`).join('')}
      </div>` : ''}
    </div>
  </div>`;
  if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
  document.getElementById('sdClose').onclick = closePicker;
  document.getElementById('sdForm').onsubmit = e => {
    e.preventDefault();
    const name = document.getElementById('sdName').value.trim().slice(0, 40);
    if (!name) return;
    if (db.series.some(s => same(s.name, name))) { alert(`Vakioturnaus "${name}" on jo olemassa. Valitse se listasta tai anna toinen nimi.`); return; }
    const s = { id: newId(), name, players: h.players.map(p => p.name), format: h.format, points: h.points, created: new Date().toISOString() };
    db.series.push(s);
    linkToSeries(hid, s.id);
    closePicker();
  };
  picker.querySelectorAll('[data-addto]').forEach(b => b.onclick = () => { linkToSeries(hid, b.dataset.addto); closePicker(); });
  setTimeout(() => document.getElementById('sdName').focus(), 50);
}

/* Tilastot: sijoitus ja pisteet jokaisesta vakioturnauksen turnauksesta. */
function seriesStats(sid) {
  const tours = seriesTournaments(sid).map(h => {
    const rows = computeStandings(h.players, h.rounds, h.points);
    return { h, rows, byName: new Map(rows.map((r, i) => [r.name.toLocaleLowerCase('fi'), { ...r, place: i + 1, of: rows.length }])) };
  });
  const players = new Map();
  for (const t of tours) for (const [key, r] of t.byName) {
    if (!players.has(key)) players.set(key, { name: r.name, n: 0, wins: 0, podiums: 0, placeSum: 0, best: Infinity, pts: 0, games: 0, w: 0 });
    const p = players.get(key);
    p.n++; p.placeSum += r.place; p.best = Math.min(p.best, r.place);
    if (r.place === 1) p.wins++;
    if (r.place <= 3) p.podiums++;
    p.pts += r.pts; p.games += r.played; p.w += r.w;
  }
  const summary = [...players.entries()].map(([key, p]) => ({ key, ...p, avg: p.placeSum / p.n }))
    .sort((a, b) => b.wins - a.wins || a.avg - b.avg || b.n - a.n || byName(a.name, b.name));
  return { tours, summary };
}

function renderStats() {
  const s = seriesById(state.statsOpen);
  if (!s) { state.page = state.statsBack || 'tournament'; return render(); }
  const { tours, summary } = seriesStats(s.id);
  const medal = p => p === 1 ? 'r1' : p === 2 ? 'r2' : p === 3 ? 'r3' : '';
  const fmt1 = x => x.toLocaleString('fi-FI', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  app.innerHTML = `
  <div class="actions" style="margin:0 0 12px"><button id="backBtn">← Takaisin</button></div>
  <section class="card">
    <h2>📊 ${esc(s.name)}</h2>
    <p class="muted" style="margin:0">${s.format === 'americano' ? 'Americano' : 'Mexicano'} · ${s.points} p · ${tours.length} pelattua turnausta${tours.length ? ` (${fmtDay(tours[0].h.date)}–${fmtDay(tours[tours.length - 1].h.date)})` : ''}</p>
    <p style="margin:8px 0 0"><b>Vakio-osallistujat (${s.players.length}):</b> ${[...s.players].sort(byName).map(esc).join(', ')}</p>
    <div class="btnrow">
      <button id="playSeriesBtn" class="primary">▶ Uusi turnaus</button>
      ${tours.length ? '<button id="shareSeriesBtn">📤 Jaa tilastot</button>' : ''}
      <button id="renameSeriesBtn">✏️ Nimeä</button>
      ${canDeleteSeries() ? '<button id="delSeriesBtn" class="danger">🗑 Poista</button>' : ''}
    </div>
  </section>
  ${!tours.length ? '<section class="card"><p class="muted" style="margin:0">Ei vielä valmiita turnauksia. Tilastot täyttyvät, kun tämän vakioturnauksen turnauksia pelataan loppuun.</p></section>' : `
  <section class="card">
    <h2>Kokonaistilanne</h2>
    <div class="scroll-x">
    <table class="stats">
      <thead><tr><th>#</th><th>Pelaaja</th><th title="Osallistumiset">Turn.</th><th title="Turnausvoitot">🏆</th><th title="Mitalisijat">Top 3</th><th title="Keskimääräinen sijoitus">Ka. sija</th><th title="Paras sijoitus">Paras</th><th title="Pisteitä per ottelu">P/ott.</th><th title="Ottelujen voittoprosentti">V-%</th></tr></thead>
      <tbody>${summary.map((p, i) => `<tr>
        <td>${i + 1}</td><td>${playerLink(p.name)}</td><td>${p.n}</td><td class="pts">${p.wins}</td><td>${p.podiums}</td>
        <td>${fmt1(p.avg)}</td><td>${p.best}.</td><td>${p.games ? fmt1(p.pts / p.games) : '–'}</td><td>${p.games ? Math.round(100 * p.w / p.games) : 0} %</td></tr>`).join('')}
      </tbody>
    </table>
    </div>
    <p class="muted small">Järjestys: turnausvoitot, keskimääräinen sijoitus. P/ott. = pisteitä ottelua kohden, V-% = voitettujen otteluiden osuus.</p>
  </section>
  ${(() => {
    const years = [...new Set(tours.map(t => (t.h.date || '').slice(0, 4)))].sort().reverse();
    const yr = years.includes(String(state.seasonYear)) ? String(state.seasonYear) : years[0];
    const rows = seasonTable(s.id, yr === 'kaikki' ? null : yr);
    return `
  <section class="card">
    <h2>🏅 Kauden pistepörssi</h2>
    <div class="seg" style="margin-bottom:8px">
      ${years.map(y => `<button data-season="${y}" class="${y === yr ? 'on' : ''}">${y}</button>`).join('')}
    </div>
    <table class="stats">
      <thead><tr><th>#</th><th>Pelaaja</th><th title="Kauden pisteet">Pist.</th><th title="Osallistumiset">Turn.</th><th title="Turnausvoitot">🏆</th></tr></thead>
      <tbody>${rows.map((p, i) => `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td><td>${playerLink(p.name)}</td><td class="pts">${p.sp}</td><td>${p.n}</td><td>${p.wins}</td></tr>`).join('')}</tbody>
    </table>
    <p class="muted small">Pisteet sijoituksen mukaan jokaisesta turnauksesta: ${SEASON_POINTS.map((p, i) => `${i + 1}. ${p}`).join(', ')}, muut 1 piste.</p>
  </section>`;
  })()}
  <section class="card">
    <h2>Sijoitukset päivämäärittäin</h2>
    <div class="scroll-x">
    <table class="matrix">
      <thead><tr><th>Pelaaja</th>${tours.map(t => `<th>${fmtShort(t.h.date)}</th>`).join('')}</tr></thead>
      <tbody>${summary.map(p => `<tr><td>${playerLink(p.name)}</td>${tours.map(t => {
        const r = t.byName.get(p.key);
        return r ? `<td><span class="rank ${medal(r.place)}">${r.place}</span><div class="small muted">${r.pts}</div></td>` : '<td class="muted">–</td>';
      }).join('')}</tr>`).join('')}
      </tbody>
    </table>
    </div>
    <p class="muted small">Ylempi luku on sijoitus, alempi turnauksen kokonaispisteet. – = ei osallistunut.</p>
  </section>
  <section class="card">
    <h2>Lopputulokset</h2>
    ${[...tours].reverse().map(t => `
    <button class="hist" data-openh="${t.h.id}" style="border:1px solid var(--line)">
      <div class="top"><span>${esc(fmtDate(t.h.date))}</span><span class="tag">${t.rows.length} pelaajaa</span></div>
      <div>🏆 <b>${esc(t.rows[0].name)}</b> (${t.rows[0].pts} p)</div>
      <div class="muted small">${t.rows.map((r, i) => `${i + 1}. ${esc(r.name)} ${r.pts}`).join(' · ')}</div>
    </button>`).join('')}
  </section>`}`;
  document.getElementById('backBtn').onclick = () => { state.page = state.statsBack || 'tournament'; state.statsOpen = null; save(); render(); window.scrollTo(0, 0); };
  document.getElementById('playSeriesBtn').onclick = () => {
    if (state.phase === 'play' && !finished() && !confirm('Toinen turnaus on kesken. Jätetäänkö se historiaan ja aloitetaan uusi?')) return;
    if (state.phase === 'play') { state.phase = 'setup'; state.rounds = []; state.tid = null; state.startedAt = null; state.schedule = null; state.roundsTarget = state.baseTarget = null; state.view = 'matches'; state.shownRound = 0; }
    selectSeries(s.id);
    state.page = 'tournament'; state.statsOpen = null;
    save(); render(); window.scrollTo(0, 0);
  };
  app.querySelectorAll('[data-season]').forEach(b => b.onclick = () => { state.seasonYear = b.dataset.season; save(); render(); });
  const shs = document.getElementById('shareSeriesBtn');
  if (shs) shs.onclick = () => openShare('Jaa tilastot', seriesText(s.id), null, '');
  document.getElementById('renameSeriesBtn').onclick = () => {
    const name = (prompt('Vakioturnauksen nimi:', s.name) || '').trim().slice(0, 40);
    if (!name || name === s.name) return;
    if (db.series.some(x => x !== s && same(x.name, name))) { alert('Tällä nimellä on jo vakioturnaus.'); return; }
    s.name = name; saveDb(); render();
  };
  const dsb = document.getElementById('delSeriesBtn');
  if (dsb) dsb.onclick = () => {
    if (!confirm(`Poistetaanko vakioturnaus "${s.name}"? Turnaukset säilyvät historiassa, mutta niitä ei enää koota tähän tilastoon.`)) return;
    db.series = db.series.filter(x => x !== s);
    db.history.forEach(h => { if (h.seriesId === s.id) h.seriesId = null; });
    if (state.seriesId === s.id) state.seriesId = null;
    state.page = state.statsBack === 'stats' ? 'tournament' : (state.statsBack || 'tournament'); state.statsOpen = null;
    save(); render();
  };
  app.querySelectorAll('[data-openh]').forEach(b => b.onclick = () => {
    state.page = 'history'; state.historyOpen = b.dataset.openh; save(); render(); window.scrollTo(0, 0);
  });
}

function selectSeries(id) {
  const s = seriesById(id); if (!s) return;
  state.seriesId = s.id;
  state.players = s.players.map(name => ({ id: state.nextId++, name }));
  s.players.forEach(rememberPlayer);
  state.format = s.format || state.format;
  state.points = s.points || state.points;
}

/* ---------- pilvisynkronointi (cloud.js) ---------- */
const roundsKey = rounds => stable((rounds || []).map(r => [r.byes, r.matches.map(m => [m.court, m.a, m.b, m.sa, m.sb])]));

/* Toisella puhelimella tehdyt muutokset käynnissä olevaan turnaukseen. */
function mergeCurrent() {
  if (state.phase !== 'play' || !state.tid) return false;
  const h = db.history.find(x => x.id === state.tid);
  if (!h) return false;
  if (roundsKey(h.rounds) === roundsKey(state.rounds) && h.roundsTarget === state.roundsTarget && (h.seriesId || null) === (state.seriesId || null)) return false;
  const wasLast = state.shownRound >= state.rounds.length - 1;
  state.rounds = h.rounds.map(r => ({ matches: r.matches.map(m => ({ court: m.court, a: m.a, b: m.b, sa: m.sa, sb: m.sb })), byes: r.byes }));
  if (h.roundsTarget) state.roundsTarget = h.roundsTarget;
  if (h.baseTarget) state.baseTarget = h.baseTarget;
  if (h.schedule) state.schedule = h.schedule;
  state.seriesId = h.seriesId || null;
  if (wasLast || state.shownRound > state.rounds.length - 1) state.shownRound = state.rounds.length - 1;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* */ }
  return true;
}

/* Päivitä näkymä keskeyttämättä kirjoittamista. */
function softRender() {
  if (picker.open) return; // valintaikkuna piirtää näkymän sulkeutuessaan
  const ae = document.activeElement;
  if (ae && ae.matches && ae.matches('input[data-m]') && state.page === 'tournament' && state.phase === 'play' && state.view === 'matches') {
    const ri = Math.min(state.shownRound, state.rounds.length - 1);
    const r = state.rounds[ri];
    if (r) {
      app.querySelectorAll('input[data-m]').forEach(inp => {
        if (inp === ae) return;
        const m = r.matches[+inp.dataset.m]; if (!m) return;
        const v = inp.dataset.side === 'a' ? m.sa : m.sb;
        inp.value = Number.isInteger(v) ? v : '';
      });
      refreshRoundStatus(r, ri);
    }
    ae.addEventListener('blur', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input')) render(); }, 0), { once: true });
    return;
  }
  if (ae && ae.matches && ae.matches('input[type=text], input[type=number], textarea')) return;
  render();
}

window.PadelApp = {
  getDb: () => db,
  applyRemote(kind, items) {
    if (kind === 'tournaments' && state.phase === 'play' && state.tid &&
        db.history.some(h => h.id === state.tid) && !items.some(h => h.id === state.tid)) {
      // käynnissä oleva turnaus poistettiin toisella laitteella: lopetetaan se täälläkin
      Object.assign(state, { phase: 'setup', rounds: [], tid: null, startedAt: null, schedule: null,
        roundsTarget: null, baseTarget: null, view: 'matches', shownRound: 0, seriesId: null });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* */ }
    }
    if (kind === 'tournaments') db.history = items;
    else db[kind] = items;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* */ }
    if (kind === 'tournaments') mergeCurrent();
    if (state.seriesId && kind === 'series' && !seriesById(state.seriesId)) state.seriesId = null;
    softRender();
  },
  cloudChanged() {
    if (state.page === 'history' || (state.page === 'tournament' && state.phase === 'setup')) softRender();
    else if (state.page === 'tournament' && state.phase === 'play') {
      const el = document.getElementById('cloudDot'); if (el) el.outerHTML = cloudDotHtml();
    }
  },
  offerJoin(gid, adminToken) {
    setTimeout(async () => {
      if (!confirm(`Liitytäänkö porukkaan${adminToken ? ' ylläpitäjänä' : ''}? Tämän puhelimen tallennetut tiedot yhdistetään porukan yhteisiin tietoihin.`)) return;
      try { await window.PadelCloud.joinGroup(gid, adminToken); state.page = 'history'; state.historyOpen = null; save(); render(); }
      catch (e) { alert(e.message || 'Liittyminen ei onnistunut.'); }
    }, 300);
  },
};

const cloudOn = () => !!(window.PadelCloud && window.PadelCloud.group);
const canDeleteTour = h => !cloudOn() || window.PadelCloud.isAdmin || !window.PadelCloud.hasAdmin || !h.finished;
const canDeleteSeries = () => !cloudOn() || window.PadelCloud.isAdmin || !window.PadelCloud.hasAdmin;
function cloudDotHtml() {
  if (!cloudOn()) return '<span id="cloudDot"></span>';
  const s = window.PadelCloud.status;
  const t = s === 'online' ? '☁️ live' : s === 'connecting' ? '☁️ yhdistetään…' : s === 'offline' ? '☁️ ei yhteyttä' : '☁️ virhe';
  return `<span id="cloudDot" class="cloud-dot ${s}">${t}</span>`;
}

/* Liity käynnissä olevaan turnaukseen (esim. toiselta puhelimelta aloitettu). */
function joinTournament(hid) {
  const h = db.history.find(x => x.id === hid);
  if (!h) return;
  if (state.phase === 'play' && state.tid !== hid && !finished() &&
      !confirm('Tällä puhelimella on kesken toinen turnaus. Se jää historiaan. Jatketaanko?')) return;
  Object.assign(state, {
    phase: 'play', format: h.format, points: h.points,
    players: h.players.map(p => ({ id: p.id, name: p.name })),
    rounds: h.rounds.map(r => ({ matches: r.matches.map(m => ({ court: m.court, a: m.a, b: m.b, sa: m.sa, sb: m.sb })), byes: r.byes })),
    roundsTarget: h.roundsTarget || h.rounds.length, baseTarget: h.baseTarget || h.roundsTarget || h.rounds.length,
    schedule: h.schedule || null, tid: h.id, startedAt: h.date, seriesId: h.seriesId || null,
    nextId: Math.max(0, ...h.players.map(p => p.id)) + 1,
    view: 'matches', shownRound: h.rounds.length - 1, page: 'tournament', historyOpen: null,
  });
  save(); render(); window.scrollTo(0, 0);
}
const liveTournaments = () => db.history.filter(h => !h.finished && h.id !== state.tid &&
  h.updated && Date.now() - new Date(h.updated).getTime() < 12 * 3600 * 1000);

function cloudCardHtml() {
  const C = window.PadelCloud;
  if (!C || !C.available) return '';
  if (!C.group) return `
  <section class="card">
    <h2>☁️ Yhteiset tiedot porukan kanssa</h2>
    <p class="muted small">Tallenna turnaukset pilveen, niin koko porukka näkee historian, vakioturnaukset ja tilastot. Käynnissä olevan turnauksen tulokset päivittyvät kaikkien puhelimiin livenä.</p>
    <div class="btnrow"><button id="cloudCreate" class="primary">Luo porukka</button><button id="cloudJoin">Liity porukkaan</button></div>
  </section>`;
  const s = C.status;
  const txt = s === 'online' ? '🟢 Yhdistetty – muutokset päivittyvät kaikille'
    : s === 'connecting' ? '🟡 Yhdistetään…'
    : s === 'offline' ? '🟡 Ei verkkoyhteyttä – muutokset tallentuvat ja lähetetään, kun yhteys palaa'
    : `🔴 Yhteysvirhe${C.error ? ` (${esc(C.error)})` : ''}`;
  return `
  <section class="card">
    <h2>☁️ Porukka: ${esc(C.group.name)}</h2>
    <p class="small" style="margin:0">${txt}</p>
    <p class="small" style="margin:6px 0 0">${C.isAdmin ? '👑 Olet ylläpitäjä – vain ylläpitäjä voi poistaa valmiita turnauksia ja vakioturnauksia.' : C.hasAdmin ? '👤 Jäsen – voit lisätä ja muokata tietoja. Poistot tekee ylläpitäjä.' : '⚠️ Porukalla ei ole vielä ylläpitäjää, joten kuka tahansa voi poistaa tietoja.'}</p>
    <div class="btnrow"><button id="cloudInvite" class="primary">📤 Kutsu porukkaan</button><button id="cloudLeave">Poistu</button></div>
    ${C.isAdmin && C.adminLink() ? '<div class="btnrow"><button id="cloudAdminLink">🔑 Jaa ylläpito toiselle laitteelle</button></div>' : ''}
    ${!C.isAdmin && !C.hasAdmin ? '<div class="btnrow"><button id="cloudClaim">👑 Ota ylläpito käyttöön</button></div>' : ''}
  </section>`;
}
function bindCloudCard() {
  const C = window.PadelCloud;
  const run = async (fn, okMsg) => {
    try { await fn(); if (okMsg) alert(okMsg); } catch (e) { alert((e && e.message) || 'Toiminto ei onnistunut.'); }
    render();
  };
  const cc = document.getElementById('cloudCreate');
  if (cc) cc.onclick = () => {
    const name = (prompt('Porukan nimi (esim. "Tiistain padel-porukka"):', '') || '').trim().slice(0, 40);
    if (name) run(() => C.createGroup(name), `Porukka "${name}" luotu ja tämän puhelimen tiedot tallennettu pilveen. Kutsu muut "Kutsu porukkaan" -painikkeella.`);
  };
  const cj = document.getElementById('cloudJoin');
  if (cj) cj.onclick = () => {
    const v = (prompt('Liitä kutsulinkki tai porukkakoodi:', '') || '').trim();
    const m = v.match(/([A-Za-z0-9]{20,})\s*$/);
    if (!v) return;
    if (!m) { alert('Koodi ei kelpaa. Liitä koko kutsulinkki.'); return; }
    run(() => C.joinGroup(m[1]), 'Liityit porukkaan. Tämän puhelimen tiedot yhdistettiin porukan tietoihin.');
  };
  const ci = document.getElementById('cloudInvite');
  if (ci) ci.onclick = () => openShare('Kutsu porukkaan',
    `🎾 Liity padel-porukkaan "${C.group.name}"!\nAvaa linkki puhelimella, niin näet turnaukset, tilastot ja live-tulokset:\n${C.inviteLink()}`, null, '');
  const cal = document.getElementById('cloudAdminLink');
  if (cal) cal.onclick = () => openShare('Jaa ylläpito',
    `🔑 Ylläpitäjälinkki porukkaan "${C.group.name}". Avaa tämä VAIN omalla toisella laitteellasi tai luotetulle henkilölle – linkillä voi poistaa porukan tietoja:
${C.adminLink()}`, null, '');
  const ccl = document.getElementById('cloudClaim');
  if (ccl) ccl.onclick = () => {
    if (!confirm('Otetaanko ylläpito käyttöön? Tästä laitteesta tulee porukan ylläpitäjä, ja vain ylläpitäjä voi jatkossa poistaa valmiita turnauksia ja vakioturnauksia.')) return;
    run(() => C.claimAdmin(), 'Olet nyt porukan ylläpitäjä. Voit jakaa ylläpidon toiselle laitteellesi "Jaa ylläpito" -painikkeella.');
  };
  const cl = document.getElementById('cloudLeave');
  if (cl) cl.onclick = () => {
    if (!confirm('Poistutaanko porukasta? Tiedot jäävät tähän puhelimeen, mutta eivät enää päivity muiden kanssa.')) return;
    C.leave(); render();
  };
}

/* ---------- asennettava sovellus (PWA) ---------- */
let installPrompt = null;
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installDismissed = () => { try { return !!localStorage.getItem('padel-install-dismissed'); } catch (e) { return false; } };
const rerenderSetup = () => { if (state.page === 'tournament' && state.phase === 'setup') render(); };

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; rerenderSetup(); });
window.addEventListener('appinstalled', () => { installPrompt = null; rerenderSetup(); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* ei offline-tukea */ }));
}

function installCardHtml() {
  if (isStandalone() || installDismissed()) return '';
  if (installPrompt) return `
  <div class="info install">
    <span>📲 Asenna sovellus puhelimeen: oma kuvake ja toimii myös ilman nettiä.</span>
    <div class="row"><button id="installBtn" class="primary">Asenna</button><button class="icon" id="installX" aria-label="Piilota">✕</button></div>
  </div>`;
  if (isIOS) return `
  <div class="info install">
    <span>📲 Asenna sovellus: napauta Safarin <b>Jaa</b>-painiketta <span aria-hidden="true">(⬆️)</span> ja valitse <b>Lisää Koti-valikkoon</b>.</span>
    <button class="icon" id="installX" aria-label="Piilota">✕</button>
  </div>`;
  return '';
}
function bindInstallCard() {
  const ib = document.getElementById('installBtn');
  if (ib) ib.onclick = async () => {
    const p = installPrompt; if (!p) return;
    p.prompt();
    try { await p.userChoice; } catch (e) { /* peruttu */ }
    installPrompt = null; render();
  };
  const x = document.getElementById('installX');
  if (x) x.onclick = () => { try { localStorage.setItem('padel-install-dismissed', '1'); } catch (e) { /* ei tallennusta */ } render(); };
}

/* ---------- pelaajatilastot, ranking (Elo) ja kauden pistepörssi ---------- */
const nameKey = n => String(n).toLocaleLowerCase('fi');
const RATING_START = 1000, RATING_K = 40;
const SEASON_POINTS = [10, 8, 6, 5, 4, 3, 2]; // sijat 1–7, muut 1 piste
const seasonPointsFor = place => SEASON_POINTS[place - 1] || 1;
const finishedTours = () => db.history.filter(h => h.finished).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

/* Elo-tyyppinen ranking otteluista: joukkueen vahvuus = pelaajien keskiarvo,
   tulos = pisteosuus (esim. 15–9 → 0,625), joten myös voiton marginaali vaikuttaa. */
function computeRatings() {
  const P = new Map(); // key -> { name, r, games, hist: [{date, r}] }
  const get = (players, id) => {
    const name = nameIn(players, id), key = nameKey(name);
    if (!P.has(key)) P.set(key, { key, name, r: RATING_START, games: 0, hist: [] });
    return P.get(key);
  };
  for (const h of finishedTours()) {
    const touched = new Set();
    for (const r of h.rounds) for (const m of r.matches) {
      if (!isScored(m, h.points) || m.sa + m.sb === 0) continue;
      const A = m.a.map(id => get(h.players, id)), B = m.b.map(id => get(h.players, id));
      const ra = (A[0].r + A[1].r) / 2, rb = (B[0].r + B[1].r) / 2;
      const exp = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const delta = RATING_K * (m.sa / (m.sa + m.sb) - exp);
      A.forEach(p => { p.r += delta; p.games++; touched.add(p); });
      B.forEach(p => { p.r -= delta; p.games++; touched.add(p); });
    }
    touched.forEach(p => p.hist.push({ date: h.date, r: p.r, tid: h.id }));
  }
  return P;
}
const ratingOf = (ratings, name) => { const p = ratings.get(nameKey(name)); return p ? p.r : RATING_START; };

function playerStats(key, seriesId) {
  const tours = finishedTours().filter(h => !seriesId || h.seriesId === seriesId);
  const res = { name: null, tours: [], games: 0, w: 0, d: 0, l: 0, pts: 0, partners: new Map(), opps: new Map() };
  const bump = (map, name, won, pts) => {
    const k = nameKey(name);
    if (!map.has(k)) map.set(k, { key: k, name, g: 0, w: 0, pts: 0 });
    const x = map.get(k); x.g++; if (won) x.w++; x.pts += pts;
  };
  for (const h of tours) {
    const me = h.players.find(p => nameKey(p.name) === key);
    if (!me) continue;
    res.name = me.name;
    const rows = computeStandings(h.players, h.rounds, h.points);
    const place = rows.findIndex(r => r.id === me.id) + 1;
    res.tours.push({ h, place, of: rows.length, pts: rows[place - 1].pts, series: h.seriesId && seriesById(h.seriesId) });
    for (const r of h.rounds) for (const m of r.matches) {
      if (!isScored(m, h.points)) continue;
      const inA = m.a.includes(me.id), inB = m.b.includes(me.id);
      if (!inA && !inB) continue;
      const own = inA ? m.sa : m.sb, opp = inA ? m.sb : m.sa;
      const mate = (inA ? m.a : m.b).find(id => id !== me.id);
      const won = own > opp;
      res.games++; res.pts += own;
      if (own > opp) res.w++; else if (own < opp) res.l++; else res.d++;
      bump(res.partners, nameIn(h.players, mate), won, own);
      (inA ? m.b : m.a).forEach(id => bump(res.opps, nameIn(h.players, id), won, own));
    }
  }
  return res;
}

function seasonTable(sid, year) {
  const rows = new Map();
  for (const h of finishedTours().filter(t => t.seriesId === sid && (!year || (t.date || '').startsWith(String(year))))) {
    computeStandings(h.players, h.rounds, h.points).forEach((r, i) => {
      const k = nameKey(r.name);
      if (!rows.has(k)) rows.set(k, { key: k, name: r.name, sp: 0, n: 0, wins: 0 });
      const x = rows.get(k); x.sp += seasonPointsFor(i + 1); x.n++; if (i === 0) x.wins++;
    });
  }
  return [...rows.values()].sort((a, b) => b.sp - a.sp || b.wins - a.wins || byName(a.name, b.name));
}

function openPlayer(key) {
  if (state.page !== 'player') state.playerBack = state.page;
  state.page = 'player'; state.playerOpen = key; state.playerFilter = null;
  save(); render(); window.scrollTo(0, 0);
}
const playerLink = name => `<button class="plink" data-player="${esc(nameKey(name))}">${esc(name)}</button>`;
app.addEventListener('click', e => {
  const b = e.target.closest('[data-player]');
  if (b) { e.preventDefault(); openPlayer(b.dataset.player); }
});

function renderPlayers() {
  const ratings = computeRatings();
  const list = [...ratings.values()].sort((a, b) => b.r - a.r || byName(a.name, b.name));
  const toursBy = new Map();
  for (const h of finishedTours()) h.players.forEach(p => toursBy.set(nameKey(p.name), (toursBy.get(nameKey(p.name)) || 0) + 1));
  app.innerHTML = `
  <section class="card">
    <h2>🏅 Ranking</h2>
    <p class="muted small" style="margin-top:0">Ranking lasketaan kaikista pelatuista otteluista. Kaikki aloittavat ${RATING_START}:sta. Voitto vahvempaa paria vastaan nostaa enemmän, ja myös voiton marginaali vaikuttaa. Napauta pelaajaa nähdäksesi pelaajakortin.</p>
    ${list.length ? `
    <table class="stats">
      <thead><tr><th>#</th><th>Pelaaja</th><th>Ranking</th><th title="Ottelut">O</th><th title="Turnaukset">Turn.</th></tr></thead>
      <tbody>${list.map((p, i) => `<tr><td>${i + 1}</td><td>${playerLink(p.name)}</td><td class="pts">${Math.round(p.r)}</td><td>${p.games}</td><td>${toursBy.get(p.key) || 0}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="muted" style="margin:0">Ei vielä pelattuja turnauksia.</p>'}
  </section>`;
}

/* Viivakaavio (yksi sarja): SVG, kosketus/hover näyttää arvon. */
function lineChart(points, { invert = false, yMin, yMax, fmt = v => v, label }) {
  if (points.length < 2) return '<p class="muted small">Kaavio näkyy, kun pelattuja turnauksia on vähintään kaksi.</p>';
  const W = 340, H = 190, L = 40, R = 14, T = 20, B = 28;
  const lo = yMin ?? Math.min(...points.map(p => p.y)), hi = yMax ?? Math.max(...points.map(p => p.y));
  const span = hi - lo || 1;
  const x = i => L + (W - L - R) * (i / (points.length - 1));
  const y = v => invert ? T + (H - T - B) * ((v - lo) / span) : T + (H - T - B) * (1 - (v - lo) / span);
  const ticks = invert
    ? [...new Set([lo, Math.round((lo + hi) / 2), hi])]
    : [lo, lo + span / 2, hi].map(v => Math.round(v));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const lastI = points.length - 1;
  const xl = [0, lastI].map(i => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i ? 'end' : 'start'}" class="ax">${esc(points[i].label)}</text>`).join('');
  return `
  <div class="chart" data-points='${esc(JSON.stringify(points.map((p, i) => ({ x: x(i) / W, y: y(p.y) / H, t: `${p.label}: ${fmt(p.y)}${p.note ? ' · ' + p.note : ''}` }))))}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${fmt(v)}</text>`).join('')}
      <path d="${path}" class="line"/>
      ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="${i === lastI ? 6 : 4.5}" class="dot"/>`).join('')}
      <text x="${Math.min(x(lastI), W - R)}" y="${y(points[lastI].y) - 12}" text-anchor="end" class="endlabel">${fmt(points[lastI].y)}</text>
      ${xl}
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}
function bindCharts() {
  app.querySelectorAll('.chart').forEach(ch => {
    const pts = JSON.parse(ch.dataset.points), tip = ch.querySelector('.tip'), svg = ch.querySelector('svg');
    const show = ev => {
      const rect = svg.getBoundingClientRect();
      const fx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width;
      let best = pts[0]; for (const p of pts) if (Math.abs(p.x - fx) < Math.abs(best.x - fx)) best = p;
      tip.hidden = false; tip.textContent = best.t;
      tip.style.left = Math.min(Math.max(best.x * rect.width, 60), rect.width - 60) + 'px';
      tip.style.top = (best.y * rect.height - 8) + 'px';
    };
    ch.addEventListener('pointermove', show); ch.addEventListener('pointerdown', show);
    ch.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}

function renderPlayer() {
  const key = state.playerOpen;
  const ratings = computeRatings();
  const rp = ratings.get(key);
  const filter = state.playerFilter && seriesById(state.playerFilter) ? state.playerFilter : null;
  const st = playerStats(key, filter);
  const all = filter ? playerStats(key, null) : st;
  const name = st.name || all.name || (rp && rp.name) || key;
  const seriesIds = [...new Set(all.tours.map(t => t.h.seriesId).filter(id => id && seriesById(id)))];
  const pct = (w, g) => g ? Math.round(100 * w / g) + ' %' : '–';
  const fmt1 = v => v.toLocaleString('fi-FI', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nT = st.tours.length;
  const wins = st.tours.filter(t => t.place === 1).length, podiums = st.tours.filter(t => t.place <= 3).length;
  const avgPlace = nT ? st.tours.reduce((a, t) => a + t.place, 0) / nT : 0;
  const minG = arr => arr.some(x => x.g >= 2) ? 2 : 1;
  const partners = [...st.partners.values()].sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g);
  const opps = [...st.opps.values()].sort((a, b) => a.w / a.g - b.w / b.g || b.g - a.g);
  const bestP = partners.find(p => p.g >= minG(partners));
  const worstO = opps.find(p => p.g >= minG(opps));
  const placePts = st.tours.map(t => ({ y: t.place, label: fmtShort(t.h.date), note: `${t.place}./${t.of}${t.series ? ' ' + t.series.name : ''}` }));
  const ratingPts = rp ? rp.hist.filter(x => !filter || (db.history.find(h => h.id === x.tid) || {}).seriesId === filter)
    .map(x => ({ y: Math.round(x.r), label: fmtShort(x.date) })) : [];
  const maxOf = Math.max(4, ...st.tours.map(t => t.of));
  app.innerHTML = `
  <div class="actions" style="margin:0 0 12px"><button id="backBtn">← Takaisin</button></div>
  <section class="card">
    <h2>👤 ${esc(name)}</h2>
    <div class="kpis">
      <div><span class="kv">${rp ? Math.round(rp.r) : RATING_START}</span><span class="kl">Ranking</span></div>
      <div><span class="kv">${nT}</span><span class="kl">Turnaukset</span></div>
      <div><span class="kv">${wins}</span><span class="kl">🏆 Voitot</span></div>
      <div><span class="kv">${nT ? fmt1(avgPlace) : '–'}</span><span class="kl">Ka. sija</span></div>
      <div><span class="kv">${pct(st.w, st.games)}</span><span class="kl">Ottelu-V-%</span></div>
      <div><span class="kv">${st.games ? fmt1(st.pts / st.games) : '–'}</span><span class="kl">Pist./ottelu</span></div>
    </div>
    <p class="muted small" style="margin:8px 0 0">${st.games} ottelua: ${st.w} voittoa, ${st.d ? st.d + ' tasapeliä, ' : ''}${st.l} tappiota · ${podiums} mitalisijaa</p>
    ${seriesIds.length ? `
    <div class="seg" style="margin-top:10px">
      <button data-pfilter="" class="${filter ? '' : 'on'}">Kaikki</button>
      ${seriesIds.map(id => `<button data-pfilter="${id}" class="${filter === id ? 'on' : ''}">${esc(seriesById(id).name)}</button>`).join('')}
    </div>` : ''}
  </section>
  ${nT ? `
  <section class="card">
    <h2>Parhaat kumppanit ja vastustajat</h2>
    <div class="duo">
      <div class="info"><div class="kl">🤝 Paras pari</div>${bestP ? `<b>${esc(bestP.name)}</b><div class="small">${pct(bestP.w, bestP.g)} voittoja · ${bestP.g} ottelua</div>` : '–'}</div>
      <div class="info"><div class="kl">😤 Vaikein vastustaja</div>${worstO ? `<b>${esc(worstO.name)}</b><div class="small">${pct(worstO.w, worstO.g)} voittoja · ${worstO.g} ottelua</div>` : '–'}</div>
    </div>
    <p class="section-label" style="margin-top:14px">Parina</p>
    <div class="scroll-x"><table class="stats">
      <thead><tr><th>#</th><th>Pari</th><th>O</th><th>V-%</th><th>P/ott.</th></tr></thead>
      <tbody>${partners.map((p, i) => `<tr><td>${i + 1}</td><td>${playerLink(p.name)}</td><td>${p.g}</td><td class="pts">${pct(p.w, p.g)}</td><td>${fmt1(p.pts / p.g)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="section-label" style="margin-top:14px">Vastustajana</p>
    <div class="scroll-x"><table class="stats">
      <thead><tr><th>#</th><th>Vastustaja</th><th>O</th><th>V-%</th></tr></thead>
      <tbody>${[...opps].reverse().map((p, i) => `<tr><td>${i + 1}</td><td>${playerLink(p.name)}</td><td>${p.g}</td><td class="pts">${pct(p.w, p.g)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="muted small">V-% = voitettujen otteluiden osuus kyseisen pelaajan kanssa / häntä vastaan. Paras pari ja vaikein vastustaja vaativat vähintään kaksi yhteistä ottelua, jos sellaisia on.</p>
  </section>
  <section class="card">
    <h2>📈 Sijoitukset ajan mittaan</h2>
    ${lineChart(placePts, { invert: true, yMin: 1, yMax: maxOf, fmt: v => v + '.', label: 'Sijoitus turnauksittain' })}
    <h2 style="margin-top:16px">Ranking ajan mittaan</h2>
    ${lineChart(ratingPts, { label: 'Ranking turnauksittain' })}
    <p class="muted small">Napauta kaaviota nähdäksesi yksittäisen turnauksen arvon.</p>
  </section>
  <section class="card">
    <h2>Turnaukset</h2>
    ${[...st.tours].reverse().map(t => `
    <button class="hist" data-openh="${t.h.id}" style="border:1px solid var(--line)">
      <div class="top"><span>${esc(fmtDate(t.h.date))}</span><span class="tag">${t.place}. / ${t.of}</span></div>
      <div class="muted small">${t.series ? '⭐ ' + esc(t.series.name) + ' · ' : ''}${fmtName(t.h.format)} · ${t.pts} p</div>
    </button>`).join('')}
  </section>` : '<section class="card"><p class="muted" style="margin:0">Ei vielä pelattuja turnauksia.</p></section>'}`;
  document.getElementById('backBtn').onclick = () => { state.page = state.playerBack && state.playerBack !== 'player' ? state.playerBack : 'players'; save(); render(); window.scrollTo(0, 0); };
  app.querySelectorAll('[data-pfilter]').forEach(b => b.onclick = () => { state.playerFilter = b.dataset.pfilter || null; save(); render(); });
  app.querySelectorAll('[data-openh]').forEach(b => b.onclick = () => { state.page = 'history'; state.historyOpen = b.dataset.openh; save(); render(); window.scrollTo(0, 0); });
  bindCharts();
}

/* ---------- tulosten jakaminen (teksti WhatsAppiin, kuva) ---------- */
const fmtName = f => f === 'americano' ? 'Americano' : 'Mexicano';
const medalEmoji = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const kpl = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function resultsText(h) {
  const rows = computeStandings(h.players, h.rounds, h.points);
  const played = h.rounds.filter(r => roundComplete(r, h.points)).length;
  const s = h.seriesId && seriesById(h.seriesId);
  const lines = [
    `🎾 *${s ? s.name : 'Padel ' + fmtName(h.format)}* – ${fmtDay(h.date)}`,
    `${fmtName(h.format)} · ${h.points} p · ${h.players.length} pelaajaa · ${kpl(played, 'kierros', 'kierrosta')}`,
    h.finished ? '*Lopputulokset*' : `*Tilanne ${played}. kierroksen jälkeen*`,
    '',
    ...rows.map((r, i) => `${medalEmoji(i)} ${r.name} – ${r.pts} p (${r.w}/${r.played} V)`),
  ];
  return lines.join('\n');
}

function seriesText(sid) {
  const s = seriesById(sid);
  const { tours, summary } = seriesStats(sid);
  const fmt1 = x => x.toLocaleString('fi-FI', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const lines = [
    `🎾 *${s.name}* – tilastot`,
    `${kpl(tours.length, 'turnaus', 'turnausta')}${tours.length ? ` (${fmtDay(tours[0].h.date)}–${fmtDay(tours[tours.length - 1].h.date)})` : ''}`,
    '',
    ...summary.map((p, i) => `${medalEmoji(i)} ${p.name} – 🏆 ${p.wins} · ka. sija ${fmt1(p.avg)} · ${p.n} turn.`),
  ];
  if (tours.length) {
    lines.push('', '*Voittajat*');
    [...tours].reverse().forEach(t => lines.push(`${fmtShort(t.h.date)} ${t.rows[0].name} (${t.rows[0].pts} p)`));
  }
  return lines.join('\n');
}

/* Tulostaulukko kuvaksi (PNG), aina vaalealla sinisellä teemalla. */
function resultsImage(h) {
  const rows = computeStandings(h.players, h.rounds, h.points);
  const played = h.rounds.filter(r => roundComplete(r, h.points)).length;
  const s = h.seriesId && seriesById(h.seriesId);
  const W = 1080, PAD = 64, HEAD = 280, ROW = 86, FOOT = 110;
  const H = HEAD + rows.length * ROW + FOOT;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fit = (text, max) => { let t = text; while (t.length > 1 && g.measureText(t).width > max) t = t.slice(0, -1); return t === text ? t : t.slice(0, -1) + '…'; };
  g.fillStyle = '#eaf2fc'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, HEAD);
  grad.addColorStop(0, '#1849b8'); grad.addColorStop(.55, '#1d63e0'); grad.addColorStop(1, '#1393d8');
  g.fillStyle = grad; g.fillRect(0, 0, W, HEAD - 40);
  g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
  g.font = font(800, 58); g.fillText(fit('🎾 ' + (s ? s.name : 'Padel ' + fmtName(h.format)), W - 2 * PAD), PAD, 104);
  g.font = font(500, 34); g.fillText(fmtDate(h.date), PAD, 160);
  g.font = font(600, 32); g.globalAlpha = .9;
  g.fillText(h.finished ? 'Lopputulokset' : `Tilanne ${played}. kierroksen jälkeen`, PAD, 206); g.globalAlpha = 1;
  // tulosrivit valkoisella kortilla
  const top = HEAD - 10, cardH = rows.length * ROW + 20;
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect ? g.roundRect(PAD - 24, top - 10, W - 2 * PAD + 48, cardH, 28) : g.rect(PAD - 24, top - 10, W - 2 * PAD + 48, cardH); g.fill();
  const medals = ['#d4a017', '#9aa3a8', '#b87333'];
  rows.forEach((r, i) => {
    const y = top + i * ROW;
    if (i % 2 === 1) { g.fillStyle = '#f3f7fd'; g.fillRect(PAD - 24, y, W - 2 * PAD + 48, ROW); }
    const cy = y + ROW / 2;
    g.beginPath(); g.arc(PAD + 26, cy, 26, 0, Math.PI * 2);
    g.fillStyle = i < 3 ? medals[i] : '#dbe8fc'; g.fill();
    g.fillStyle = i < 3 && i !== 2 ? '#000000' : i === 2 ? '#ffffff' : '#12233d';
    g.font = font(800, 28); g.textAlign = 'center'; g.fillText(String(i + 1), PAD + 26, cy + 10);
    g.textAlign = 'left'; g.fillStyle = '#12233d'; g.font = font(i === 0 ? 800 : 600, 38);
    g.fillText(fit(r.name, W - 2 * PAD - 420), PAD + 80, cy + 13);
    g.textAlign = 'right'; g.font = font(800, 40); g.fillStyle = '#1d5fd1';
    g.fillText(`${r.pts} p`, W - PAD, cy + 14);
    g.font = font(500, 26); g.fillStyle = '#586a84';
    g.fillText(`${r.w}/${r.played} V`, W - PAD - 150, cy + 10);
    g.textAlign = 'left';
  });
  g.font = font(500, 28); g.fillStyle = '#586a84';
  g.fillText(`${fmtName(h.format)} · ${h.points} p · ${h.players.length} pelaajaa · ${kpl(played, 'kierros', 'kierrosta')}`, PAD, H - 46);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

async function copyText(text, area) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* vara */ }
  try { area.select(); return document.execCommand('copy'); } catch (e) { return false; }
}

function openShare(title, text, imageFn, fileBase) {
  picker.innerHTML = `
  <div class="dlg">
    <div class="dlg-head">
      <h2 id="pickerTitle">📤 ${esc(title)}</h2>
      <button class="icon" id="shClose" aria-label="Sulje">✕</button>
    </div>
    <div class="dlg-body">
      <textarea id="shText" class="share-text" readonly rows="10">${esc(text)}</textarea>
      <div class="share-grid">
        ${navigator.share ? '<button id="shNative" class="primary">📤 Jaa…</button>' : ''}
        <button id="shWa">💬 WhatsApp</button>
        <button id="shCopy">📋 Kopioi teksti</button>
        ${imageFn ? '<button id="shImg">🖼 Jaa kuvana</button>' : ''}
      </div>
      <p id="shMsg" class="muted small" role="status"></p>
      ${imageFn ? '<img id="shPreview" class="share-preview" alt="Tuloskuvan esikatselu">' : ''}
    </div>
  </div>`;
  if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
  const msg = t => { document.getElementById('shMsg').textContent = t; };
  const area = document.getElementById('shText');
  document.getElementById('shClose').onclick = closePicker;
  const nat = document.getElementById('shNative');
  if (nat) nat.onclick = async () => { try { await navigator.share({ text }); } catch (e) { /* peruttu */ } };
  document.getElementById('shWa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  document.getElementById('shCopy').onclick = async () => msg(await copyText(text, area) ? '✓ Kopioitu leikepöydälle – liitä viestiin.' : 'Kopiointi ei onnistunut, valitse teksti käsin.');
  if (!imageFn) return;
  let blob = null;
  imageFn().then(b => {
    blob = b;
    const img = document.getElementById('shPreview');
    if (img && b) img.src = URL.createObjectURL(b);
  });
  document.getElementById('shImg').onclick = async () => {
    if (!blob) return msg('Kuvaa luodaan vielä…');
    const file = new File([blob], `${fileBase}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { /* peruttu */ }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      msg('✓ Kuva ladattu – voit liittää sen viestiin.');
    }
  };
}

function shareResults(hid) {
  const h = db.history.find(x => x.id === hid);
  if (!h) return;
  openShare(h.finished ? 'Jaa tulokset' : 'Jaa tilanne', resultsText(h), () => resultsImage(h), `padel-tulokset-${(h.date || '').slice(0, 10)}`);
}

function exportDb() {
  const data = JSON.stringify({ app: 'padel-turnaus', version: 1, exported: new Date().toISOString(), ...db }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `padel-varmuuskopio-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importDb(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let d;
    try { d = JSON.parse(reader.result); } catch (e) { alert('Tiedostoa ei voitu lukea.'); return; }
    if (!d || !Array.isArray(d.players) || !Array.isArray(d.lists) || !Array.isArray(d.history)) {
      alert('Tiedosto ei ole tämän sovelluksen varmuuskopio.'); return;
    }
    let added = 0;
    d.players.forEach(n => { if (typeof n === 'string') rememberPlayer(n); });
    d.lists.forEach(l => {
      if (!l || !l.name || !Array.isArray(l.players)) return;
      const ex = db.lists.find(x => same(x.name, l.name));
      if (ex) ex.players = l.players; else db.lists.push({ id: l.id || newId(), name: l.name, players: l.players });
    });
    (Array.isArray(d.series) ? d.series : []).forEach(s => {
      if (!s || !s.id || !s.name || !Array.isArray(s.players)) return;
      if (!db.series.some(x => x.id === s.id)) db.series.push(s);
    });
    d.history.forEach(h => {
      if (!h || !h.id || !Array.isArray(h.players) || !Array.isArray(h.rounds)) return;
      if (!db.history.some(x => x.id === h.id)) { db.history.push(h); added++; }
    });
    saveDb(); render();
    alert(`Tuonti valmis: ${added} uutta turnausta, ${d.lists.length} listaa.`);
  };
  reader.readAsText(file);
}

migrate();
render();
