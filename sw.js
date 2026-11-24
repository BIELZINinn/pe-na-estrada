const C = 'penaestrada-v2', T = 'pe-tiles', L = 'pe-libs';
const F = ['./', 'index.html', 'style.css', 'app.js', 'extras.js', 'sync.js', 'offline.js', 'nav.js', 'fx.js', 'config.js', 'version.js', 'manifest.json', 'icon.svg', 'logo.svg'];
const LIBS = ['https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
const TILEHOST = 'tiles.openfreemap.org', LIBHOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(Promise.all([caches.open(C).then(c => Promise.all(F.map(u => c.add(u).catch(() => { })))), caches.open(L).then(c => Promise.all(LIBS.map(u => c.add(u).catch(() => { }))))]));
});
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => ![C, T, L].includes(x)).map(x => caches.delete(x)))).then(() => self.clients.claim())));
const put = (name, r, x) => { if (x && (x.ok || x.type === 'opaque')) { const cp = x.clone(); caches.open(name).then(c => c.put(r, cp)).catch(() => { }); } return x; };
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) { e.respondWith(fetch(r).then(x => put(C, r, x)).catch(() => caches.match(r, { ignoreSearch: true }))); return; }
  if (u.hostname === TILEHOST) {
    const asset = /\/(fonts|sprites?)\//.test(u.pathname), meta = /\/styles\//.test(u.pathname) || !/\.[a-z0-9]+$/i.test(u.pathname);
    if (meta) e.respondWith(fetch(r).then(x => put(T, r, x)).catch(() => caches.match(r)));
    else e.respondWith(caches.match(r).then(m => m || fetch(r).then(x => asset ? put(T, r, x) : x)));
    return;
  }
  if (LIBHOSTS.includes(u.hostname)) e.respondWith(caches.match(r).then(m => { const n = fetch(r).then(x => put(L, r, x)).catch(() => m); return m || n; }));
});
