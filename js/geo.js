/* Address geocoding and map loading.
   - Geocoding: the French public geocoder (IGN Géoplateforme, successor of api-adresse.data.gouv.fr). Only the address
     text is sent, never the player's name. Coordinates are stored on the player (lat, lng). Any other geocoder that
     speaks the same GeoJSON "features" format can be plugged in through settings.geocoder_url.
   - Map: Leaflet, loaded on first use of the Map tab; OpenStreetMap tiles. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var DEFAULT_GEOCODER = 'https://data.geopf.fr/geocodage/search';
  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  var MIN_SCORE = 0.45;
  var geo = K.geo = {};

  geo.center = function () {
    var c = K.store.state.settings.map_center;
    return c && isFinite(c.lat) && isFinite(c.lng) ? c : { lat: 48.8566, lng: 2.3522 };
  };
  function geocoderUrl() { return K.ui.safeUrl(K.store.state.settings.geocoder_url) || DEFAULT_GEOCODER; }

  /* -> { lat, lng, label, score } or null when nothing convincing came back */
  geo.geocode = function (address) {
    var q = String(address || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (q.length < 3) return Promise.resolve(null);
    var c = geo.center();
    var url = geocoderUrl() + '?limit=1&q=' + encodeURIComponent(q) + '&lat=' + c.lat + '&lon=' + c.lng; // lat/lon: prefer nearby results
    return fetch(url, { referrerPolicy: 'no-referrer' }).then(function (res) {
      if (!res.ok) throw new Error('Geocoder unavailable (' + res.status + ')');
      return res.json();
    }).then(function (data) {
      var f = data && data.features && data.features[0];
      if (!f || !f.geometry || !f.geometry.coordinates) return null;
      var score = f.properties && typeof f.properties.score === 'number' ? f.properties.score : 1;
      if (score < MIN_SCORE) return null;
      return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: (f.properties && f.properties.label) || q, score: score };
    });
  };

  geo.locatePlayer = function (playerId) {
    var p = K.store.player(playerId);
    if (!p || !K.logic.hasAddress(p)) return Promise.resolve(false);
    return geo.geocode(p.address).then(function (hit) {
      if (!hit) return false;
      return K.store.update('players', playerId, { lat: hit.lat, lng: hit.lng }).then(function () { return true; });
    }).catch(function (err) { console.error(err); return false; });
  };

  /* Geocodes every player with an address but no marker, one at a time. */
  geo.locateAll = function (onStep) {
    var L = K.logic, todo = K.store.state.players.filter(function (p) { return L.hasAddress(p) && !L.hasCoords(p); }).map(function (p) { return p.id; });
    var found = 0, i = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve({ total: todo.length, found: found });
      return geo.locatePlayer(todo[i++]).then(function (ok) {
        if (ok) found++;
        if (onStep) onStep(i, todo.length);
        return new Promise(function (r) { setTimeout(r, 120); });
      }).then(next);
    }
    return next();
  };

  /* Bus layer: data/bus.js is produced by tools/build_bus.py. Missing file -> null, the map works without it. */
  var bus;
  geo.loadBus = function () {
    if (window.KILLER_BUS) return Promise.resolve(window.KILLER_BUS);
    if (bus) return bus;
    bus = new Promise(function (resolve) {
      var js = document.createElement('script'); js.src = 'data/bus.js';
      js.onload = function () { resolve(window.KILLER_BUS || null); };
      js.onerror = function () { resolve(null); };
      document.head.appendChild(js);
    });
    return bus;
  };

  var leaflet = null;
  geo.loadLeaflet = function () {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise(function (resolve, reject) {
      var fail = function () { leaflet = null; reject(new Error('map unavailable')); };
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css'; css.onerror = fail;
      css.onload = function () {
        var js = document.createElement('script'); js.src = LEAFLET + 'leaflet.min.js'; js.onerror = fail;
        js.onload = function () { if (window.L && window.L.map) resolve(window.L); else fail(); };
        document.head.appendChild(js);
      };
      document.head.appendChild(css);
    });
    return leaflet;
  };
})();
