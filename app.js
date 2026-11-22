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
  format: 'americano',       // 'americano' | 'mexicano' | 'tennis'
  points: 24,
  tennis: null,              // tennispisteet: { sets, games, golden, stb } (null = oletus)
  tennisMode: 'rotate',      // tennis: 'fixed' (yksi ottelu, 4 pelaajaa) | 'rotate' (vaihtuvat parit)
  pairing: 0,                // tennis, kiinteät parit: 0 = 1+2 vs 3+4, 1 = 1+3 vs 2+4, 2 = 1+4 vs 2+3
  finalOf: null,             // loppuottelu: mihin turnaukseen kuuluu
  histFilter: 'all',         // historia: all | points | tennis
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
      tennis: isTennis(state) ? tcfg(state) : null,
      tennisMode: isTennis(state) ? state.tennisMode : null,
      finalOf: state.finalOf || null,
      courts: activeCourts(),
      roundsTarget: state.roundsTarget,
      baseTarget: state.baseTarget,
      schedule: state.schedule || null,
      players: state.players.map(p => ({ id: p.id, name: p.name })),
      rounds: copyRounds(state.rounds),
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

/* ---------- tennispisteet: 0-15-30-40, pelit, erät, tiebreak ----------
   Ottelun kulku tallennetaan pistelokina (m.log = 'abba…', a/b = kumpi joukkue voitti pisteen).
   Kaikki muu (pelit, erät, voittaja) lasketaan lokista, joten peruminen on vain viimeisen merkin poisto.
   Valmiissa ottelussa m.sa / m.sb = voitetut erät. */
const TENNIS_DEFAULT = { sets: 3, games: 6, golden: true, stb: true, entry: 'sets' }; // entry: 'sets' = vain erätulokset, 'points' = piste kerrallaan
const isTennis = T => !!T && T.format === 'tennis';
const tcfg = T => Object.assign({}, TENNIS_DEFAULT, (T && T.tennis) || {});

function tennisReplay(log, cfg) {
  const need = cfg.sets === 3 ? 2 : 1;
  const sets = [], sw = [0, 0];
  let ga = 0, gb = 0, pa = 0, pb = 0, tb = false, stb = false, winner = null, used = 0;
  const newSet = () => { ga = gb = pa = pb = 0; stb = cfg.sets === 3 && cfg.stb && sw[0] === 1 && sw[1] === 1; tb = stb; };
  newSet();
  for (const ch of String(log || '')) {
    if (winner) break;
    used++;
    if (ch === 'a') pa++; else pb++;
    let g = null;
    if (tb) { const t = stb ? 10 : 7; if (pa >= t && pa - pb >= 2) g = 'a'; else if (pb >= t && pb - pa >= 2) g = 'b'; }
    else if (pa >= 4 && (pa - pb >= 2 || cfg.golden)) g = 'a';
    else if (pb >= 4 && (pb - pa >= 2 || cfg.golden)) g = 'b';
    if (!g) continue;
    let setWon = null, tbp = null;
    if (stb) { setWon = g; tbp = [pa, pb]; ga = g === 'a' ? 1 : 0; gb = 1 - ga; }
    else {
      if (g === 'a') ga++; else gb++;
      if (tb) { setWon = g; tbp = [pa, pb]; }
      else if (ga >= cfg.games && ga - gb >= 2) setWon = 'a';
      else if (gb >= cfg.games && gb - ga >= 2) setWon = 'b';
      else if (ga === cfg.games && gb === cfg.games) tb = true;
    }
    pa = pb = 0;
    if (setWon) {
      sets.push({ a: ga, b: gb, tb: tbp, stb });
      sw[setWon === 'a' ? 0 : 1]++;
      if (sw[0] === need || sw[1] === need) winner = sw[0] === need ? 'a' : 'b';
      else newSet();
    }
  }
  const games = sets.reduce((s, x) => [s[0] + x.a, s[1] + x.b], [0, 0]);
  if (!winner) { games[0] += ga; games[1] += gb; }
  return { sets, sw, winner, games, pts: [pa, pb], ga, gb, tb, stb, used };
}
function tennisPointLabels(r) {
  const [a, b] = r.pts;
  if (r.tb) return [String(a), String(b)];
  if (a >= 3 && b >= 3) return a === b ? ['40', '40'] : a > b ? ['AD', '40'] : ['40', 'AD'];
  const L = ['0', '15', '30', '40'];
  return [L[a], L[b]];
}
// Erätulos tekstinä, esim. "6–4 6–7(5) [10–8]"; flip = joukkue b ensin
function setText(s, flip) {
  if (s.stb) { const [p, q] = flip ? [s.tb[1], s.tb[0]] : s.tb; return `[${p}–${q}]`; }
  const [x, y] = flip ? [s.b, s.a] : [s.a, s.b];
  return `${x}–${y}${s.tb && Math.min(...s.tb) ? `(${Math.min(...s.tb)})` : ''}`; // erätuloksina kirjatussa tiebreakissa pisteitä ei tiedetä (7–0)
}
const tennisScoreText = (r, flip) => r.sets.map(s => setText(s, flip)).join(' ');
function setMatchLog(m, log, T = state) {
  const r = tennisReplay(log, tcfg(T));
  m.log = String(log || '').slice(0, r.used);
  if (r.winner || !m.log) delete m.end;
  m.sa = r.winner || m.end ? r.sw[0] : null;
  m.sb = r.winner || m.end ? r.sw[1] : null;
}
/* Ottelun voittaja. Kesken lopetettu ottelu (m.end) ratkeaa johtotilanteen mukaan: erät, pelit, pisteet. w = null: tasan. */
function tennisOutcome(m, T = state) {
  const r = tennisReplay(m.log, tcfg(T));
  if (r.winner || !m.end) return { r, w: r.winner };
  const d = (r.sw[0] - r.sw[1]) || (r.games[0] - r.games[1]) || (r.pts[0] - r.pts[1]);
  return { r, w: d > 0 ? 'a' : d < 0 ? 'b' : null };
}
// Näytettävät erät: pelatut + kesken jäänyt erä
const shownSets = r => r.winner ? r.sets : r.sets.concat(r.stb ? (r.pts[0] || r.pts[1] ? [{ stb: true, tb: [...r.pts] }] : []) : r.ga || r.gb ? [{ a: r.ga, b: r.gb }] : []);
// Tulos tekstinä, kesken lopetetussa ottelussa myös kesken jäänyt erä ja merkintä
const tennisMatchText = (m, T, flip) => { const { r } = tennisOutcome(m, T); return tennisScoreText({ sets: shownSets(r) }, flip) + (m.end && !r.winner ? ' (lopetettu)' : ''); };
// Voittaja kaikille pelimuodoille: 'a', 'b' tai null
function matchWinner(m, T = state) {
  if (!isScored(m, T)) return null;
  if (isTennis(T)) return tennisOutcome(m, T).w;
  return m.sa > m.sb ? 'a' : m.sb > m.sa ? 'b' : null;
}
/* Käsin syötetyt erätulokset → pisteloki (pelit vuorotellen, voittaja lopuksi). null = virheellinen tulos.
   partial: viimeinen erä saa olla kesken (esim. 3–2). Tiebreak-erän pisteitä ei tiedetä, joten se kirjataan 7–0. */
function setsToLog(list, cfg, partial = false) {
  const alt = (x, y, unit) => {
    const lo = Math.min(x, y), w = x > y ? 'a' : 'b';
    let s = '';
    for (let i = 0; i < lo; i++) s += unit('a') + unit('b');
    for (let i = lo; i < Math.max(x, y); i++) s += unit(w);
    return s;
  };
  const game = w => w.repeat(4), pt = w => w;
  let log = '';
  list.forEach(([x, y], i) => {
    if (cfg.sets === 3 && cfg.stb && i === 2) log += alt(x, y, pt);
    else if (Math.max(x, y) === cfg.games + 1 && Math.min(x, y) === cfg.games) log += alt(cfg.games, cfg.games, game) + (x > y ? alt(7, 0, pt) : alt(0, 7, pt));
    else log += alt(x, y, game);
  });
  const r = tennisReplay(log, cfg);
  const same = (s, i) => s.stb ? s.tb[0] === list[i][0] && s.tb[1] === list[i][1] : s.a === list[i][0] && s.b === list[i][1];
  const n = list.length, last = list[n - 1];
  let ok = r.used === log.length && r.sets.length === n && r.sets.every(same);
  // kesken oleva viimeinen erä: aiemmat erät valmiit, viimeisen tilanne täsmää
  if (!ok && partial && n && !r.winner && r.used === log.length && r.sets.length === n - 1 && r.sets.every(same))
    ok = r.stb ? r.pts[0] === last[0] && r.pts[1] === last[1] : r.ga === last[0] && r.gb === last[1] && !r.tb;
  return ok ? log : null;
}
const copyMatch = m => { const o = { court: m.court, a: m.a, b: m.b, sa: m.sa, sb: m.sb }; if (m.log) o.log = m.log; if (m.end) o.end = true; return o; };
const copyRounds = rounds => (rounds || []).map(r => ({ matches: r.matches.map(copyMatch), byes: r.byes || [] }));

/* T = turnaus (nykyinen state tai historiamerkintä): { format, points, tennis, players, rounds } */
function isScored(m, T = state) {
  if (isTennis(T)) return Number.isInteger(m.sa) && Number.isInteger(m.sb) && (m.sa !== m.sb || !!m.end);
  return Number.isInteger(m.sa) && Number.isInteger(m.sb) && m.sa >= 0 && m.sb >= 0 && m.sa + m.sb === T.points;
}
const roundComplete = (r, T = state) => r.matches.every(m => isScored(m, T));
const finished = () => state.rounds.length >= state.roundsTarget && state.rounds.every(r => roundComplete(r));
const hasAnyScore = m => Number.isInteger(m.sa) || !!m.log;

/* ---------- sarjataulukko ----------
   Pisteturnaus: pisteet, voitot, piste-ero. Tennis: voitot, erä-ero, peliero (pts = voitetut pelit). */
