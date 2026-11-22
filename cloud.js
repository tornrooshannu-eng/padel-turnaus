// Pilvisynkronointi porukan kesken (Firebase Firestore + nimetön kirjautuminen).
// Paikallinen tietokanta (app.js) on käyttöliittymän lähde; tämä moduuli peilaa sen
// Firestoreen ja tuo muiden muutokset takaisin reaaliajassa.
//   groups/{porukkakoodi}                       { name, created }
//   groups/{porukkakoodi}/tournaments/{id}      turnaus (pisteet erillisessä scores-kartassa)
//   groups/{porukkakoodi}/series|lists/{id}     vakioturnaukset, pelaajalistat
//   groups/{porukkakoodi}/players/{nimi}        tallennetut pelaajat
import { FIREBASE_CONFIG } from './cloud-config.js?v=12';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const KEY = 'padel-cloud';
const KINDS = ['tournaments', 'series', 'lists', 'players'];
const App = window.PadelApp;

let fb = null;
let unsubs = [];
let last = freshLast();       // id -> { json, form }: viimeksi pilvessä nähty versio
let sig = {};                 // laji -> allekirjoitus (turhien päivitysten ohitus)
let ready = new Set();        // lajit, joista on saatu ensimmäinen tilannekuva
let pushTimer = null;
let status = 'off';           // off | connecting | online | offline | error
let errorMsg = '';
let group = loadGroup();

function freshLast() { return Object.fromEntries(KINDS.map(k => [k, new Map()])); }
function loadGroup() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
function storeGroup(g) { try { g ? localStorage.setItem(KEY, JSON.stringify(g)) : localStorage.removeItem(KEY); } catch (e) { /* */ } }
function setStatus(s, msg = '') {
  if (s === status && msg === errorMsg) return;
  status = s; errorMsg = msg; App.cloudChanged();
}

/* --- apurit --- */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const clean = o => JSON.parse(JSON.stringify(o));
const playerId = name => encodeURIComponent(name.toLocaleLowerCase('fi')).replace(/\./g, '%2E').slice(0, 400);
const idOf = (kind, obj) => kind === 'players' ? playerId(obj) : obj.id;
const listOf = (db, kind) => kind === 'tournaments' ? db.history : db[kind];
function newGroupId() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(24));
  return [...r].map(x => abc[x % abc.length]).join('');
}

/* Turnaus pilvimuodossa: ottelurakenne ja pisteet erikseen, jotta kaksi puhelinta voi
   syöttää eri kenttien tuloksia yhtä aikaa ilman että toinen ylikirjoittaa toisen. */
function toForm(kind, obj) {
  if (kind === 'players') return { name: obj };
  if (kind !== 'tournaments') return clean(obj);
  const scores = {};
  const rounds = (obj.rounds || []).map((r, ri) => ({
    byes: r.byes || [],
    matches: r.matches.map((m, mi) => {
      // tennis: pisteloki (log) kulkee samassa kentässä, jolloin yksittäinen piste on yksi kenttäpäivitys
      if (Number.isInteger(m.sa) && Number.isInteger(m.sb)) scores[`r${ri}m${mi}`] = m.log ? { sa: m.sa, sb: m.sb, log: m.log, ...(m.end ? { end: true } : {}) } : { sa: m.sa, sb: m.sb };
      else if (m.log) scores[`r${ri}m${mi}`] = { log: m.log };
      return { court: m.court, a: m.a, b: m.b };
    }),
  }));
  return clean({ ...obj, rounds, scores });
}
function fromForm(kind, data) {
  if (kind === 'players') return data.name;
  if (kind !== 'tournaments') return data;
  const { scores = {}, ...rest } = data;
  rest.rounds = (rest.rounds || []).map((r, ri) => ({
    matches: (r.matches || []).map((m, mi) => {
      const s = scores[`r${ri}m${mi}`];
      const o = { court: m.court, a: m.a, b: m.b, sa: s && Number.isInteger(s.sa) ? s.sa : null, sb: s && Number.isInteger(s.sb) ? s.sb : null };
      if (s && s.log) o.log = s.log;
      if (s && s.end) o.end = true;
      return o;
    }),
    byes: r.byes || [],
  }));
  return rest;
}
const structKey = form => { const { scores, finished, updated, ...s } = form; return stable(s); };

