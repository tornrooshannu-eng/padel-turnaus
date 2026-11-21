/* Service worker: sovellus toimii myös ilman nettiyhteyttä.
   Muista nostaa VERSION ja index.html:n ?v= -tunnisteet jokaisessa julkaisussa. */
const VERSION = 'v8';
const CACHE = 'padel-' + VERSION;
const SHELL = [
  './',
  'style.css?v=8',
  'app.js?v=8',
  'cloud.js?v=8',
  'cloud-config.js?v=8',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('padel-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase-kirjastot (versioitu CDN): välimuistiin, jotta pilviyhteys toimii myös offline-käynnistyksessä
  if (url.href.startsWith('https://www.gstatic.com/firebasejs/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Sivu: verkosta ensin (uusin versio), heikolla yhteydellä 4 s jälkeen välimuistista.
  if (req.mode === 'navigate') {
    e.respondWith(
      Promise.race([fetch(req), timeout(4000)])
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); }
          return res;
        })
        .catch(() => caches.match('./').then(hit => hit || caches.match(req, { ignoreSearch: true })))
    );
    return;
  }

  // Tyylit, skripti, kuvakkeet: välimuistista (versioitu), muuten verkosta ja talteen.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