function computeStandings(T) {
  const ten = isTennis(T), cfg = ten ? tcfg(T) : null;
  const s = new Map();
  for (const p of T.players) s.set(p.id, { id: p.id, name: p.name, pts: 0, against: 0, played: 0, w: 0, d: 0, l: 0, byes: 0, setsW: 0, setsL: 0 });
  for (const r of T.rounds) {
    for (const id of r.byes) if (s.has(id)) s.get(id).byes++;
    for (const m of r.matches) {
      if (!isScored(m, T)) continue;
      let A = m.sa, B = m.sb, cmp = A - B;
      if (ten) { const o = tennisOutcome(m, T); [A, B] = o.r.games; cmp = o.w === 'a' ? 1 : o.w === 'b' ? -1 : 0; }
      const add = (ids, own, opp, sOwn, sOpp, c) => ids.forEach(id => {
        const x = s.get(id); if (!x) return;
        x.pts += own; x.against += opp; x.played++;
        if (ten) { x.setsW += sOwn; x.setsL += sOpp; }
        if (c > 0) x.w++; else if (c < 0) x.l++; else x.d++;
      });
      add(m.a, A, B, m.sa, m.sb, cmp);
      add(m.b, B, A, m.sb, m.sa, -cmp);
    }
  }
  const diff = x => x.pts - x.against;
  return [...s.values()].sort(ten
    ? (x, y) => y.w - x.w || (y.setsW - y.setsL) - (x.setsW - x.setsL) || diff(y) - diff(x) || byName(x.name, y.name)
    : (x, y) => y.pts - x.pts || y.w - x.w || diff(y) - diff(x) || byName(x.name, y.name));
}
const standings = () => computeStandings(state);
// Pelaajan tulos lyhyesti: "24 p" tai tenniksessä "2/3 V"
// Sijoitukset: yhdessä ottelussa voittajapari jakaa 1. sijan ja häviäjät 3. sijan, muuten järjestysnumero
// Kiinteillä pareilla (tennisottelu / loppuottelu) tasatulokset jakavat sijan: 1 + paremmin sijoittuneiden määrä.
const fixedT = T => isTennis(T) && T.tennisMode === 'fixed';
const tkey = x => [x.w, x.setsW - x.setsL, x.pts - x.against];
const better = (x, y) => { const a = tkey(x), b = tkey(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
const placeOf = (T, rows, i) => fixedT(T) ? 1 + rows.filter(r => better(r, rows[i])).length : i + 1;
const winnerName = (T, rows) => fixedT(T) ? rows.filter((r, i) => placeOf(T, rows, i) === 1).map(r => r.name).join(" & ") : rows[0].name;
const scoreLabel = (T, row) => isTennis(T) ? `${row.w}/${row.played} V` : `${row.pts} p`;

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
  const ten = isTennis(state), fixed = ten && state.tennisMode === 'fixed';
  const canStart = fixed ? n === 4 : n >= 4;
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
      <input id="nameInput" class="grow" type="text" placeholder="Pelaajan nimi" autocomplete="off" enterkeyhint="done">
      <button class="primary" type="submit">Lisää</button>
    </form>
    <div class="chips">
      ${state.players.map(p => `<span class="chip">${esc(p.name)}<button data-remove="${p.id}" aria-label="Poista ${esc(p.name)}">×</button></span>`).join('') || '<span class="muted">Ei vielä pelaajia. Tarvitaan vähintään 4. Useita nimiä voi lisätä kerralla pilkulla erotettuina.</span>'}
    </div>
    <div class="btnrow">
      <button id="pickBtn" ${savable ? '' : 'disabled'}>📋 Tallennetut</button>
      ${n ? '<button id="saveListBtn">💾 Tallenna lista</button>' : ''}
    </div>
    ${savable ? '' : '<p class="muted small">Lisätyt pelaajat tallentuvat, ja voit myöhemmin valita heidät listasta.</p>'}
  </section>

  <section class="card">
    <h2>Turnausmuoto</h2>
    <div class="seg">
      <button data-format="americano" class="${state.format === 'americano' ? 'on' : ''}">Americano</button>
      <button data-format="mexicano" class="${state.format === 'mexicano' ? 'on' : ''}">Mexicano</button>
      <button data-format="tennis" class="${ten ? 'on' : ''}">🎾 Tennis</button>
    </div>
    <p class="muted">${state.format === 'americano'
      ? 'Parit vaihtuvat joka kierroksella niin, että jokainen pelaa mahdollisimman tasaisesti eri parien kanssa ja eri vastustajia vastaan.'
      : state.format === 'mexicano' ? 'Kentät muodostetaan sarjataulukon mukaan: 1.+4. vs 2.+3. jokaisella kentällä.'
      : 'Normaali tennisten pistelasku: pelit ja erät. Kiinteät parit = yksi ottelu neljällä pelaajalla (parit voi vaihtaa kesken pelin), vaihtuvat parit = useampi kierros.'}</p>
    ${ten ? `
    <p class="section-label" style="margin-top:10px">Pelimuoto</p>
    <div class="seg">
      <button data-tmode="fixed" class="${state.tennisMode === 'fixed' ? 'on' : ''}">Kiinteät parit</button>
      <button data-tmode="rotate" class="${state.tennisMode !== 'fixed' ? 'on' : ''}">Vaihtuvat parit</button>
    </div>
    ${state.tennisMode === 'fixed' && n === 4 ? `
    <p class="section-label" style="margin-top:10px">Parit</p>
    <div class="lists" style="margin:0">
      ${PAIRINGS.map((pp, i) => `<button class="use ${state.pairing === i ? 'on-series' : ''}" data-pairing="${i}">${esc(state.players[pp[0]].name)} &amp; ${esc(state.players[pp[1]].name)} <span class="muted">vs</span> ${esc(state.players[pp[2]].name)} &amp; ${esc(state.players[pp[3]].name)}</button>`).join('')}
    </div>` : ''}` : ''}
    ${state.format === 'mexicano' ? `
    <p class="section-label" style="margin-top:10px">Ensimmäinen kierros</p>
    <div class="seg">
      <button data-seed="random" class="${state.seed !== 'rating' ? 'on' : ''}">🎲 Arvonta</button>
      <button data-seed="rating" class="${state.seed === 'rating' ? 'on' : ''}">🏅 Rankingin mukaan</button>
    </div>` : ''}
  </section>

  <section class="card">
    <h2>Kentät ja kierrokset</h2>
    ${fixed ? `<p class="muted" style="margin:0">${n === 4 ? '<b>1 kenttä</b> · yksi ottelu kiinteillä pareilla.' : `Yhteen otteluun tarvitaan tasan 4 pelaajaa (nyt ${n}). Valitse "Vaihtuvat parit", jos pelaajia on enemmän.`}</p>`
    : n < 4 ? '<p class="muted">Määräytyvät automaattisesti pelaajamäärän mukaan. Lisää vähintään 4 pelaajaa.</p>' : `
    <div class="info">
      <b>${c} kenttä${c === 1 ? '' : 'ä'}</b> · <b>${rounds} kierrosta</b>${byes ? ` · ${byes} tauolla / kierros` : ''}
    </div>
    <p class="muted small">Kenttiä on yksi jokaista neljää pelaajaa kohden. Kierroksia on niin monta, että jokainen ehtii pelata jokaisen kanssa ristiin.</p>`}
  </section>

  ${ten ? `
  <section class="card" id="tennisCard">
    <h2>🎾 Tennispisteet</h2>
    ${tennisSettingsHtml(tcfg(state))}
  </section>` : `
  <section class="card">
    <h2>Pisteet per ottelu</h2>
    <div class="seg">
      ${POINT_PRESETS.map(p => `<button data-points="${p}" class="${state.points === p ? 'on' : ''}">${p}</button>`).join('')}
      <button data-points="custom" class="${custom ? 'on' : ''}">Muu</button>
    </div>
    ${custom ? `<div class="row" style="margin-top:8px"><input id="pointsInput" type="number" inputmode="numeric" min="2" max="99" value="${state.points}"> <span class="muted">pistettä</span></div>` : ''}
    <p class="muted">Joka ottelussa pelataan yhteensä ${state.points} pistettä. Jokainen pelaaja saa joukkueensa pisteet.</p>
  </section>`}

  <button id="startBtn" class="primary big" ${canStart ? '' : 'disabled'}>${fixed ? 'Aloita ottelu' : 'Aloita turnaus'}</button>
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
  app.querySelectorAll('[data-tmode]').forEach(b => b.onclick = () => { state.tennisMode = b.dataset.tmode; save(); render(); });
  app.querySelectorAll('[data-pairing]').forEach(b => b.onclick = () => { state.pairing = +b.dataset.pairing; save(); render(); });
  const tc = document.getElementById('tennisCard');
  if (tc) { const cfg = tcfg(state); bindTennisSettings(tc, cfg, () => { state.tennis = cfg; save(); render(); }); }
  app.querySelectorAll('[data-points]').forEach(b => b.onclick = () => {
    if (b.dataset.points === 'custom') { if (POINT_PRESETS.includes(state.points)) state.points = 20; }
    else state.points = +b.dataset.points;
    save(); render();
  });
  const pi = document.getElementById('pointsInput');
  if (pi) pi.onchange = () => { const v = parseInt(pi.value, 10); if (v >= 2 && v <= 99) state.points = v; save(); render(); };
  const startBtn = document.getElementById('startBtn');
  startBtn.onclick = () => {
    if (!canStart || startBtn.disabled) return;
    startBtn.disabled = true;
    startBtn.textContent = state.format === 'mexicano' || fixed ? 'Arvotaan…' : 'Arvotaan otteluohjelmaa…';
    setTimeout(startTournament, 30); // näytä teksti ennen laskentaa
  };
}

// Kiinteiden parien vaihtoehdot neljälle pelaajalle (indeksit state.players-listaan): [a0, a1, b0, b1]
const PAIRINGS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

function startTournament() {
  const fixed = isTennis(state) && state.tennisMode === 'fixed';
  state.roundsTarget = state.baseTarget = fixed ? 1 : roundsFor(state.players.length);
  state.phase = 'play';
  state.rounds = [];
  state.tid = newId();
  state.startedAt = new Date().toISOString();
  state.finalOf = null;
  if (isTennis(state)) state.tennis = tcfg(state);
  if (fixed) {
    const p = (PAIRINGS[state.pairing] || PAIRINGS[0]).map(i => state.players[i].id);
    state.schedule = [{ matches: [{ court: 1, a: [p[0], p[1]], b: [p[2], p[3]], sa: null, sb: null }], byes: [] }];
  } else state.schedule = state.format === 'mexicano' ? null : americanoSchedule(state.roundsTarget);
  addRound();
}

/* Tennisasetukset (aloitusnäkymä ja loppuottelun valintaikkuna) */
function tennisSettingsHtml(cfg) {
  const b = (k, v, label) => `<button type="button" data-tset="${k}" data-tval="${v}" class="${cfg[k] === v ? 'on' : ''}">${label}</button>`;
  return `
    <p class="section-label">Tuloksen kirjaus</p>
    <div class="seg">${b('entry', 'sets', 'Erätulokset')}${b('entry', 'points', 'Piste kerrallaan')}</div>
    <p class="muted small" style="margin:6px 0 0">${cfg.entry === 'points' ? 'Jokainen piste napautetaan (15–30–40), pelit ja erät lasketaan automaattisesti.' : 'Kirjataan vain erien lopputulokset, esim. 6–4. Nopein tapa.'}</p>
    <p class="section-label" style="margin-top:10px">Erät</p>
    <div class="seg">${b('sets', 1, '1 erä')}${b('sets', 3, 'Paras 3:sta')}</div>
    <p class="section-label" style="margin-top:10px">Erän pituus</p>
    <div class="seg">${b('games', 6, '6 peliä')}${b('games', 4, '4 peliä')}</div>
    ${cfg.entry === 'points' ? `<p class="section-label" style="margin-top:10px">Tasatilanne 40–40</p>
    <div class="seg">${b('golden', true, '⚡ Kultainen piste')}${b('golden', false, 'Etu (AD)')}</div>` : ''}
    ${cfg.sets === 3 ? `
    <p class="section-label" style="margin-top:10px">Ratkaiseva erä</p>
    <div class="seg">${b('stb', true, 'Supertiebreak 10')}${b('stb', false, 'Normaali erä')}</div>` : ''}
    <p class="muted small" style="margin-bottom:0">Erä ${cfg.games}–${cfg.games}:ssä pelataan tiebreak 7 pisteeseen.
      ${cfg.entry !== 'points' ? '' : cfg.golden ? 'Kultainen piste: tilanteessa 40–40 seuraava piste ratkaisee pelin.' : 'Tilanteessa 40–40 peli jatkuu, kunnes toinen voittaa kaksi pistettä peräkkäin.'}
      ${cfg.sets === 3 && cfg.stb ? 'Jos erät ovat 1–1, ratkaisee supertiebreak 10 pisteeseen.' : ''}</p>`;
}
function bindTennisSettings(root, cfg, onChange) {
  root.querySelectorAll('[data-tset]').forEach(btn => btn.onclick = () => {
    const v = btn.dataset.tval;
    cfg[btn.dataset.tset] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
    onChange();
  });
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
    <p class="muted subtitle">${cloudDotHtml()} ${state.seriesId && seriesById(state.seriesId) ? `⭐ ${esc(seriesById(state.seriesId).name)} · ` : ''}${fmtFormat(state)} · ${state.players.length} pelaajaa${isTennis(state) && state.tennisMode === 'fixed' ? '' : ` · ${activeCourts()} kenttä${activeCourts() === 1 ? '' : 'ä'}`}</p>
    <div class="tabs">
      <button data-view="matches" class="${state.view === 'matches' ? 'on' : ''}">Ottelut</button>
      <button data-view="table" class="${state.view === 'table' ? 'on' : ''}">Sarjataulukko</button>
    </div>`;
  const body = state.view === 'matches'
    ? matchesHtml()
    : tableHtml(state, Math.max(state.roundsTarget, state.rounds.length));
  app.innerHTML = tabs + body + `
    <div class="actions"><button id="resetBtn" class="danger">Uusi turnaus</button></div>`;

  app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; save(); render(); window.scrollTo(0, 0); });
  document.getElementById('resetBtn').onclick = () => {
    const msg = finished()
      ? 'Aloitetaanko uusi turnaus? Tämä turnaus on tallessa historiassa.'
      : 'Aloitetaanko uusi turnaus? Keskeneräinen turnaus jää historiaan nykyisillä tuloksilla.';
    if (!confirm(msg)) return;
    endTournament(); state.seriesId = null;
    save(); render(); window.scrollTo(0, 0);
  };
  if (state.view === 'matches') bindMatches();
}

function matchesHtml() {
  const ri = Math.min(state.shownRound, state.rounds.length - 1);
  const r = state.rounds[ri];
  const isLast = ri === state.rounds.length - 1;
  const chips = state.rounds.map((x, i) =>
    `<button data-round="${i}" class="${i === ri ? 'on' : ''} ${roundComplete(x) ? 'done' : ''}">${fixedT(state) ? 'Ottelu ' : 'K'}${i + 1}</button>`).join('');
  const ten = isTennis(state);
  const matches = r.matches.map((m, mi) => {
    if (ten) return tennisMatchHtml(m, mi);
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
  const fixed = ten && state.tennisMode === 'fixed';
  const single = fixed && state.rounds.length === 1;
  let actions = '';
  if (isLast) {
    if (finished()) {
      const top = standings();
      const fm = single && state.rounds[0].matches[0];
      const fo = fm && tennisOutcome(fm);
      const h = db.history.find(x => x.id === state.tid);
      const fin = !ten && h && finalOf(h.id);
      const ended = state.rounds.some(x => x.matches.some(m => m.end));
      actions = single ? `
      <div class="card podium">
        <div class="muted">${state.finalOf ? 'Loppuottelu' : 'Ottelu'} ${ended ? 'lopetettiin' : 'päättyi'} · tallennettu historiaan</div>
        <div class="winner">${fo.w ? `🏆 ${(fo.w === 'a' ? fm.a : fm.b).map(id => esc(nameOf(id))).join(' &amp; ')}` : '🤝 Tasan'}</div>
        <div class="muted">${tennisMatchText(fm, state, fo.w === 'b')}</div>
      </div>` : `
      <div class="card podium">
        <div class="muted">${fixed ? (state.finalOf ? 'Loppuottelut päättyivät' : 'Ottelut päättyivät') : 'Turnaus päättyi'} · tallennettu historiaan</div>
        <div class="winner">🏆 ${esc(fixed ? winnerName(state, top) : top[0].name)}</div>
        <div class="muted">${ten
          ? fixed ? `${scoreLabel(state, top[0])} · ${kpl(state.rounds.length, 'ottelu', 'ottelua')}`
          : `${top[0].w} voittoa${top[1] ? ` · 2. ${esc(top[1].name)} (${top[1].w})` : ''}${top[2] ? ` · 3. ${esc(top[2].name)} (${top[2].w})` : ''}`
          : `${top[0].pts} pistettä${top[1] ? ` · 2. ${esc(top[1].name)} (${top[1].pts})` : ''}${top[2] ? ` · 3. ${esc(top[2].name)} (${top[2].pts})` : ''}`}</div>
      </div>
      ${!ten && state.players.length >= 4 ? (fin
        ? `<div class="info"><span>🎾 <b>Loppuottelu:</b> ${finalResultHtml(fin)}</span></div><button id="openFinalBtn">${fin.finished ? 'Näytä loppuottelu' : '▶ Jatka loppuottelua'}</button>`
        : `<button id="finalBtn" class="primary big">🎾 Loppuottelu tennispisteillä</button>
           <p class="muted small" style="margin:-4px 0 4px;text-align:center">${esc(top[0].name)} &amp; ${esc(top[3].name)} vs ${esc(top[1].name)} &amp; ${esc(top[2].name)} (1.+4. vs 2.+3.)</p>`) : ''}`;
      if (fixed && state.players.length === 4) actions += '<button id="swapBtn">🔄 Uusi ottelu, valitse joukkueet</button>';
      if (state.finalOf && db.history.some(x => x.id === state.finalOf)) actions += '<button id="parentBtn">← Turnauksen tulokset</button>';
      if (!state.finalOf) actions += `
      ${state.seriesId && seriesById(state.seriesId)
        ? `<div class="info series-banner"><span>⭐ Tallennettu vakioturnaukseen <b>${esc(seriesById(state.seriesId).name)}</b></span></div>
           <button id="seriesStatsBtn">📊 Vakioturnauksen tilastot</button>`
        : '<button id="seriesSaveBtn">⭐ Tallenna vakioturnaukseksi</button>'}`;
      actions += `
      <button id="shareBtn" class="${!ten && !fin ? '' : 'primary big'}">📤 Jaa tulokset</button>
      ${single ? '' : `<button id="tableBtn">Näytä lopputulokset</button>${fixed ? '' : '<button id="nextBtn">Pelaa lisäkierros</button>'}`}`;
    } else {
      if (fixed && state.players.length === 4) actions = '<button id="swapBtn">🔄 Vaihda joukkueet</button>';
      else actions = `<button id="nextBtn" class="primary big" ${complete ? '' : 'disabled'}>${complete ? 'Seuraava kierros →' : 'Syötä kaikki tulokset'}</button>`;
      if (ten) actions += `<button id="stopBtn">⏹ Lopeta ${fixed ? (state.finalOf ? 'loppuottelu' : 'ottelu') : 'turnaus'} tähän</button>`;
    }
    if (!fixed) actions += `<button id="undoBtn" class="danger">Poista kierros ${ri + 1}</button>`;
    else if (state.rounds.length > 1) actions += `<button id="undoBtn" class="danger">Poista ottelu ${ri + 1}</button>`;
  }
  return `
  ${single ? '' : `<div class="rounds">${chips}</div>`}
  <section class="card">
    <h2>${single ? (state.finalOf ? '🎾 Loppuottelu' : '🎾 Ottelu') : fixed ? `🎾 ${state.finalOf ? 'Loppuottelu' : 'Ottelu'} ${ri + 1} / ${state.rounds.length}` : `Kierros ${ri + 1} / ${Math.max(state.roundsTarget, state.rounds.length)}`}</h2>
    ${matches}
    ${byes}
    <p class="muted small">${ten && tcfg(state).entry !== 'points'
      ? 'Kirjoita kunkin erän pelit (esim. 6–4). Kesken olevan erän voi kirjata tilanteena (esim. 3–2). Tulokset tallentuvat automaattisesti.'
      : ten
      ? 'Napauta pisteen voittaneen joukkueen painiketta. Pelit, erät ja tiebreak etenevät automaattisesti. ↶ peruu viimeisimmän pisteen. Tulokset tallentuvat automaattisesti.'
      : `Syötä toisen joukkueen pisteet, niin toisen pisteet täydentyvät automaattisesti (yhteensä ${state.points}). Tulokset tallentuvat automaattisesti.`}</p>
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
  // tennis: piste, peru, erätulokset käsin
  app.querySelectorAll('[data-tp]').forEach(b => b.onclick = () => {
    const r = cur(); if (!r) return;
    const m = r.matches[+b.dataset.tp]; if (!m || isScored(m)) return;
    setMatchLog(m, (m.log || '') + b.dataset.side);
    save(); render();
    if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* */ }
  });
  app.querySelectorAll('[data-tundo]').forEach(b => b.onclick = () => {
    const r = cur(); if (!r) return;
    const m = r.matches[+b.dataset.tundo]; if (!m || !m.log) return;
    setMatchLog(m, m.log.slice(0, -1));
    save(); render();
  });
  app.querySelectorAll('[data-tedit]').forEach(b => b.onclick = () => openSetsDialog(ri, +b.dataset.tedit));
  bindSetInputs(cur);
  app.querySelectorAll('[data-tresume]').forEach(b => b.onclick = () => {
    const r = cur(); if (!r) return;
    const m = r.matches[+b.dataset.tresume]; if (!m) return;
    delete m.end; setMatchLog(m, m.log);
    save(); render();
  });
  const swb = document.getElementById('swapBtn');
  if (swb) swb.onclick = openSwapDialog;
  const spb = document.getElementById('stopBtn');
  if (spb) spb.onclick = stopTournament;
  const fb = document.getElementById('finalBtn');
  if (fb) fb.onclick = () => openFinalDialog(state.tid);
  const ofb = document.getElementById('openFinalBtn');
  if (ofb) ofb.onclick = () => { const f = finalOf(state.tid); if (f) openTour(f.id); };
  const pb = document.getElementById('parentBtn');
  if (pb) pb.onclick = () => openTour(state.finalOf);
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
    const hasScores = r.matches.some(hasAnyScore);
    const fx = fixedT(state);
    if (hasScores && !confirm(`Poistetaanko ${fx ? 'ottelu' : 'kierros'} ${ri + 1} tuloksineen?${fx ? ' Edellinen ottelu jatkuu siitä, mihin se jäi.' : ''}`)) return;
    state.rounds.pop();
    // joukkueiden vaihdon peruminen: edellinen (kesken lopetettu) ottelu jatkuu
    const pm = fx && state.rounds.length && state.rounds[state.rounds.length - 1].matches[0];
    if (pm && pm.end) { delete pm.end; setMatchLog(pm, pm.log); }
    state.roundsTarget = Math.max(state.baseTarget || 1, state.rounds.length); // lisäkierroksen poisto palauttaa tavoitteen
    if (state.rounds.length === 0) {
      db.history = db.history.filter(h => h.id !== state.tid);
      const sid = state.seriesId;
      endTournament(); state.seriesId = sid;
    }
    state.shownRound = state.rounds.length - 1;
    save(); render();
  };
}