/* --- Firebase --- */
async function loadSdk() {
  if (fb) return fb;
  const [appM, authM, F] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
  ]);
  const app = appM.initializeApp(FIREBASE_CONFIG);
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { fs = F.getFirestore(app); }
  fb = { fs, auth: authM.getAuth(app), A: authM, F };
  return fb;
}
async function ensureAuth() {
  const { auth, A } = fb;
  await new Promise(res => { const u = A.onAuthStateChanged(auth, () => { u(); res(); }); });
  if (!auth.currentUser) await A.signInAnonymously(auth);
}
const col = kind => fb.F.collection(fb.fs, 'groups', group.id, kind);

/* --- lähetys: vertaa paikallista tietokantaa viimeksi nähtyyn ja kirjoita vain muutokset --- */
function schedulePush() {
  if (!group) return;
  if (!fb || ready.size < KINDS.length) {
    // yhteys katki (ei vielä kertaakaan muodostettu): lähetetään kaikki, kun yhteys palaa
    if (status === 'error' || status === 'offline') { try { localStorage.setItem('padel-cloud-dirty', '1'); } catch (e) { /* */ } }
    return;
  }
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; pushNow(); }, 250);
}
function onWriteError(e) {
  console.warn('Pilvitallennus:', e);
  setStatus('error', e.code === 'permission-denied' ? 'ei oikeutta – vain ylläpitäjä voi poistaa' : (e.code || e.message));
}

function pushNow() {
  if (!group || !fb) return;
  const { F } = fb;
  const db = App.getDb();
  for (const kind of KINDS) {
    const prev = last[kind];
    const cur = new Map();
    for (const obj of listOf(db, kind)) cur.set(idOf(kind, obj), toForm(kind, obj));
    for (const [id, form] of cur) {
      const json = stable(form);
      const p = prev.get(id);
      if (p && p.json === json) continue;
      const ref = F.doc(col(kind), id);
      if (kind === 'tournaments' && p && structKey(p.form) === structKey(form)) {
        // vain pisteet muuttuivat: päivitetään yksittäiset kentät
        const upd = { finished: !!form.finished, updated: form.updated || null };
        const before = p.form.scores || {};
        for (const k of new Set([...Object.keys(form.scores), ...Object.keys(before)])) {
          if (stable(form.scores[k]) !== stable(before[k])) upd['scores.' + k] = form.scores[k] || F.deleteField();
        }
        F.updateDoc(ref, upd).catch(onWriteError);
      } else {
        F.setDoc(ref, form).catch(onWriteError);
      }
      prev.set(id, { json, form });
    }
    for (const id of [...prev.keys()]) {
      if (!cur.has(id)) { F.deleteDoc(F.doc(col(kind), id)).catch(onWriteError); prev.delete(id); }
    }
  }
}

/* --- vastaanotto --- */
function listen() {
  const { F } = fb;
  unsubs.forEach(u => u()); unsubs = [];
  ready = new Set(); sig = {};
  for (const kind of KINDS) {
    unsubs.push(F.onSnapshot(col(kind), { includeMetadataChanges: true }, snap => {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; pushNow(); return; } // omat muutokset ensin
      const map = new Map(), items = [];
      snap.forEach(d => { const data = d.data(); map.set(d.id, { json: stable(data), form: data }); items.push(fromForm(kind, data)); });
      last[kind] = map;
      const s = stable([...map.entries()].map(([id, v]) => [id, v.json]).sort());
      const first = !ready.has(kind);
      ready.add(kind);
      if (first || s !== sig[kind]) {
        sig[kind] = s;
        if (kind === 'tournaments') items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        App.applyRemote(kind, items);
      }
      setStatus(snap.metadata.fromCache && !navigator.onLine ? 'offline' : 'online');
    }, err => setStatus('error', err.code || err.message)));
  }
}

async function connect(mergeLocal) {
  setStatus('connecting');
  try {
    await loadSdk();
    await ensureAuth();
    last = freshLast();
    let dirty = false;
    try { dirty = !!localStorage.getItem('padel-cloud-dirty'); } catch (e) { /* */ }
    if (mergeLocal || dirty) { pushNow(); try { localStorage.removeItem('padel-cloud-dirty'); } catch (e) { /* */ } }   // tyhjä vertailukohta = kaikki paikalliset tiedot pilveen
    listen();
    checkAdmin();
  } catch (e) {
    console.warn('Pilviyhteys:', e);
    setStatus(navigator.onLine ? 'error' : 'offline', e.code || e.message);
  }
}
function disconnect() {
  unsubs.forEach(u => u()); unsubs = [];
  clearTimeout(pushTimer); pushTimer = null;
  ready = new Set(); last = freshLast(); sig = {};
}

