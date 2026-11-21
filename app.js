'use strict';
/* Padel-turnaus: Americano & Mexicano. Kaikki tila tallennetaan localStorageen. */

const STORAGE_KEY = 'padel-turnaus-v1';
const POINT_PRESETS = [16, 21, 24, 32];

const defaultState = () => ({
  phase: 'setup',            // 'setup' | 'play'
  format: 'americano',       // 'americano' | 'mexicano'
  courts: 2,
  points: 24,
  roundsTarget: null,        // null = automaattinen suositus
  players: [],               // [{id, name}]
  rounds: [],                // [{matches:[{court,a:[id,id],b:[id,id],sa,sb}], byes:[id]}]
  nextId: 1,
  view: 'matches',           // 'matches' | 'table'
  shownRound: 0,
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* ei tallennusta */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ei tallennusta */ }
}

/* ---------- apufunktiot ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = id => (state.players.find(p => p.id === id) || { name: '?' }).name;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const activeCourts = () => Math.max(0, Math.min(state.courts, Math.floor(state.players.length / 4)));
const suggestedRounds = () => {
  const n = state.players.length;
  if (n < 4) return 0;
  return n % 4 === 0 ? n - 1 : n;
};
const roundsTarget = () => state.roundsTarget || suggestedRounds();

function isScored(m) {
  return Number.isInteger(m.sa) && Number.isInteger(m.sb) && m.sa >= 0 && m.sb >= 0 && m.sa + m.sb === state.points;
}
const roundComplete = r => r.matches.every(isScored);

/* ---------- sarjataulukko ---------- */
function standings() {
  const s = new Map();
  for (const p of state.players) s.set(p.id, { id: p.id, name: p.name, pts: 0, against: 0, played: 0, w: 0, d: 0, l: 0, byes: 0 });
  for (const r of state.rounds) {
    for (const id of r.byes) if (s.has(id)) s.get(id).byes++;
    for (const m of r.matches) {
      if (!isScored(m)) continue;
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
    y.pts - x.pts || y.w - x.w || (y.pts - y.against) - (x.pts - x.against) || x.name.localeCompare(y.name, 'fi'));
}

/* ---------- taukojen valinta ---------- */
function pickByes(count, order) {
  // order = pelaajat etusijajärjestyksessä (tasatilanteessa). Tauolle ne, joilla vähiten taukoja.
  if (count <= 0) return [];
  const byeCount = new Map(state.players.map(p => [p.id, 0]));
  const lastBye = new Map();
  state.rounds.forEach((r, i) => r.byes.forEach(id => { byeCount.set(id, (byeCount.get(id) || 0) + 1); lastBye.set(id, i); }));
  const idx = new Map(order.map((id, i) => [id, i]));
  const sorted = [...order].sort((a, b) =>
    byeCount.get(a) - byeCount.get(b) ||
    (lastBye.has(a) ? lastBye.get(a) : -1) - (lastBye.has(b) ? lastBye.get(b) : -1) ||
    idx.get(a) - idx.get(b));
  return sorted.slice(0, count);
}

/* ---------- Americano: mahdollisimman tasainen kumppani/vastustajajako ---------- */
function pairCounts() {
  const partner = new Map(), opp = new Map();
  const k = (a, b) => a < b ? a + '-' + b : b + '-' + a;
  const inc = (map, a, b) => map.set(k(a, b), (map.get(k(a, b)) || 0) + 1);
  for (const r of state.rounds) for (const m of r.matches) {
    inc(partner, m.a[0], m.a[1]); inc(partner, m.b[0], m.b[1]);
    for (const x of m.a) for (const y of m.b) inc(opp, x, y);
  }
  return { partner, opp, k };
}

function americanoRound() {
  const courts = activeCourts();
  const byes = pickByes(state.players.length - courts * 4, shuffle(state.players.map(p => p.id)));
  const active = state.players.map(p => p.id).filter(id => !byes.includes(id));
  const { partner, opp, k } = pairCounts();
  const pc = (a, b) => partner.get(k(a, b)) || 0;
  const oc = (a, b) => opp.get(k(a, b)) || 0;
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
  const restarts = 60;
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
  const r = state.format === 'americano' ? americanoRound() : mexicanoRound();
  state.rounds.push(r);
  state.shownRound = state.rounds.length - 1;
  state.view = 'matches';
  save(); render(); window.scrollTo(0, 0);
}

/* ---------- näkymät ---------- */
const app = document.getElementById('app');
const badge = document.getElementById('badge');
let setupError = '';

function render() {
  if (state.phase === 'setup') { badge.hidden = true; renderSetup(); }
  else {
    badge.hidden = false;
    badge.textContent = (state.format === 'americano' ? 'Americano' : 'Mexicano') + ' · ' + state.points + ' p';
    renderPlay();
  }
}

function renderSetup() {
  const n = state.players.length;
  const ac = activeCourts();
  const byes = n - ac * 4;
  const custom = !POINT_PRESETS.includes(state.points);
  app.innerHTML = `
  <section class="card">
    <h2>Pelaajat (${n})</h2>
    <form id="addForm" class="row">
      <input id="nameInput" class="grow" type="text" placeholder="Nimi (tai useampi pilkulla eroteltuna)" autocomplete="off" enterkeyhint="done">
      <button class="primary" type="submit">Lisää</button>
    </form>
    <div class="chips">
      ${state.players.map(p => `<span class="chip">${esc(p.name)}<button data-remove="${p.id}" aria-label="Poista ${esc(p.name)}">×</button></span>`).join('') || '<span class="muted">Ei vielä pelaajia. Tarvitaan vähintään 4.</span>'}
    </div>
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
    <h2>Kentät</h2>
    <div class="stepper">
      <button data-step="courts" data-d="-1" aria-label="Vähemmän kenttiä">−</button>
      <input id="courtsInput" type="number" inputmode="numeric" min="1" max="20" value="${state.courts}">
      <button data-step="courts" data-d="1" aria-label="Enemmän kenttiä">+</button>
    </div>
    <p class="muted">${n < 4 ? 'Lisää vähintään 4 pelaajaa.'
      : `Käytössä ${ac} kenttä${ac === 1 ? '' : 'ä'} kerrallaan${byes > 0 ? `, ${byes} pelaaja${byes === 1 ? '' : 'a'} tauolla joka kierroksella` : ', ei taukoja'}.`}
      ${n >= 4 && state.courts > ac ? ` (${state.courts} kenttään tarvittaisiin ${state.courts * 4} pelaajaa.)` : ''}</p>
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

  <section class="card">
    <h2>Kierroksia</h2>
    <div class="stepper">
      <button data-step="rounds" data-d="-1" aria-label="Vähemmän kierroksia">−</button>
      <input id="roundsInput" type="number" inputmode="numeric" min="1" max="99" value="${roundsTarget() || ''}">
      <button data-step="rounds" data-d="1" aria-label="Enemmän kierroksia">+</button>
    </div>
    <p class="muted">${n >= 4 ? `Suositus ${suggestedRounds()} kierrosta. ` : ''}Kierroksia voi lisätä myös turnauksen aikana.</p>
  </section>

  <button id="startBtn" class="primary big" ${n < 4 ? 'disabled' : ''}>Aloita turnaus</button>
  ${setupError ? `<p class="err">${esc(setupError)}</p>` : ''}
  `;

  document.getElementById('addForm').onsubmit = e => {
    e.preventDefault();
    const input = document.getElementById('nameInput');
    const names = input.value.split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
    setupError = '';
    for (const name of names) {
      if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { setupError = `Nimi "${name}" on jo listalla.`; continue; }
      state.players.push({ id: state.nextId++, name: name.slice(0, 40) });
      state.roundsTarget = null; // suositus lasketaan uudelleen
    }
    save(); render();
    document.getElementById('nameInput').focus();
  };
  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    state.players = state.players.filter(p => p.id !== +b.dataset.remove);
    state.roundsTarget = null;
    save(); render();
  });
  app.querySelectorAll('[data-format]').forEach(b => b.onclick = () => { state.format = b.dataset.format; save(); render(); });
  app.querySelectorAll('[data-points]').forEach(b => b.onclick = () => {
    if (b.dataset.points === 'custom') { if (POINT_PRESETS.includes(state.points)) state.points = 20; }
    else state.points = +b.dataset.points;
    save(); render();
  });
  const pi = document.getElementById('pointsInput');
  if (pi) pi.onchange = () => { const v = parseInt(pi.value, 10); if (v >= 2 && v <= 99) state.points = v; save(); render(); };
  app.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
    const d = +b.dataset.d;
    if (b.dataset.step === 'courts') state.courts = Math.min(20, Math.max(1, state.courts + d));
    else state.roundsTarget = Math.min(99, Math.max(1, (roundsTarget() || 1) + d));
    save(); render();
  });
  const ci = document.getElementById('courtsInput');
  ci.onchange = () => { const v = parseInt(ci.value, 10); if (v >= 1) state.courts = Math.min(20, v); save(); render(); };
  const ri = document.getElementById('roundsInput');
  ri.onchange = () => { const v = parseInt(ri.value, 10); state.roundsTarget = v >= 1 ? Math.min(99, v) : null; save(); render(); };
  document.getElementById('startBtn').onclick = () => {
    if (state.players.length < 4) return;
    state.roundsTarget = state.baseTarget = roundsTarget();
    state.phase = 'play';
    state.rounds = [];
    addRound();
  };
}