/* ---------- tennisottelu: tulostaulu + pistelaskuri ---------- */
/* Erätulostila: vain erien lopputulokset (esim. 6–4), ei pisteitä. Kesken olevan erän voi kirjata tilanteena (esim. 3–2). */
function tennisSetsStatus(m) {
  const cfg = tcfg(state), { r, w } = tennisOutcome(m);
  if (r.winner) return `🏆 Ottelu päättyi ${tennisScoreText(r, r.winner === 'b')}`;
  if (m.end) return `⏹ Lopetettu tilanteessa ${tennisScoreText({ sets: shownSets(r) }) || '0–0'}${w ? '' : ' · tasan'}`;
  if (!m.log) return `Kirjaa erien tulokset, esim. ${cfg.games}–${cfg.games - 2}.${cfg.sets === 3 && cfg.stb ? ' Supertiebreak (STB) pisteinä, esim. 10–8.' : ''}`;
  return r.stb ? `Erät 1–1 · supertiebreak 10 pisteeseen` : `Erät ${r.sw[0]}–${r.sw[1]}${r.ga || r.gb ? ` · erä ${r.sets.length + 1} kesken ${r.ga}–${r.gb}` : ''}`;
}
function tennisSetsHtml(m, mi) {
  const cfg = tcfg(state), { r, w } = tennisOutcome(m);
  const ended = !!m.end && !r.winner;
  const shown = shownSets(r);
  const stbCol = i => cfg.sets === 3 && cfg.stb && i === 2;
  const val = (i, sd) => { const s = shown[i]; if (!s) return ''; return s.stb ? s.tb[sd] : sd ? s.b : s.a; };
  const names = ids => ids.map(id => esc(nameOf(id))).join(' &amp; ');
  const win = r.winner || (ended ? w : null);
  return `
    <div class="match tmatch" data-scored="${isScored(m) ? 1 : 0}">
      ${activeCourts() > 1 ? `<div class="court">Kenttä ${m.court}</div>` : ''}
      <table class="setgrid">
        <thead><tr><th></th>${Array.from({ length: cfg.sets }, (_, i) => `<th>${stbCol(i) ? 'STB' : 'Erä ' + (i + 1)}</th>`).join('')}</tr></thead>
        <tbody>
          ${[0, 1].map(sd => `<tr class="${win === (sd ? 'b' : 'a') ? 'win' : ''}"><td class="names">${win === (sd ? 'b' : 'a') ? '🏆 ' : ''}${names(sd ? m.b : m.a)}</td>${Array.from({ length: cfg.sets }, (_, i) =>
            `<td><input type="number" inputmode="numeric" min="0" max="${stbCol(i) ? 99 : cfg.games + 1}" data-sm="${mi}" data-set="${i}" data-sd="${sd}" value="${val(i, sd)}" ${ended ? 'disabled' : ''} aria-label="${stbCol(i) ? 'Supertiebreak' : 'Erä ' + (i + 1)}, ${names(sd ? m.b : m.a)}"></td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
      <div class="tstatus" data-sst="${mi}">${tennisSetsStatus(m)}</div>
      <p class="err" data-serr="${mi}" role="alert" style="text-align:center;margin:0"></p>
      ${ended && state.shownRound >= state.rounds.length - 1 ? `<div class="tfoot"><button data-tresume="${mi}">▶ Jatka ottelua</button></div>` : ''}
    </div>`;
}
function bindSetInputs(cur) {
  const cfg = tcfg(state);
  app.querySelectorAll('input[data-sm]').forEach(inp => {
    const mi = +inp.dataset.sm;
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      const r = cur(); const m = r && r.matches[mi]; if (!m) return;
      const err = app.querySelector(`[data-serr="${mi}"]`);
      const list = [];
      for (let i = 0; i < cfg.sets; i++) {
        const [x, y] = [0, 1].map(sd => app.querySelector(`input[data-sm="${mi}"][data-set="${i}"][data-sd="${sd}"]`).value.trim());
        if (x === '' && y === '') break;
        if (x === '' || y === '') break; // toinen luku vielä puuttuu
        list.push([parseInt(x, 10), parseInt(y, 10)]);
      }
      const log = list.length ? setsToLog(list, cfg, true) : '';
      if (log === null) {
        err.textContent = `Erä ${list.length}: ${list[list.length - 1].join('–')} ei ole mahdollinen tulos (esim. ${cfg.games}–${cfg.games - 2}, ${cfg.games + 1}–${cfg.games - 1} tai ${cfg.games + 1}–${cfg.games}).`;
        return;
      }
      err.textContent = '';
      setMatchLog(m, log); save();
      app.querySelector(`[data-sst="${mi}"]`).textContent = tennisSetsStatus(m);
    });
    // valmis/kesken-tila muuttui → piirretään uudelleen vasta kentästä poistuttaessa (ei keskeytä kirjoittamista)
    inp.addEventListener('change', () => {
      const r = cur(); const m = r && r.matches[mi]; if (!m) return;
      const box = inp.closest('.tmatch');
      if (String(isScored(m) ? 1 : 0) !== box.dataset.scored) render();
    });
  });
}

