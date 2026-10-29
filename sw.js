// Site Defects service worker.
// Online: always fetches the newest app files from the server (so updates arrive on the next open).
// Offline or very weak signal: serves the copy saved on the phone.
const VERSION = 'site-defects-v1.4.1';
const FILES = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'xlsx.full.min.js',
  'jszip.min.js',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache so the saved copy is always the newest.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(new Promise(resolve => {
    let settled = false;
    const done = r => { if (!settled && r) { settled = true; resolve(r); } };
    // Weak signal: fall back to the saved copy after a few seconds.
    const timer = setTimeout(() => fromCache(req).then(done), NETWORK_TIMEOUT_MS);
    fetch(req, { cache: 'no-cache' }).then(res => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
        done(res);
      } else {
        fromCache(req).then(hit => done(hit || res));
      }
    }).catch(() => {
      clearTimeout(timer);
      fromCache(req).then(hit => done(hit || Response.error()));
    });
  }));
});
