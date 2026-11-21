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
  schedule: null,            // Americano: koko ohjelma etukäteen
});
const defaultDb = () => ({ players: [], lists: [], history: [] });

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
      updated: new Date().toISOString(),
      format: state.format,
      points: state.points,
      courts: activeCourts(),
      roundsTarget: state.roundsTarget,
      players: state.players.map(p => ({ id: p.id, name: p.name })),
      rounds: state.rounds,
      finished: finished(),
    };
    const i = db.history.findIndex(h => h.id === state.tid);
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
  const order = state.rounds.length === 0
    ? shuffle(state.players.map(p => p.id))
    : standings().map(x => x.id);
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
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === state.page));
  if (state.page === 'history') renderHistory();
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
  app.innerHTML = `
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
      : 'Ensimmäinen kierros arvotaan. Sen jälkeen kentät muodostetaan sarjataulukon mukaan: 1.+4. vs 2.+3. jokaisella kentällä.'}</p>
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
    <p class="muted subtitle">${state.format === 'americano' ? 'Americano' : 'Mexicano'} · ${state.points} p · ${state.players.length} pelaajaa · ${activeCourts()} kenttä${activeCourts() === 1 ? '' : 'ä'}</p>
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
    state.roundsTarget = state.baseTarget = null; state.tid = null; state.startedAt = null; state.schedule = null;
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
      <button id="tableBtn" class="primary big">Näytä lopputulokset</button>
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
  const r = state.rounds[ri];
  app.querySelectorAll('[data-round]').forEach(b => b.onclick = () => { state.shownRound = +b.dataset.round; save(); render(); });
  app.querySelectorAll('input[data-m]').forEach(inp => {
    inp.addEventListener('input', () => {
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
  const tb = document.getElementById('tableBtn');
  if (tb) tb.onclick = () => { state.view = 'table'; save(); render(); window.scrollTo(0, 0); };
  const undo = document.getElementById('undoBtn');
  if (undo) undo.onclick = () => {
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
          <td>${esc(x.name)}${x.byes ? ` <span class="muted small">(${x.byes} tauko${x.byes > 1 ? 'a' : ''})</span>` : ''}</td>
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
    <p class="muted small">Turnaukset ja tulokset tallentuvat tähän automaattisesti. Tiedot säilyvät tämän laitteen selaimessa.</p>
  </section>
  ${items.map(x => {
    const top = computeStandings(x.players, x.rounds, x.points)[0];
    const played = x.rounds.filter(r => roundComplete(r, x.points)).length;
    return `
    <button class="hist card" data-open="${x.id}">
      <div class="top"><span>${esc(fmtDate(x.date))}</span>
        <span class="tag ${x.finished ? '' : 'open'}">${x.finished ? 'Valmis' : 'Kesken'}</span></div>
      <div class="muted">${x.format === 'americano' ? 'Americano' : 'Mexicano'} · ${x.points} p · ${x.players.length} pelaajaa · ${played}/${Math.max(x.roundsTarget || 0, x.rounds.length)} kierrosta</div>
      ${top && top.played ? `<div>${x.finished ? '🏆' : 'Johdossa:'} <b>${esc(top.name)}</b> (${top.pts} p)</div>` : ''}
    </button>`;
  }).join('') || '<p class="muted">Ei vielä tallennettuja turnauksia.</p>'}
  <section class="card">
    <h2>Varmuuskopio</h2>
    <p class="muted small">Vie kaikki tiedot (pelaajat, listat ja historia) tiedostoon, tai tuo ne toiselle laitteelle.</p>
    <div class="btnrow">
      <button id="exportBtn">⬇ Vie tiedostoon</button>
      <button id="importBtn">⬆ Tuo tiedostosta</button>
    </div>
    <input id="importFile" type="file" accept="application/json,.json" hidden>
  </section>`;
  app.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { state.historyOpen = b.dataset.open; save(); render(); window.scrollTo(0, 0); });
  document.getElementById('exportBtn').onclick = exportDb;
  const file = document.getElementById('importFile');
  document.getElementById('importBtn').onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) importDb(file.files[0]); };
}

function renderHistoryDetail(h) {
  const isCurrent = state.phase === 'play' && state.tid === h.id;
  const nm = id => esc(nameIn(h.players, id));
  const total = Math.max(h.roundsTarget || 0, h.rounds.length);
  app.innerHTML = `
  <div class="actions" style="margin:0 0 12px"><button id="backBtn">← Takaisin historiaan</button></div>
  <section class="card">
    <h2>${esc(fmtDate(h.date))} <span class="tag ${h.finished ? '' : 'open'}">${h.finished ? 'Valmis' : 'Kesken'}</span></h2>
    <p class="muted" style="margin:0">${h.format === 'americano' ? 'Americano' : 'Mexicano'} · ${h.points} p · ${h.courts} kenttä${h.courts === 1 ? '' : 'ä'}</p>
    <p style="margin:8px 0 0"><b>Osallistujat (${h.players.length}):</b> ${h.players.map(p => esc(p.name)).sort(byName).join(', ')}</p>
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
    <button id="delHistBtn" class="danger">Poista turnaus historiasta</button>
  </div>`;
  document.getElementById('backBtn').onclick = () => { state.historyOpen = null; save(); render(); };
  const cont = document.getElementById('continueBtn');
  if (cont) cont.onclick = () => { state.page = 'tournament'; state.historyOpen = null; save(); render(); window.scrollTo(0, 0); };
  document.getElementById('delHistBtn').onclick = () => {
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