function tennisMatchHtml(m, mi) {
  if (tcfg(state).entry !== 'points') return tennisSetsHtml(m, mi);
  const cfg = tcfg(state), { r, w: ow } = tennisOutcome(m);
  const ended = !!m.end && !r.winner;
  const [la, lb] = tennisPointLabels(r);
  // erät: pelatut + meneillään oleva (supertiebreakissa vain pisteet)
  const cols = r.winner || r.stb ? r.sets : r.sets.concat([{ a: r.ga, b: r.gb, cur: true }]);
  const names = ids => ids.map(id => esc(nameOf(id))).join(' &amp; ');
  const row = side => {
    const own = side === 'a', won = (r.winner || (ended ? ow : null)) === side;
    return `
      <div class="trow ${won ? 'win' : ''}">
        <span class="names">${names(own ? m.a : m.b)}</span>
        ${cols.map(s => `<span class="tset ${s.cur ? 'cur' : ''}">${s.stb ? (own ? s.tb[0] : s.tb[1]) : own ? s.a : s.b}${s.tb && !s.stb && Math.min(...s.tb) ? `<sup>${own ? s.tb[0] : s.tb[1]}</sup>` : ''}</span>`).join('')}
        <span class="tpt">${r.winner || ended ? (won ? '🏆' : '') : own ? la : lb}</span>
      </div>`;
  };
  const golden = !ended && cfg.golden && !r.tb && r.pts[0] === 3 && r.pts[1] === 3;
  const status = r.winner ? `Ottelu päättyi ${tennisScoreText(r, r.winner === 'b')}`
    : ended ? `⏹ Lopetettu tilanteessa ${tennisScoreText({ sets: shownSets(r) }) || '0–0'}${ow ? '' : ' · tasan'}`
    : r.stb ? '🔥 Supertiebreak – 10 pisteeseen'
    : r.tb ? `Tiebreak – 7 pisteeseen · erä ${r.sets.length + 1}`
    : golden ? '⚡ Kultainen piste – seuraava piste ratkaisee'
    : `Erä ${r.sets.length + 1}${cfg.sets === 3 ? ` · erät ${r.sw[0]}–${r.sw[1]}` : ''}`;
  return `
    <div class="match tmatch">
      ${activeCourts() > 1 ? `<div class="court">Kenttä ${m.court}</div>` : ''}
      <div class="tboard">${row('a')}${row('b')}</div>
      <div class="tstatus ${golden ? 'gold' : ''}">${status}</div>
      ${r.winner || ended ? '' : `
      <div class="tbtns">
        <button class="tpoint" data-tp="${mi}" data-side="a"><span class="plus">＋</span><span class="who">${names(m.a)}</span></button>
        <button class="tpoint" data-tp="${mi}" data-side="b"><span class="plus">＋</span><span class="who">${names(m.b)}</span></button>
      </div>`}
      <div class="tfoot">
        ${ended ? (state.shownRound >= state.rounds.length - 1 ? `<button data-tresume="${mi}">▶ Jatka ottelua</button>` : '') : `<button data-tundo="${mi}" ${m.log ? '' : 'disabled'}>↶ Peru piste</button>`}
        <button data-tedit="${mi}">✏️ Erätulokset</button>
      </div>
    </div>`;
}

