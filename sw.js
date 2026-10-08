/* Service worker: makes the app installable and lets it open without a connection.
   Network first for the app's own files (and the database library and fonts it loads), so a new version is picked
   up at once; the cache is only a fallback. Game data never goes through it: the database, photos and the
   timetable relay are not cached here (the app keeps its own read-only copy of the data). */
var CACHE = 'qg-killer-v2';
var SHARED = ['fonts.googleapis.com', 'fonts.gstatic.com'];   // the fonts, not data (the libraries are in vendor/, same origin)

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || (url.origin !== self.location.origin && SHARED.indexOf(url.hostname) < 0)) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) { return hit || (req.mode === 'navigate' ? caches.match('./') : undefined); })
      .then(function (hit) { return hit || Response.error(); });
  }));
});