function renderPlay() {
  const tabs = `
    <div class="tabs">
      <button data-view="matches" class="${state.view === 'matches' ? 'on' : ''}">Ottelut</button>
      <button data-view="table" class="${state.view === 'table' ? 'on' : ''}">Sarjataulukko</button>
    </div>`;
  app.innerHTML = tabs + (state.view === 'matches' ? matchesHtml() : tableHtml()) + `
    <div class="actions"><button id="resetBtn" class="danger">Uusi turnaus</button></div>`;

  app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; save(); render(); window.scrollTo(0, 0); });
  document.getElementById('resetBtn').onclick = () => {
    if (!confirm('Aloitetaanko uusi turnaus? Nykyiset tulokset poistetaan (pelaajat säilyvät).')) return;
    state.phase = 'setup'; state.rounds = []; state.view = 'matches'; state.shownRound = 0; state.roundsTarget = null;
    save(); render();
  };
  if (state.view === 'matches') bindMatches();
}

function finished() {
  return state.rounds.length >= state.roundsTarget && state.rounds.every(roundComplete);
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
        <div class="muted">Turnaus päättyi</div>
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
    <p class="muted small">Syötä toisen joukkueen pisteet, niin toisen pisteet täydentyvät automaattisesti (yhteensä ${state.points}).</p>
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
    if (state.rounds.length === 0) { state.phase = 'setup'; }
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

function tableHtml() {
  const rows = standings();
  const played = state.rounds.filter(roundComplete).length;
  const anyDraw = rows.some(x => x.d > 0);
  return `
  <section class="card">
    <h2>Sarjataulukko</h2>
    <p class="muted small">Pelattu ${played} / ${Math.max(state.roundsTarget, state.rounds.length)} kierrosta</p>
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

render();