/* Erätulokset käsin (esim. jos ottelu pelattiin ilman laskuria). */
function openSetsDialog(ri, mi) {
  const m = state.rounds[ri] && state.rounds[ri].matches[mi];
  if (!m) return;
  const cfg = tcfg(state), r = tennisReplay(m.log, cfg);
  const nSets = cfg.sets;
  const names = ids => ids.map(id => esc(nameOf(id))).join(' &amp; ');
  const val = (i, side) => { const s = r.sets[i]; if (!s) return ''; return s.stb ? s.tb[side] : side ? s.b : s.a; };
  picker.innerHTML = `
  <div class="dlg">
    <div class="dlg-head">
      <h2 id="pickerTitle">✏️ Erätulokset</h2>
      <button class="icon" id="seClose" aria-label="Sulje">✕</button>
    </div>
    <form class="dlg-body" id="seForm">
      <table class="setgrid">
        <thead><tr><th></th>${Array.from({ length: nSets }, (_, i) => `<th>${cfg.sets === 3 && cfg.stb && i === 2 ? 'STB' : 'Erä ' + (i + 1)}</th>`).join('')}</tr></thead>
        <tbody>
          ${[0, 1].map(side => `<tr><td class="names">${names(side ? m.b : m.a)}</td>${Array.from({ length: nSets }, (_, i) =>
            `<td><input type="number" inputmode="numeric" min="0" max="${cfg.sets === 3 && cfg.stb && i === 2 ? 99 : cfg.games + 1}" data-set="${i}" data-sd="${side}" value="${val(i, side)}" aria-label="Erä ${i + 1}"></td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
      <p class="muted small">Syötä pelatut erät, esim. ${cfg.games}–${cfg.games - 2}. Tiebreak-erä on ${cfg.games + 1}–${cfg.games}${cfg.sets === 3 && cfg.stb ? ', supertiebreak (STB) pisteinä, esim. 10–8' : ''}. Kesken jääneen erän voi jättää tyhjäksi. Tallennus korvaa pistelaskurin tilanteen.</p>
      <p id="seErr" class="err" role="alert"></p>
      <div class="btnrow">
        <button type="submit" class="primary">Tallenna</button>
        ${m.log ? '<button type="button" id="seClear" class="danger">Tyhjennä tulos</button>' : ''}
      </div>
    </form>
  </div>`;
  if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
  document.getElementById('seClose').onclick = closePicker;
  const clr = document.getElementById('seClear');
  if (clr) clr.onclick = () => {
    if (!confirm('Tyhjennetäänkö ottelun tulos?')) return;
    setMatchLog(m, ''); save(); closePicker();
  };
  document.getElementById('seForm').onsubmit = e => {
    e.preventDefault();
    const list = [];
    for (let i = 0; i < nSets; i++) {
      const [x, y] = [0, 1].map(sd => picker.querySelector(`[data-set="${i}"][data-sd="${sd}"]`).value.trim());
      if (x === '' && y === '') continue;
      const a = parseInt(x, 10), b = parseInt(y, 10);
      if (!(a >= 0 && b >= 0)) { document.getElementById('seErr').textContent = `Täytä erän ${i + 1} molemmat luvut.`; return; }
      if (list.length !== i) { document.getElementById('seErr').textContent = 'Syötä erät järjestyksessä.'; return; }
      list.push([a, b]);
    }
    const log = setsToLog(list, cfg);
    if (log === null) { document.getElementById('seErr').textContent = `Tulos ei ole mahdollinen näillä säännöillä. Tarkista erät (esim. ${cfg.games}–${cfg.games - 2}, ${cfg.games + 1}–${cfg.games - 1} tai ${cfg.games + 1}–${cfg.games}).`; return; }
    setMatchLog(m, log); save(); closePicker();
  };
}

/* Turnauksen lopetus: takaisin aloitusnäkymään. Loppuottelun jälkeen palautetaan alkuperäinen turnausmuoto ja pelaajat. */
function endTournament() {
  if (state.finalOf) {
    const p = db.history.find(h => h.id === state.finalOf);
    if (p) {
      state.format = p.format; state.points = p.points || state.points;
      state.players = p.players.map(x => ({ id: state.nextId++, name: x.name }));
    }
  }
  Object.assign(state, { phase: 'setup', rounds: [], view: 'matches', shownRound: 0, roundsTarget: null, baseTarget: null,
    tid: null, startedAt: null, schedule: null, finalOf: null });
}

const finalOf = hid => db.history.find(h => h.finalOf === hid);
function openTour(hid) {
  if (state.phase === 'play' && state.tid === hid) { state.page = 'tournament'; state.historyOpen = null; }
  else { state.page = 'history'; state.historyOpen = hid; }
  save(); render(); window.scrollTo(0, 0);
}
// Loppuottelun tulos lyhyesti: "<b>A & D</b> 6–4 6–3 B & C"
function finalResultHtml(f) {
  const m = f.rounds[0] && f.rounds[0].matches[0];
  if (!m) return '–';
  if (!singleMatch(f)) {
    const rows = computeStandings(f);
    const n = kpl(f.rounds.length, 'ottelu', 'ottelua');
    if (!rows[0].played) return `${n} <span class="tag open">Kesken</span>`;
    return `${f.finished ? '🏆' : 'Johdossa:'} <b>${esc(winnerName(f, rows))}</b> (${scoreLabel(f, rows[0])}) · ${n}${f.finished ? '' : ' <span class="tag open">Kesken</span>'}`;
  }
  const { r, w } = tennisOutcome(m, f);
  const nm = ids => ids.map(id => esc(nameIn(f.players, id))).join(' &amp; ');
  if (!isScored(m, f)) return `${nm(m.a)} vs ${nm(m.b)} <span class="tag open">Kesken${shownSets(r).length ? ' ' + tennisScoreText({ sets: shownSets(r) }) : ''}</span>`;
  if (!w) return `${nm(m.a)} ${tennisMatchText(m, f)} ${nm(m.b)} (tasan)`;
  const [W, L] = w === 'a' ? [m.a, m.b] : [m.b, m.a];
  return `<b>${nm(W)}</b> ${tennisMatchText(m, f, w === 'b')} ${nm(L)}`;
}

/* Loppuottelu Americanon/Mexicanon jälkeen: 1.+4. vs 2.+3. tennispisteillä. */
function openFinalDialog(hid) {
  const h = db.history.find(x => x.id === hid);
  if (!h) return;
  const top = computeStandings(h).slice(0, 4);
  if (top.length < 4) return;
  const cfg = tcfg(state);
  const draw = () => {
    picker.innerHTML = `
    <div class="dlg">
      <div class="dlg-head">
        <h2 id="pickerTitle">🎾 Loppuottelu</h2>
        <button class="icon" id="foClose" aria-label="Sulje">✕</button>
      </div>
      <div class="dlg-body" id="foBody">
        <div class="info" style="text-align:center">
          <b>${esc(top[0].name)} &amp; ${esc(top[3].name)}</b><div class="muted small">1. ja 4.</div>
          <div style="margin:6px 0">vs</div>
          <b>${esc(top[1].name)} &amp; ${esc(top[2].name)}</b><div class="muted small">2. ja 3.</div>
        </div>
        ${tennisSettingsHtml(cfg)}
      </div>
      <div class="dlg-foot"><button id="foStart" class="primary big">▶ Aloita loppuottelu</button></div>
    </div>`;
    document.getElementById('foClose').onclick = closePicker;
    bindTennisSettings(document.getElementById('foBody'), cfg, draw);
    document.getElementById('foStart').onclick = () => { closePicker(); startFinal(h, top, cfg); };
  };
  draw();
  if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
}
function startFinal(h, top, cfg) {
  if (state.phase === 'play' && state.tid !== h.id && !finished() &&
      !confirm('Toinen turnaus on kesken. Se jää historiaan. Aloitetaanko loppuottelu?')) return;
  Object.assign(state, {
    phase: 'play', format: 'tennis', tennisMode: 'fixed', tennis: { ...cfg },
    players: top.map((r, i) => ({ id: i + 1, name: r.name })), nextId: Math.max(state.nextId, 5),
    finalOf: h.id, seriesId: h.seriesId || null, tid: newId(), startedAt: new Date().toISOString(),
    roundsTarget: 1, baseTarget: 1, rounds: [], view: 'matches', shownRound: 0, page: 'tournament', historyOpen: null,
    schedule: [{ matches: [{ court: 1, a: [1, 4], b: [2, 3], sa: null, sb: null }], byes: [] }],
  });
  addRound();
}

/* Joukkueiden vaihto lennossa (tennisottelu / loppuottelu, 4 pelaajaa).
   Jos ottelussa on jo pisteitä, se päättyy nykyiseen tilanteeseen ja uusi ottelu alkaa uusilla joukkueilla. */
function openSwapDialog() {
  const r = state.rounds[state.rounds.length - 1], m = r && r.matches[0];
  if (!m || state.players.length !== 4) return;
  const ids = state.players.map(p => p.id);
  const done = isScored(m), started = !!m.log;
  const key = (a, b) => [a, b].map(t => [...t].sort((x, y) => x - y).join('-')).sort().join('|');
  const cur = key(m.a, m.b);
  const opts = PAIRINGS.map(P => ({ a: [ids[P[0]], ids[P[1]]], b: [ids[P[2]], ids[P[3]]] }));
  const nm = t => t.map(id => esc(nameOf(id))).join(' &amp; ');
  const sc = started && !done ? tennisScoreText({ sets: shownSets(tennisReplay(m.log, tcfg(state))) }) : '';
  picker.innerHTML = `
  <div class="dlg">
    <div class="dlg-head">
      <h2 id="pickerTitle">🔄 ${done ? 'Uusi ottelu' : 'Vaihda joukkueet'}</h2>
      <button class="icon" id="swClose" aria-label="Sulje">✕</button>
    </div>
    <div class="dlg-body">
      <p class="muted small" style="margin-top:0">${done ? 'Valitse joukkueet seuraavaan otteluun. Pelatut ottelut pysyvät tuloksissa.'
        : started ? `Nykyinen ottelu päättyy tilanteeseen <b>${sc || 'kesken'}</b> ja tallentuu tuloksiin (johdossa oleva saa voiton). Uusi ottelu alkaa valituilla joukkueilla.`
        : 'Ottelussa ei ole vielä pisteitä, joten joukkueet vaihtuvat suoraan.'}</p>
      <div class="swap-list">
        ${opts.map((o, i) => {
          const same = key(o.a, o.b) === cur;
          return `<button class="swap-opt ${same ? 'on' : ''}" data-pair="${i}" ${same && !done ? 'disabled' : ''}>
            <span>${nm(o.a)}</span><span class="vs">vs</span><span>${nm(o.b)}</span>
            ${same ? `<span class="muted small">${done ? 'samat joukkueet uudestaan' : 'nykyiset joukkueet'}</span>` : ''}
          </button>`;
        }).join('')}
      </div>
    </div>
  </div>`;
  if (typeof picker.showModal === 'function') picker.showModal(); else picker.setAttribute('open', '');
  document.getElementById('swClose').onclick = closePicker;
  picker.querySelectorAll('[data-pair]').forEach(b => b.onclick = () => {
    const o = opts[+b.dataset.pair];
    const last = state.rounds[state.rounds.length - 1].matches[0];
    if (!last.log) { last.a = o.a; last.b = o.b; }
    else {
      if (!isScored(last)) { last.end = true; setMatchLog(last, last.log); }
      state.rounds.push({ matches: [{ court: 1, a: o.a, b: o.b, sa: null, sb: null }], byes: [] });
    }
    state.roundsTarget = state.rounds.length;
    state.shownRound = state.rounds.length - 1;
    state.view = 'matches';
    closePicker(); save(); render(); window.scrollTo(0, 0);
  });
}

/* Lopetus kesken: kesken olevat ottelut tallentuvat nykyiseen tilanteeseen, pelaamattomat poistetaan. */
function stopTournament() {
  const fx = fixedT(state);
  const what = fx ? (state.finalOf ? 'loppuottelu' : 'ottelu') : 'turnaus';
  if (!confirm(`Lopetetaanko ${what} tähän?\n\nKesken oleva ottelu tallentuu nykyisellä tilanteella: johdossa oleva joukkue (erät, sitten pelit) saa voiton. Pelaamattomat ottelut poistetaan. Tulokset jäävät historiaan.`)) return;
  state.rounds.forEach(r => {
    r.matches = r.matches.filter(m => isScored(m) || m.log);
    r.matches.forEach(m => { if (!isScored(m)) { m.end = true; setMatchLog(m, m.log); } });
  });
  state.rounds = state.rounds.filter(r => r.matches.length);
  if (!state.rounds.length) {
    // ei yhtään pelattua pistettä: ei mitään tallennettavaa
    db.history = db.history.filter(h => h.id !== state.tid);
    const sid = state.seriesId, back = state.finalOf;
    endTournament(); state.seriesId = sid;
    save();
    if (back && db.history.some(h => h.id === back)) return openTour(back);
    render(); window.scrollTo(0, 0); return;
  }
  state.roundsTarget = state.rounds.length;
  state.baseTarget = Math.min(state.baseTarget || 1, state.rounds.length);
  state.shownRound = state.rounds.length - 1;
  state.view = 'matches';
  save(); render(); window.scrollTo(0, 0);
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

function tableHtml(T, total) {
  const rows = computeStandings(T);
  const played = T.rounds.filter(r => roundComplete(r, T)).length;
  if (isTennis(T)) {
    const sd = (a, b) => `${a - b > 0 ? '+' : ''}${a - b}`;
    return `
  <section class="card">
    <h2>Sarjataulukko</h2>
    ${T.tennisMode === 'fixed' ? '' : `<p class="muted small">Pelattu ${played} / ${total} kierrosta</p>`}
    <table>
      <thead><tr><th>#</th><th>Pelaaja</th><th>V</th><th>O</th><th>H</th><th title="Erät">Erät</th><th title="Pelit">Pelit</th><th>+/−</th></tr></thead>
      <tbody>
      ${rows.map((x, i) => `<tr>
        <td><span class="rank ${i < 3 && x.played ? 'r' + (i + 1) : ''}">${i + 1}</span></td>
        <td>${playerLink(x.name)}${x.byes ? ` <span class="muted small">(${x.byes} tauko${x.byes > 1 ? 'a' : ''})</span>` : ''}</td>
        <td class="pts">${x.w}</td><td>${x.played}</td><td>${x.l}</td>
        <td>${x.setsW}–${x.setsL}</td><td>${x.pts}–${x.against}</td><td>${sd(x.pts, x.against)}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="muted small">V = voitetut ottelut, O = pelatut, H = häviöt, Erät ja Pelit = voitetut–hävityt, +/− = peliero. Järjestys: voitot, erä-ero, peliero.</p>
  </section>`;
  }
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
  const all = [...db.history].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const anyTennis = all.some(isTennis);
  const filter = anyTennis ? state.histFilter || 'all' : 'all';
  const hasParent = x => x.finalOf && db.history.some(p => p.id === x.finalOf);
  // Loppuottelut näytetään oman turnauksensa kortilla; tennissuodattimella omina kortteinaan.
  const items = all.filter(x => filter === 'tennis' ? isTennis(x) : filter === 'points' ? !isTennis(x) : !hasParent(x));
  app.innerHTML = `
  <section class="card">
    <h2>Turnaushistoria (${all.filter(x => !hasParent(x)).length})</h2>
    <p class="muted small">Turnaukset ja tulokset tallentuvat tähän automaattisesti. ${cloudOn() ? 'Tiedot jaetaan porukan kesken ja säilyvät myös tällä laitteella.' : 'Tiedot säilyvät tämän laitteen selaimessa.'}</p>
    ${anyTennis ? `
    <div class="seg">
      <button data-hfilter="all" class="${filter === 'all' ? 'on' : ''}">Kaikki</button>
      <button data-hfilter="points" class="${filter === 'points' ? 'on' : ''}">Pistepelit</button>
      <button data-hfilter="tennis" class="${filter === 'tennis' ? 'on' : ''}">🎾 Tennis</button>
    </div>` : ''}
  </section>
  ${cloudCardHtml()}
  ${items.map(histCardHtml).join('') || `<p class="muted">${filter === 'all' ? 'Ei vielä tallennettuja turnauksia.' : 'Ei turnauksia tällä valinnalla.'}</p>`}
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
  app.querySelectorAll('[data-hfilter]').forEach(b => b.onclick = () => { state.histFilter = b.dataset.hfilter; save(); render(); });
  bindCloudCard();
  document.getElementById('exportBtn').onclick = exportDb;
  const file = document.getElementById('importFile');
  document.getElementById('importBtn').onclick = () => file.click();
  file.onchange = () => { if (file.files[0]) importDb(file.files[0]); };
}

// Yhden ottelun (kiinteät parit) tulos historiassa
const singleMatch = h => fixedT(h) && h.rounds.length === 1 && h.rounds[0].matches[0];
function histCardHtml(x) {
  const top = computeStandings(x)[0];
  const played = x.rounds.filter(r => roundComplete(r, x)).length;
  const fin = !isTennis(x) && finalOf(x.id);
  const parent = x.finalOf && db.history.find(p => p.id === x.finalOf);
  const single = singleMatch(x);
  return `
    <button class="hist card" data-open="${x.id}">
      <div class="top"><span>${esc(fmtDate(x.date))}</span>
        <span class="tag ${x.finished ? '' : 'open'}">${x.finished ? 'Valmis' : 'Kesken'}</span></div>
      ${x.seriesId && seriesById(x.seriesId) ? `<div>⭐ ${esc(seriesById(x.seriesId).name)}</div>` : ''}
      <div class="muted">${fmtFormat(x)} · ${x.players.length} pelaajaa${single ? '' : ` · ${played}/${Math.max(x.roundsTarget || 0, x.rounds.length)} kierrosta`}</div>
      ${parent ? `<div class="muted small">Kuuluu turnaukseen ${fmtName(parent.format)} ${fmtDay(parent.date)}</div>` : ''}
      ${single ? `<div>${finalResultHtml(x)}</div>`
        : top && top.played ? `<div>${x.finished ? '🏆' : 'Johdossa:'} <b>${esc(top.name)}</b> (${scoreLabel(x, top)})</div>` : ''}
      ${fin ? `<div class="hist-final">🎾 Loppuottelu: ${finalResultHtml(fin)}</div>` : ''}
    </button>`;
}

function renderHistoryDetail(h) {
  const isCurrent = state.phase === 'play' && state.tid === h.id;
  const nm = id => esc(nameIn(h.players, id));
  const total = Math.max(h.roundsTarget || 0, h.rounds.length);
  const hs = h.seriesId && seriesById(h.seriesId);
  const ten = isTennis(h), single = singleMatch(h);
  const parent = h.finalOf && db.history.find(p => p.id === h.finalOf);
  const fin = !ten && finalOf(h.id);
  const cfg = ten ? tcfg(h) : null;
  const top4 = !ten && h.finished && !fin && h.players.length >= 4 ? computeStandings(h).slice(0, 4) : null;
  const matchLine = m => {
    const s = isScored(m, h);
    const A = `${nm(m.a[0])} &amp; ${nm(m.a[1])}`, B = `${nm(m.b[0])} &amp; ${nm(m.b[1])}`;
    let score = s ? `${m.sa}–${m.sb}` : '–';
    if (ten) { const r = tennisReplay(m.log, cfg); score = s ? tennisMatchText(m, h) : r.sets.length ? tennisScoreText(r) + ' …' : m.log ? 'kesken' : '–'; }
    const w = matchWinner(m, h);
    return `<div class="rres">${w === 'a' ? `<b>${A}</b>` : A} ${score} ${w === 'b' ? `<b>${B}</b>` : B}</div>`;
  };
  app.innerHTML = `
  <div class="actions" style="margin:0 0 12px"><button id="backBtn">← Takaisin historiaan</button></div>
  <section class="card">
    <h2>${esc(fmtDate(h.date))} <span class="tag ${h.finished ? '' : 'open'}">${h.finished ? 'Valmis' : 'Kesken'}</span></h2>
    <p class="muted" style="margin:0">${fmtFormat(h)}${single ? '' : ` · ${h.courts} kenttä${h.courts === 1 ? '' : 'ä'}`}</p>
    <p style="margin:8px 0 0"><b>${single ? 'Pelaajat' : 'Osallistujat'} (${h.players.length}):</b> ${h.players.map(p => esc(p.name)).sort(byName).join(', ')}</p>
    ${parent ? `<div class="btnrow"><button id="hParentBtn">← Turnaus ${fmtName(parent.format)} ${fmtDay(parent.date)}</button></div>`
    : hs ? `
    <div class="info series-banner" style="margin-top:10px"><span>⭐ Vakioturnaus: <b>${esc(hs.name)}</b></span></div>
    <div class="btnrow"><button id="hStatsBtn">📊 Tilastot</button><button id="hUnlinkBtn">Irrota vakioturnauksesta</button></div>`
    : '<div class="btnrow"><button id="hSeriesBtn">⭐ Tallenna vakioturnaukseksi</button></div>'}
  </section>
  ${single ? `
  <section class="card">
    <h2>🎾 ${parent ? 'Loppuottelu' : 'Ottelu'}</h2>
    <div class="final-res">${finalResultHtml(h)}</div>
  </section>` : tableHtml(h, total)}
  ${fin ? `
  <section class="card">
    <h2>🎾 Loppuottelu</h2>
    <div class="final-res">${finalResultHtml(fin)}</div>
    <div class="btnrow"><button id="hFinalBtn">Näytä loppuottelu</button></div>
  </section>` : top4 ? `
  <section class="card">
    <h2>🎾 Loppuottelu</h2>
    <p class="muted small" style="margin-top:0">Pelaa loppuottelu tennispisteillä: ${esc(top4[0].name)} &amp; ${esc(top4[3].name)} vs ${esc(top4[1].name)} &amp; ${esc(top4[2].name)} (1.+4. vs 2.+3.).</p>
    <button id="hStartFinal">🎾 Aloita loppuottelu</button>
  </section>` : ''}
  ${single ? '' : `
  <section class="card">
    <h2>Ottelut</h2>
    ${h.rounds.map((r, i) => `
      <p class="section-label" style="margin-top:${i ? 12 : 0}px">${fixedT(h) ? 'Ottelu' : 'Kierros'} ${i + 1}</p>
      ${r.matches.map(matchLine).join('')}
      ${r.byes.length ? `<div class="muted small">Tauolla: ${r.byes.map(nm).join(', ')}</div>` : ''}`).join('')}
  </section>`}
  <div class="actions">
    ${isCurrent ? `<button id="continueBtn" class="primary big">Jatka ${single ? 'ottelua' : 'turnausta'}</button>` : ''}
    ${!isCurrent && !h.finished ? `<button id="joinBtn" class="primary big">▶ Liity ${single ? 'otteluun ja laske pisteitä' : 'turnaukseen ja syötä tuloksia'}</button>` : ''}
    ${h.rounds.some(r => r.matches.some(m => isScored(m, h))) ? `<button id="shareHistBtn" ${isCurrent ? '' : 'class="primary big"'}>📤 Jaa ${h.finished ? 'tulokset' : 'tilanne'}</button>` : ''}
    ${canDeleteTour(h) ? '<button id="delHistBtn" class="danger">Poista turnaus historiasta</button>' : '<p class="muted small" style="text-align:center">Vain porukan ylläpitäjä voi poistaa valmiin turnauksen.</p>'}
  </div>`;
  document.getElementById('backBtn').onclick = () => { state.historyOpen = null; save(); render(); };
  const jb = document.getElementById('joinBtn');
  if (jb) jb.onclick = () => joinTournament(h.id);
  const shh = document.getElementById('shareHistBtn');
  if (shh) shh.onclick = () => shareResults(h.id);
  const hsb = document.getElementById('hSeriesBtn');
  if (hsb) hsb.onclick = () => openSeriesDialog(h.id);
  const hpb = document.getElementById('hParentBtn');
  if (hpb) hpb.onclick = () => openTour(parent.id);
  const hfb = document.getElementById('hFinalBtn');
  if (hfb) hfb.onclick = () => openTour(fin.id);
  const hsf = document.getElementById('hStartFinal');
  if (hsf) hsf.onclick = () => openFinalDialog(h.id);
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
    if (isCurrent) endTournament();
    state.historyOpen = null;
    save(); render();
  };
}

/* ---------- vakioturnaukset ---------- */
const seriesById = id => db.series.find(s => s.id === id);
const seriesTournaments = id => db.history.filter(h => h.seriesId === id && h.finished && !h.finalOf)
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
        <input id="sdName" class="grow" type="text" placeholder="Esim. Tiistaipadel" maxlength="40" autocomplete="off" required>
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
    const s = { id: newId(), name, players: h.players.map(p => p.name), format: h.format, points: h.points, tennis: h.tennis || null, tennisMode: h.tennisMode || null, created: new Date().toISOString() };
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
    const rows = computeStandings(h);
    return { h, rows, byName: new Map(rows.map((r, i) => [r.name.toLocaleLowerCase("fi"), { ...r, place: placeOf(h, rows, i), of: rows.length }])) };
  });
  const players = new Map();
  for (const t of tours) for (const [key, r] of t.byName) {
    if (!players.has(key)) players.set(key, { name: r.name, n: 0, wins: 0, podiums: 0, placeSum: 0, best: Infinity, pts: 0, games: 0, w: 0, played: 0 });
    const p = players.get(key);
    p.n++; p.placeSum += r.place; p.best = Math.min(p.best, r.place);
    if (r.place === 1) p.wins++;
    if (r.place <= 3) p.podiums++;
    p.w += r.w; p.played += r.played;
    if (!isTennis(t.h)) { p.pts += r.pts; p.games += r.played; }
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
    <p class="muted" style="margin:0">${fmtFormat(s)} · ${tours.length} pelattua turnausta${tours.length ? ` (${fmtDay(tours[0].h.date)}–${fmtDay(tours[tours.length - 1].h.date)})` : ''}</p>
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
        <td>${fmt1(p.avg)}</td><td>${p.best}.</td><td>${p.games ? fmt1(p.pts / p.games) : '–'}</td><td>${p.played ? Math.round(100 * p.w / p.played) : 0} %</td></tr>`).join('')}
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
    <button class="primary big" data-seasonshare="${yr}">🎉 Kauden ${yr} yhteenveto</button>
  </section>`;
  })()}
  <section class="card">
    <h2>Sijoitukset päivämäärittäin</h2>
    <div class="scroll-x">
    <table class="matrix">
      <thead><tr><th>Pelaaja</th>${tours.map(t => `<th>${fmtShort(t.h.date)}</th>`).join('')}</tr></thead>
      <tbody>${summary.map(p => `<tr><td>${playerLink(p.name)}</td>${tours.map(t => {
        const r = t.byName.get(p.key);
        return r ? `<td><span class="rank ${medal(r.place)}">${r.place}</span><div class="small muted">${isTennis(t.h) ? r.w + " V" : r.pts}</div></td>` : '<td class="muted">–</td>';
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
      <div>🏆 <b>${esc(winnerName(t.h, t.rows))}</b> (${scoreLabel(t.h, t.rows[0])})</div>
      <div class="muted small">${t.rows.map((r, i) => `${i + 1}. ${esc(r.name)} ${isTennis(t.h) ? r.w + " V" : r.pts}`).join(' · ')}</div>
    </button>`).join('')}
  </section>`}`;
  document.getElementById('backBtn').onclick = () => { state.page = state.statsBack || 'tournament'; state.statsOpen = null; save(); render(); window.scrollTo(0, 0); };
  document.getElementById('playSeriesBtn').onclick = () => {
    if (state.phase === 'play' && !finished() && !confirm('Toinen turnaus on kesken. Jätetäänkö se historiaan ja aloitetaan uusi?')) return;
    if (state.phase === "play") endTournament();
    selectSeries(s.id);
    state.page = 'tournament'; state.statsOpen = null;
    save(); render(); window.scrollTo(0, 0);
  };
  app.querySelectorAll('[data-season]').forEach(b => b.onclick = () => { state.seasonYear = b.dataset.season; save(); render(); });
  app.querySelectorAll('[data-seasonshare]').forEach(b => b.onclick = () => {
    const S = seasonSummary(s.id, b.dataset.seasonshare); if (!S) return;
    openShare(`Kauden ${S.year} yhteenveto`, seasonText(S), () => seasonImage(S), `kausi-${S.year}-${S.s.name.replace(/[^a-z0-9äöå]+/gi, '-')}`);
  });
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
  if (s.tennis) state.tennis = { ...s.tennis };
  if (s.tennisMode) state.tennisMode = s.tennisMode;
}