window.addEventListener('online', () => { if (group && (status === 'error' || status === 'offline') && !unsubs.length) connect(false); else if (group) setStatus('online'); });
window.addEventListener('offline', () => { if (group) setStatus('offline'); });

/* --- julkinen rajapinta app.js:lle --- */
/* --- ylläpitäjä: vain ylläpitäjä voi poistaa valmiita turnauksia ja vakioturnauksia ---
   adminTokens/{gid}            { token }  (kukaan ei voi lukea; säännöt vertaavat siihen)
   groups/{gid}/admins/{uid}    { token }  (luonti onnistuu vain oikealla tunnisteella) */
let isAdmin = false, hasAdmin = false;
async function checkAdmin() {
  if (!group || !fb) return;
  const { F, fs, auth } = fb;
  try {
    const [me, g] = await Promise.all([
      F.getDoc(F.doc(fs, 'groups', group.id, 'admins', auth.currentUser.uid)),
      F.getDoc(F.doc(fs, 'groups', group.id)),
    ]);
    isAdmin = me.exists(); hasAdmin = !!(g.exists() && g.data().hasAdmin);
  } catch (e) { /* offline: pidetään edellinen tieto */ }
  App.cloudChanged();
}
async function becomeAdmin(token) {
  const { F, fs, auth } = fb;
  await F.setDoc(F.doc(fs, 'groups', group.id, 'admins', auth.currentUser.uid), { token });
  group = { ...group, adminToken: token }; storeGroup(group);
  isAdmin = true; hasAdmin = true;
  App.cloudChanged();
}
async function claimAdmin() {
  await loadSdk(); await ensureAuth();
  const { F, fs } = fb;
  const token = newGroupId() + newGroupId();
  try { await F.setDoc(F.doc(fs, 'adminTokens', group.id), { token }); }
  catch (e) { throw new Error('Porukalla on jo ylläpitäjä. Pyydä häneltä ylläpitäjälinkki.'); }
  await becomeAdmin(token);
  await F.updateDoc(F.doc(fs, 'groups', group.id), { hasAdmin: true }).catch(() => {});
}

window.PadelCloud = {
  available: !!FIREBASE_CONFIG,
  get status() { return status; },
  get error() { return errorMsg; },
  get group() { return group; },
  get isAdmin() { return isAdmin; },
  get hasAdmin() { return hasAdmin; },
  inviteLink() { return group ? location.origin + location.pathname + '#liity=' + group.id : ''; },
  adminLink() { return group && group.adminToken ? location.origin + location.pathname + '#liity=' + group.id + '&yp=' + group.adminToken : ''; },
  notifyLocalChange: schedulePush,
  async createGroup(name) {
    await loadSdk(); await ensureAuth();
    const id = newGroupId();
    await fb.F.setDoc(fb.F.doc(fb.fs, 'groups', id), { name, created: new Date().toISOString() });
    group = { id, name }; storeGroup(group);
    await claimAdmin();
    await connect(true);
  },
  async joinGroup(id, adminToken) {
    await loadSdk(); await ensureAuth();
    const snap = await fb.F.getDoc(fb.F.doc(fb.fs, 'groups', id));
    if (!snap.exists()) throw new Error('Porukkaa ei löytynyt. Tarkista koodi tai linkki.');
    group = { id, name: snap.data().name || 'Porukka' }; storeGroup(group);
    let badToken = false;
    if (adminToken) { try { await becomeAdmin(adminToken); } catch (e) { badToken = true; } }
    await connect(true);
    if (badToken) throw new Error('Liityit porukkaan jäsenenä, mutta ylläpitäjälinkki ei kelpaa.');
  },
  claimAdmin,
  leave() {
    disconnect(); group = null; isAdmin = false; hasAdmin = false; storeGroup(null); setStatus('off');
  },
};

if (FIREBASE_CONFIG) {
  if (group) connect(false);
  const m = location.hash.match(/liity=([A-Za-z0-9]{20,})(?:&yp=([A-Za-z0-9]{20,}))?/);
  if (m) { history.replaceState(null, '', location.pathname + location.search); App.offerJoin(m[1], m[2]); }
}
App.cloudChanged();
