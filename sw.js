// Service worker: caches the static app shell so the app runs offline.
// It never stores user data — that lives in IndexedDB, which this file does not touch.
//
// Release checklist: bump CACHE_VERSION (and APP_VERSION in js/version.js) whenever any file
// changes, and add new static files to ASSETS (a unit test verifies the list is complete).

const CACHE_PREFIX = 'training-diary-';
const CACHE_VERSION = '1.1.0';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/actions.js',
  'js/app.js',
  'js/backup.js',
  'js/csv-import.js',
  'js/charts.js',
  'js/db.js',
  'js/device.js',
  'js/ics.js',
  'js/icons.js',
  'js/migrations.js',
  'js/model.js',
  'js/seed.js',
  'js/shell.js',
  'js/store.js',
  'js/training-aids.js',
  'js/ui.js',
  'js/util.js',
  'js/validate.js',
  'js/version.js',
  'js/workout-logic.js',
  'js/views/activity.js',
  'js/views/history.js',
  'js/views/home.js',
  'js/views/library.js',
  'js/views/progress.js',
  'js/views/settings.js',
  'js/views/train.js',
  'js/views/workout.js',
  'vendor/chartjs/chart.umd.min.js',
  'vendor/chartjs/LICENSE.md',
  'icons/icon.svg',
  'icons/icon-maskable.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files.
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    // No skipWaiting here: the page asks the user before switching to a new version.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Only delete our own old caches; never touch caches of other apps on the same origin.
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App navigation: serve the cached shell (hash routing means one HTML page).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('index.html');
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        return new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p style="font-family:system-ui;padding:2rem">Training Diary has not been downloaded to this device yet. Connect to the internet once to install it.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Static assets: cache first, then network (and keep a copy for next time).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