/* ---------- pilvisynkronointi (cloud.js) ---------- */
const roundsKey = rounds => stable((rounds || []).map(r => [r.byes, r.matches.map(m => [m.court, m.a, m.b, m.sa, m.sb, m.log || "", m.end ? 1 : 0])]));

/* Toisella puhelimella tehdyt muutokset käynnissä olevaan turnaukseen. */
function mergeCurrent() {
  if (state.phase !== 'play' || !state.tid) return false;
  const h = db.history.find(x => x.id === state.tid);
  if (!h) return false;
  if (roundsKey(h.rounds) === roundsKey(state.rounds) && h.roundsTarget === state.roundsTarget && (h.seriesId || null) === (state.seriesId || null)) return false;
  const wasLast = state.shownRound >= state.rounds.length - 1;
  state.rounds = copyRounds(h.rounds);
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
      endTournament(); state.seriesId = null;
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
    phase: "play", format: h.format, points: h.points,
    tennis: h.tennis || null, tennisMode: h.tennisMode || state.tennisMode, finalOf: h.finalOf || null,
    players: h.players.map(p => ({ id: p.id, name: p.name })),
    rounds: copyRounds(h.rounds),
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
// Turnaustason tilastot (sijoitukset, turnausvoitot): loppuottelut eivät ole erillisiä turnauksia
const mainTours = () => finishedTours().filter(h => !h.finalOf);

/* Ottelun tulos yhtenäisessä muodossa kaikille pistelaskuille:
   aw/bw = voittiko joukkue, share = A:n "tulososuus" rankingiin (0–1), margin = voiton selvyys (0–1),
   own/opp = pisteet (vain pisteturnauksissa), txt(flip) = tulos tekstinä. */
function matchResult(m, h) {
  if (!isScored(m, h)) return null;
  if (isTennis(h)) {
    const { r, w } = tennisOutcome(m, h);
    const [ga, gb] = r.games, aw = w === 'a', bw = w === 'b';
    const margin = w ? Math.max(0, ga + gb ? (aw ? ga - gb : gb - ga) / (ga + gb) : 0) : 0;
    const ws = 0.6 + 0.4 * margin; // voittaja saa aina yli puolet, selvä voitto enemmän
    return { aw, bw, share: w ? (aw ? ws : 1 - ws) : 0.5, margin, tennis: true, txt: flip => tennisMatchText(m, h, flip) };
  }
  if (m.sa + m.sb === 0) return null;
  return { aw: m.sa > m.sb, bw: m.sb > m.sa, share: m.sa / (m.sa + m.sb), margin: Math.abs(m.sa - m.sb) / h.points,
    own: m.sa, opp: m.sb, txt: flip => flip ? `${m.sb}–${m.sa}` : `${m.sa}–${m.sb}` };
}

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
      const res = matchResult(m, h);
      if (!res) continue;
      const A = m.a.map(id => get(h.players, id)), B = m.b.map(id => get(h.players, id));
      const ra = (A[0].r + A[1].r) / 2, rb = (B[0].r + B[1].r) / 2;
      const exp = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const delta = RATING_K * (res.share - exp);
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
  // pts/pg = pisteet ja pisteotteluiden määrä (tennisottelut eivät ole samaa mittakaavaa, joten ne eivät ole mukana P/ott.-luvuissa)
  const res = { name: null, tours: [], games: 0, w: 0, d: 0, l: 0, pts: 0, pg: 0, finals: 0, finalWins: 0, partners: new Map(), opps: new Map() };
  const bump = (map, name, won, pts) => {
    const k = nameKey(name);
    if (!map.has(k)) map.set(k, { key: k, name, g: 0, w: 0, pts: 0, pg: 0 });
    const x = map.get(k); x.g++; if (won) x.w++; if (pts !== null) { x.pts += pts; x.pg++; }
  };
  for (const h of tours) {
    const me = h.players.find(p => nameKey(p.name) === key);
    if (!me) continue;
    res.name = me.name;
    const rows = computeStandings(h);
    const idx = rows.findIndex(r => r.id === me.id), place = placeOf(h, rows, idx);
    if (h.finalOf) { res.finals++; if (place === 1 && rows[idx].played) res.finalWins++; }
    else res.tours.push({ h, place, of: rows.length, pts: rows[idx].pts, label: scoreLabel(h, rows[idx]), series: h.seriesId && seriesById(h.seriesId) });
    for (const r of h.rounds) for (const m of r.matches) {
      const mr = matchResult(m, h);
      if (!mr) continue;
      const inA = m.a.includes(me.id), inB = m.b.includes(me.id);
      if (!inA && !inB) continue;
      const won = inA ? mr.aw : mr.bw, lost = inA ? mr.bw : mr.aw;
      const own = mr.tennis ? null : inA ? mr.own : mr.opp;
      const mate = (inA ? m.a : m.b).find(id => id !== me.id);
      res.games++;
      if (own !== null) { res.pts += own; res.pg++; }
      if (won) res.w++; else if (lost) res.l++; else res.d++;
      bump(res.partners, nameIn(h.players, mate), won, own);
      (inA ? m.b : m.a).forEach(id => bump(res.opps, nameIn(h.players, id), won, own));
    }
  }
  return res;
}

