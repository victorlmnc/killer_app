/* Service worker: makes the app installable and lets it open without a connection.
   Network first for the app's own files, so a new version is picked up at once; the cache is only a fallback.
   Game data never goes through it: the database, photos and the timetable relay are other origins. */
var CACHE = 'qg-killer-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok && res.type === 'basic') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) { return hit || (req.mode === 'navigate' ? caches.match('./') : undefined); })
      .then(function (hit) { return hit || Response.error(); });
  }));
});
