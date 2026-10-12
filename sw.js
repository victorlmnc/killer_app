/* Service worker: makes the app installable and lets it open without a connection.
   Network first for the app's own files (and the fonts it loads), so a new version is picked up at once; the cache is
   only a fallback. The app's files are always checked with the server (no-cache: a quick "not modified" when nothing
   changed), never taken from the browser's HTTP cache, which GitHub Pages lets keep a file for 10 minutes. Game data never goes through it: the database, photos and the
   timetable relay are not cached here (the app keeps its own read-only copy of the data). */
var CACHE = 'qg-killer-v3';
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
  var own = url.origin === self.location.origin;
  // a page load cannot be copied with other options: its address is fetched instead
  var net = !own ? fetch(req) : req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(net.then(function (res) {
    if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) { return hit || (req.mode === 'navigate' ? caches.match('./') : undefined); })
      .then(function (hit) { return hit || Response.error(); });
  }));
});