function seasonTable(sid, year) {
  const rows = new Map();
  for (const h of mainTours().filter(t => t.seriesId === sid && (!year || (t.date || "").startsWith(String(year))))) {
    computeStandings(h).forEach((r, i, arr) => {
      const k = nameKey(r.name);
      if (!rows.has(k)) rows.set(k, { key: k, name: r.name, sp: 0, n: 0, wins: 0 });
      const x = rows.get(k); const pl = placeOf(h, arr, i); x.sp += seasonPointsFor(pl); x.n++; if (pl === 1) x.wins++;
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
  const ach = computeAchievements();
  const list = [...ratings.values()].sort((a, b) => b.r - a.r || byName(a.name, b.name));
  const toursBy = new Map();
  for (const h of mainTours()) h.players.forEach(p => toursBy.set(nameKey(p.name), (toursBy.get(nameKey(p.name)) || 0) + 1));
  app.innerHTML = `
  <section class="card">
    <h2>🏅 Ranking</h2>
    <p class="muted small" style="margin-top:0">Ranking lasketaan kaikista pelatuista otteluista. Kaikki aloittavat ${RATING_START}:sta. Voitto vahvempaa paria vastaan nostaa enemmän, ja myös voiton marginaali vaikuttaa. Napauta pelaajaa nähdäksesi pelaajakortin.</p>
    ${list.length ? `
    <table class="stats">
      <thead><tr><th>#</th><th>Pelaaja</th><th>Ranking</th><th title="Ottelut">O</th><th title="Turnaukset">Turn.</th></tr></thead>
      <tbody>${list.map((p, i) => `<tr><td>${i + 1}</td><td>${playerLink(p.name)}${badgeIcons(ach, p.name)}</td><td class="pts">${Math.round(p.r)}</td><td>${p.games}</td><td>${toursBy.get(p.key) || 0}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="muted" style="margin:0">Ei vielä pelattuja turnauksia.</p>'}
  </section>
  ${recordsHtml(ach)}`;
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
      <div><span class="kv">${st.pg ? fmt1(st.pts / st.pg) : "–"}</span><span class="kl">Pist./ottelu</span></div>
    </div>
    <p class="muted small" style="margin:8px 0 0">${st.games} ottelua: ${st.w} voittoa, ${st.d ? st.d + ' tasapeliä, ' : ''}${st.l} tappiota · ${podiums} mitalisijaa${st.finals ? ` · 🎾 loppuotteluita ${st.finals}, voittoja ${st.finalWins}` : ""}</p>
    ${seriesIds.length ? `
    <div class="seg" style="margin-top:10px">
      <button data-pfilter="" class="${filter ? '' : 'on'}">Kaikki</button>
      ${seriesIds.map(id => `<button data-pfilter="${id}" class="${filter === id ? 'on' : ''}">${esc(seriesById(id).name)}</button>`).join('')}
    </div>` : ''}
  </section>
  ${badgesHtml(computeAchievements(), key)}
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
      <tbody>${partners.map((p, i) => `<tr><td>${i + 1}</td><td>${playerLink(p.name)}</td><td>${p.g}</td><td class="pts">${pct(p.w, p.g)}</td><td>${p.pg ? fmt1(p.pts / p.pg) : "–"}</td></tr>`).join('')}</tbody>
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
      <div class="muted small">${t.series ? '⭐ ' + esc(t.series.name) + ' · ' : ''}${fmtName(t.h.format)} · ${t.label}</div>
    </button>`).join('')}
  </section>` : '<section class="card"><p class="muted" style="margin:0">Ei vielä pelattuja turnauksia.</p></section>'}`;
  document.getElementById('backBtn').onclick = () => { state.page = state.playerBack && state.playerBack !== 'player' ? state.playerBack : 'players'; save(); render(); window.scrollTo(0, 0); };
  app.querySelectorAll('[data-pfilter]').forEach(b => b.onclick = () => { state.playerFilter = b.dataset.pfilter || null; save(); render(); });
  app.querySelectorAll('[data-openh]').forEach(b => b.onclick = () => { state.page = 'history'; state.historyOpen = b.dataset.openh; save(); render(); window.scrollTo(0, 0); });
  bindCharts();
}

/* ---------- ennätykset ja saavutukset ---------- */
/* Kaikki pelatut ottelut aikajärjestyksessä nimien kera. */
function allMatches(tours) {
  const out = [];
  for (const h of tours) h.rounds.forEach((r, ri) => r.matches.forEach(m => {
    const res = matchResult(m, h);
    if (!res) return;
    out.push({ h, ri, A: m.a.map(id => nameIn(h.players, id)), B: m.b.map(id => nameIn(h.players, id)), ...res });
  }));
  return out;
}
const pairKey = (x, y) => [x, y].map(nameKey).sort().join('|');
// Ottelu voittaja edellä: { W, L, ws, ls }
const winFirst = x => x.bw ? { W: x.B, L: x.A, score: x.txt(true) } : { W: x.A, L: x.B, score: x.txt(false) };

const BADGES = [
  { id: 'winner', icon: '🏆', title: 'Turnausvoittaja', desc: 'Voitti turnauksen' },
  { id: 'hattrick', icon: '👑', title: 'Hattutemppu', desc: '3 turnausvoittoa' },
  { id: 'podium3', icon: '🎯', title: 'Tasainen', desc: 'Mitalisijalla 3 turnauksessa peräkkäin' },
  { id: 'perfect', icon: '💯', title: 'Täydellinen turnaus', desc: 'Voitti turnauksen kaikki ottelunsa' },
  { id: 'streak5', icon: '🔥', title: 'Kuumana', desc: '5 ottelun voittoputki' },
  { id: 'streak10', icon: '☄️', title: 'Pysäyttämätön', desc: '10 ottelun voittoputki' },
  { id: 'crush', icon: '💥', title: 'Murskavoitto', desc: 'Voitti ottelun vähintään 2/3:n marginaalilla (esim. 20–4)' },
  { id: 'dreamteam', icon: '🤝', title: 'Unelmapari', desc: '5 voittoa saman parin kanssa' },
  { id: 'rocket', icon: '📈', title: 'Nousukiito', desc: 'Ranking nousi yhdessä turnauksessa vähintään 30' },
  { id: 'peak1100', icon: '⭐', title: 'Huippukunto', desc: 'Ranking vähintään 1100' },
  { id: 'regular', icon: '🎖️', title: 'Vakiokasvo', desc: '10 turnausta' },
  { id: "workhorse", icon: "🐎", title: "Työjuhta", desc: "50 ottelua" },
  { id: "final", icon: "🎾", title: "Finaalivoittaja", desc: "Voitti loppuottelun" },
];

/* Ennätykset ja jokaisen pelaajan saavutukset yhdellä läpikäynnillä. */
function computeAchievements() {
  const tours = finishedTours();
  const ratings = computeRatings();
  const P = new Map(); // key -> { name, badges:Set, streak, best, tours, wins, games, podiumRun, partnerWins:Map }
  const pl = name => {
    const k = nameKey(name);
    if (!P.has(k)) P.set(k, { key: k, name, badges: new Set(), streak: 0, best: 0, tours: 0, wins: 0, games: 0, podiumRun: 0, partnerWins: new Map() });
    return P.get(k);
  };
  const rec = { bigWin: null, bestTour: null, pairs: new Map() };
  for (const h of tours) {
    const rows = computeStandings(h);
    if (h.finalOf) {
      // loppuottelu: voittajapari saa merkin, mutta se ei ole erillinen turnaus
      rows.filter((r, i) => r.played && placeOf(h, rows, i) === 1).forEach(r => pl(r.name).badges.add('final'));
    } else rows.forEach((r, i) => {
      const p = pl(r.name); p.tours++;
      const place = placeOf(h, rows, i);
      if (place === 1) { p.wins++; p.badges.add("winner"); if (r.l === 0 && r.d === 0 && r.played >= 2) p.badges.add("perfect"); }
      p.podiumRun = place <= 3 ? p.podiumRun + 1 : 0;
      if (p.podiumRun >= 3) p.badges.add('podium3');
      if (r.played >= 3 && !isTennis(h)) {
        const ppg = r.pts / r.played / h.points; // osuus ottelun pisteistä
        if (!rec.bestTour || ppg > rec.bestTour.ppg) rec.bestTour = { ppg, name: r.name, pts: r.pts, played: r.played, h };
      }
    });
    for (const m of allMatches([h])) {
      const aWin = m.aw, bWin = m.bw, margin = m.margin;
      if (margin > 0 && (!rec.bigWin || margin > rec.bigWin.margin)) rec.bigWin = { margin, m, h };
      [[m.A, aWin, bWin], [m.B, bWin, aWin]].forEach(([team, won, lost]) => {
        team.forEach((n, i) => {
          const p = pl(n); p.games++;
          if (won) { p.streak++; p.best = Math.max(p.best, p.streak); if (margin >= 2 / 3) p.badges.add('crush'); }
          else p.streak = 0;
          const mate = team[1 - i];
          if (won) { const c = (p.partnerWins.get(nameKey(mate)) || 0) + 1; p.partnerWins.set(nameKey(mate), c); if (c >= 5) p.badges.add('dreamteam'); }
        });
        const pk = pairKey(team[0], team[1]);
        if (!rec.pairs.has(pk)) rec.pairs.set(pk, { names: [...team].sort(byName), g: 0, w: 0 });
        const x = rec.pairs.get(pk); x.g++; if (won) x.w++;
      });
    }
  }
  for (const p of P.values()) {
    if (p.wins >= 3) p.badges.add('hattrick');
    if (p.best >= 5) p.badges.add('streak5');
    if (p.best >= 10) p.badges.add('streak10');
    if (p.tours >= 10) p.badges.add('regular');
    if (p.games >= 50) p.badges.add('workhorse');
    const r = ratings.get(p.key);
    if (r) {
      let prev = RATING_START, peak = RATING_START;
      for (const x of r.hist) { if (x.r - prev >= 30) p.badges.add('rocket'); prev = x.r; peak = Math.max(peak, x.r); }
      p.peak = peak;
      if (peak >= 1100) p.badges.add('peak1100');
    }
  }
  const list = [...P.values()];
  const top = (f, min = 1) => { const best = list.filter(p => f(p) >= min).sort((a, b) => f(b) - f(a))[0]; return best ? { name: best.name, v: f(best) } : null; };
  const pairsArr = [...rec.pairs.values()];
  const minPairG = pairsArr.some(x => x.g >= 4) ? 4 : 2;
  const bestPair = pairsArr.filter(x => x.g >= minPairG).sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g)[0];
  return {
    players: P,
    records: {
      bigWin: rec.bigWin, bestTour: rec.bestTour, bestPair,
      streak: top(p => p.best, 2), tourWins: top(p => p.wins), tours: top(p => p.tours), games: top(p => p.games),
      peak: top(p => Math.round(p.peak || 0), RATING_START + 1),
    },
  };
}
const badgeIcons = (ach, name, max = 3) => {
  const p = ach.players.get(nameKey(name)); if (!p) return '';
  const icons = BADGES.filter(b => p.badges.has(b.id)).reverse().slice(0, max).map(b => `<span title="${esc(b.title)}">${b.icon}</span>`).join('');
  return icons ? ` <span class="badges">${icons}</span>` : '';
};

function recordsHtml(ach) {
  const R = ach.records;
  const item = (icon, title, body) => body ? `<div class="rec"><span class="rec-i">${icon}</span><div><div class="kl">${title}</div>${body}</div></div>` : '';
  const mt = x => { const w = winFirst(x.m); return `<b>${esc(w.W.join(" & "))}</b> ${w.score} ${esc(w.L.join(" & "))}`; };
  const fmt1 = v => v.toLocaleString('fi-FI', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const html = [
    item('🏆', 'Eniten turnausvoittoja', R.tourWins && `${playerLink(R.tourWins.name)} · <b>${R.tourWins.v}</b>`),
    item('🔥', 'Pisin voittoputki', R.streak && `${playerLink(R.streak.name)} · <b>${R.streak.v} ottelua</b>`),
    item('💥', 'Suurin voitto', R.bigWin && `${mt(R.bigWin)}<div class="small muted">${fmtDay(R.bigWin.h.date)}</div>`),
    item('🚀', 'Paras turnaus', R.bestTour && `${playerLink(R.bestTour.name)} · <b>${fmt1(R.bestTour.pts / R.bestTour.played)} p/ottelu</b><div class="small muted">${fmtDay(R.bestTour.h.date)} · ${R.bestTour.h.points} p ottelut</div>`),
    item('🤝', 'Paras pari', R.bestPair && `${esc(R.bestPair.names.join(' & '))} · <b>${Math.round(100 * R.bestPair.w / R.bestPair.g)} %</b> <span class="small muted">(${R.bestPair.g} ott.)</span>`),
    item('⭐', 'Korkein ranking', R.peak && `${playerLink(R.peak.name)} · <b>${R.peak.v}</b>`),
    item('🎖️', 'Eniten turnauksia', R.tours && `${playerLink(R.tours.name)} · <b>${R.tours.v}</b>`),
    item('🐎', 'Eniten otteluita', R.games && `${playerLink(R.games.name)} · <b>${R.games.v}</b>`),
  ].join('');
  return html ? `<section class="card"><h2>📜 Ennätykset</h2><div class="recs">${html}</div></section>` : '';
}

function badgesHtml(ach, key) {
  const p = ach.players.get(key);
  const have = p ? p.badges : new Set();
  return `
  <section class="card">
    <h2>🏅 Saavutukset (${have.size}/${BADGES.length})</h2>
    <div class="badge-grid">
      ${BADGES.map(b => `<div class="badge ${have.has(b.id) ? 'got' : ''}" title="${esc(b.desc)}">
        <span class="bi">${b.icon}</span><span class="bt">${esc(b.title).replace(/(.{4,})(voittaja|mätön|voitto|temppu|kasvo|kunto|kiito)$/, '$1&shy;$2')}</span><span class="bd">${esc(b.desc)}</span></div>`).join('')}
    </div>
  </section>`;
}

/* ---------- kauden päättäjäiset: yhteenveto ja jaettava kuva ---------- */
function seasonSummary(sid, year) {
  const s = seriesById(sid);
  const inSeason = h => h.seriesId === sid && (h.date || "").startsWith(String(year));
  const withFinals = finishedTours().filter(inSeason); // ottelutilastoihin myös loppuottelut
  const tours = withFinals.filter(h => !h.finalOf);
  if (!tours.length) return null;
  const table = seasonTable(sid, year);
  const ratings = computeRatings();
  const first = tours[0].date, last = withFinals[withFinals.length - 1].date;
  // Eniten kehittynyt: rankingin muutos kauden alusta loppuun (väh. 2 turnausta kaudella)
  let improved = null;
  for (const row of table.filter(r => r.n >= 2)) {
    const hist = (ratings.get(row.key) || { hist: [] }).hist;
    const before = [...hist].reverse().find(x => x.date < first);
    const after = [...hist].reverse().find(x => x.date <= last);
    if (!after) continue;
    const d = after.r - (before ? before.r : RATING_START);
    if (!improved || d > improved.d) improved = { name: row.name, d };
  }
  // Paras pari ja suurin voitto kaudella
  const pairs = new Map(); let bigWin = null;
  for (const x of allMatches(withFinals)) {
    const margin = x.margin;
    if (margin > 0 && (!bigWin || margin > bigWin.margin)) bigWin = { margin, x };
    [[x.A, x.aw], [x.B, x.bw]].forEach(([t, won]) => {
      const k = pairKey(t[0], t[1]);
      if (!pairs.has(k)) pairs.set(k, { names: [...t].sort(byName), g: 0, w: 0 });
      const p = pairs.get(k); p.g++; if (won) p.w++;
    });
  }
  const pa = [...pairs.values()]; const minG = pa.some(p => p.g >= 3) ? 3 : 1;
  const bestPair = pa.filter(p => p.g >= minG).sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g)[0];
  const active = [...table].sort((a, b) => b.n - a.n || b.sp - a.sp)[0];
  return { s, year, tours, table, improved, bestPair, bigWin, active };
}

function seasonText(S) {
  const L = [
    `🎉 *${S.s.name} – kausi ${S.year}*`,
    `${kpl(S.tours.length, 'turnaus', 'turnausta')} · ${S.table.length} pelaajaa`,
    '',
    `🏆 *Kauden mestari: ${S.table[0].name}* (${S.table[0].sp} p)`,
    ...S.table.slice(1, 3).map((r, i) => `${['🥈', '🥉'][i]} ${r.name} (${r.sp} p)`),
    '',
  ];
  if (S.improved && S.improved.d > 0) L.push(`📈 Eniten kehittynyt: ${S.improved.name} (ranking +${Math.round(S.improved.d)})`);
  if (S.bestPair) L.push(`🤝 Kauden paras pari: ${S.bestPair.names.join(' & ')} (${Math.round(100 * S.bestPair.w / S.bestPair.g)} % voittoja)`);
  if (S.bigWin) { const w = winFirst(S.bigWin.x); L.push(`💥 Kauden suurin voitto: ${w.W.join(" & ")} ${w.score} ${w.L.join(" & ")}`); }
  if (S.active) L.push(`🎖️ Ahkerin: ${S.active.name} (${kpl(S.active.n, 'turnaus', 'turnausta')})`);
  return L.join('\n');
}

function seasonImage(S) {
  const W = 1080, H = 1350, PAD = 72;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fit = (t, max) => { let s = t; while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -1); return s === t ? s : s.slice(0, -1) + '…'; };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  // tausta
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1849b8'); bg.addColorStop(.6, '#1d63e0'); bg.addColorStop(1, '#1393d8');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = font(600, 36); g.globalAlpha = .9; g.fillText(`🎉 Kauden päättäjäiset ${S.year}`, W / 2, 110); g.globalAlpha = 1;
  g.font = font(800, 60); g.fillText(fit(S.s.name, W - 2 * PAD), W / 2, 185);
  // mestari
  g.font = font(400, 150); g.fillText('🏆', W / 2, 370);
  g.font = font(600, 34); g.globalAlpha = .9; g.fillText('KAUDEN MESTARI', W / 2, 430); g.globalAlpha = 1;
  g.font = font(800, 76); g.fillText(fit(S.table[0].name, W - 2 * PAD), W / 2, 515);
  g.font = font(600, 36); g.fillText(`${S.table[0].sp} pistettä · ${S.table[0].wins} turnausvoittoa`, W / 2, 568);
  // 2. ja 3.
  const half = (W - 2 * PAD - 24) / 2;
  S.table.slice(1, 3).forEach((r, i) => {
    const x = PAD + i * (half + 24), y = 610;
    g.fillStyle = 'rgba(255,255,255,.16)'; rr(x, y, half, 120, 24); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'left';
    g.font = font(400, 54); g.fillText(['🥈', '🥉'][i], x + 24, y + 82);
    g.font = font(700, 38); g.fillText(fit(r.name, half - 130), x + 100, y + 62);
    g.font = font(500, 28); g.globalAlpha = .85; g.fillText(`${r.sp} pistettä`, x + 100, y + 98); g.globalAlpha = 1;
  });
  // palkinnot valkoisella kortilla
  const awards = [
    S.improved && S.improved.d > 0 && ['📈', 'Eniten kehittynyt', S.improved.name, `ranking +${Math.round(S.improved.d)}`],
    S.bestPair && ['🤝', 'Kauden paras pari', S.bestPair.names.join(' & '), `${Math.round(100 * S.bestPair.w / S.bestPair.g)} % voittoja`],
    S.bigWin && (w => ['💥', 'Suurin voitto', w.W.join(" & "), w.score])(winFirst(S.bigWin.x)),
    S.active && ['🎖️', 'Ahkerin', S.active.name, kpl(S.active.n, 'turnaus', 'turnausta')],
  ].filter(Boolean);
  const top = 770, rowH = 118;
  g.fillStyle = '#ffffff'; rr(PAD - 16, top, W - 2 * PAD + 32, awards.length * rowH + 30, 32); g.fill();
  awards.forEach((a, i) => {
    const y = top + 15 + i * rowH;
    if (i) { g.fillStyle = '#d3e0f1'; g.fillRect(PAD + 10, y, W - 2 * PAD - 20, 2); }
    g.textAlign = 'left'; g.fillStyle = '#12233d';
    g.font = font(400, 54); g.fillText(a[0], PAD + 14, y + 78);
    g.font = font(600, 26); g.fillStyle = '#586a84'; g.fillText(a[1].toUpperCase(), PAD + 100, y + 44);
    g.font = font(800, 38); g.fillStyle = '#12233d'; g.fillText(fit(a[2], W - 2 * PAD - 420), PAD + 100, y + 90);
    g.textAlign = 'right'; g.font = font(600, 30); g.fillStyle = '#1d5fd1'; g.fillText(fit(a[3], 330), W - PAD - 10, y + 88);
  });
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = font(500, 28); g.globalAlpha = .85;
  g.fillText(`${kpl(S.tours.length, 'turnaus', 'turnausta')} · ${S.table.length} pelaajaa · ${fmtDay(S.tours[0].date)}–${fmtDay(S.tours[S.tours.length - 1].date)}`, W / 2, H - 50);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

/* ---------- tulosten jakaminen (teksti WhatsAppiin, kuva) ---------- */
const fmtName = f => f === "americano" ? "Americano" : f === "tennis" ? "Tennis" : "Mexicano";
const tennisDesc = cfg => [cfg.sets === 3 ? "paras 3:sta" : "1 erä", cfg.games === 4 ? "4 pelin erät" : "", cfg.golden && cfg.entry === "points" ? "kultainen piste" : "", cfg.sets === 3 && cfg.stb ? "supertiebreak" : ""].filter(Boolean).join(" · ");
// Turnausmuoto kuvauksena: "Americano · 24 p" tai "🎾 Loppuottelu · paras 3:sta · kultainen piste"
const fmtFormat = T => isTennis(T)
  ? `🎾 ${T.finalOf ? "Loppuottelu" : T.tennisMode === "fixed" ? "Tennisottelu" : "Tennis, vaihtuvat parit"} · ${tennisDesc(tcfg(T))}`
  : `${fmtName(T.format)} · ${T.points} p`;
const medalEmoji = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const kpl = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Yhden ottelun tulos tekstinä, voittaja ensin: "Liisa & Pekka 6–4 6–3 Matti & Anna"
function finalText(f) {
  if (!singleMatch(f)) {
    const rows = computeStandings(f);
    if (!rows[0] || !rows[0].played) return `${kpl(f.rounds.length, 'ottelu', 'ottelua')} (kesken)`;
    return `${f.finished ? '' : 'Johdossa: '}${winnerName(f, rows)} (${scoreLabel(f, rows[0])}) · ${kpl(f.rounds.length, 'ottelu', 'ottelua')}`;
  }
  const m = f.rounds[0].matches[0];
  const { r, w } = tennisOutcome(m, f);
  const nm = ids => ids.map(id => nameIn(f.players, id)).join(' & ');
  if (!isScored(m, f)) return `${nm(m.a)} vs ${nm(m.b)} (kesken${r.sets.length ? ' ' + tennisScoreText(r) : ''})`;
  if (!w) return `${nm(m.a)} ${tennisMatchText(m, f)} ${nm(m.b)} (tasan)`;
  const [W, L] = w === 'a' ? [m.a, m.b] : [m.b, m.a];
  return `${nm(W)} ${tennisMatchText(m, f, w === 'b')} ${nm(L)}`;
}

function resultsText(h) {
  const rows = computeStandings(h);
  const played = h.rounds.filter(r => roundComplete(r, h)).length;
  const s = h.seriesId && seriesById(h.seriesId);
  const ten = isTennis(h), single = singleMatch(h);
  const fin = !ten && finalOf(h.id);
  const lines = [
    `🎾 *${s && !h.finalOf ? s.name : single ? (h.finalOf ? 'Loppuottelu' : 'Padel-ottelu') : 'Padel ' + fmtName(h.format)}* – ${fmtDay(h.date)}`,
    `${fmtFormat(h).replace(/^🎾 /, '')}${single ? '' : ` · ${h.players.length} pelaajaa · ${kpl(played, 'kierros', 'kierrosta')}`}`,
  ];
  if (single) lines.push('', h.finished ? `🏆 *${finalText(h)}*` : finalText(h));
  else {
    lines.push(h.finished ? '*Lopputulokset*' : `*Tilanne ${played}. kierroksen jälkeen*`, '');
    lines.push(...rows.map((r, i) => ten
      ? `${medalEmoji(i)} ${r.name} – ${r.w}/${r.played} V · erät ${r.setsW}–${r.setsL} · pelit ${r.pts}–${r.against}`
      : `${medalEmoji(i)} ${r.name} – ${r.pts} p (${r.w}/${r.played} V)`));
  }
  if (fin) lines.push('', `🎾 *Loppuottelu:* ${finalText(fin)}`);
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
    [...tours].reverse().forEach(t => lines.push(`${fmtShort(t.h.date)} ${winnerName(t.h, t.rows)} (${scoreLabel(t.h, t.rows[0])})`));
  }
  return lines.join('\n');
}

/* Tulostaulukko kuvaksi (PNG), aina vaalealla sinisellä teemalla. */
function resultsImage(h) {
  const rows = computeStandings(h);
  const played = h.rounds.filter(r => roundComplete(r, h)).length;
  const s = h.seriesId && seriesById(h.seriesId);
  const ten = isTennis(h), single = singleMatch(h);
  const fin = !ten && finalOf(h.id);
  const W = 1080, PAD = 64, HEAD = 280, ROW = 86, FOOT = fin ? 160 : 110;
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
  g.fillText(fit(single ? finalText(h) : h.finished ? "Lopputulokset" : `Tilanne ${played}. kierroksen jälkeen`, W - 2 * PAD), PAD, 206); g.globalAlpha = 1;
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
    g.fillText(ten ? `${r.w} V` : `${r.pts} p`, W - PAD, cy + 14);
    g.font = font(500, 26); g.fillStyle = "#586a84";
    g.fillText(ten ? `erät ${r.setsW}–${r.setsL}` : `${r.w}/${r.played} V`, W - PAD - 150, cy + 10);
    g.textAlign = 'left';
  });
  g.font = font(500, 28); g.fillStyle = '#586a84';
  if (fin) { g.font = font(700, 30); g.fillStyle = "#12233d"; g.fillText(fit("🎾 Loppuottelu: " + finalText(fin), W - 2 * PAD), PAD, H - 96); }
  g.font = font(500, 28); g.fillStyle = "#586a84";
  g.fillText(fit(`${fmtFormat(h)} · ${h.players.length} pelaajaa${single ? "" : " · " + kpl(played, "kierros", "kierrosta")}`, W - 2 * PAD), PAD, H - 46);
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
