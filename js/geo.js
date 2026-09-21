/* Géolocalisation des adresses et chargement de la carte.
   - Géocodage : service public de la Géoplateforme (IGN), successeur de l'API Adresse. Seul le TEXTE de l'adresse
     part chez eux, jamais le nom du joueur. Les coordonnées obtenues sont rangées dans la fiche (lat, lng).
   - Carte : Leaflet, chargé seulement quand on ouvre l'onglet Map ; fond OpenStreetMap. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var GEOCODER = 'https://data.geopf.fr/geocodage/search';
  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  var MIN_SCORE = 0.45;
  var geo = K.geo = {};

  geo.center = function () {
    var c = K.store.state.settings.map_center;
    return c && isFinite(c.lat) && isFinite(c.lng) ? c : { lat: 47.0833, lng: 2.4 }; // Bourges
  };

  /* → { lat, lng, label, score } ou null si rien de convaincant */
  geo.geocode = function (address) {
    var q = String(address || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (q.length < 3) return Promise.resolve(null);
    var c = geo.center();
    var url = GEOCODER + '?limit=1&q=' + encodeURIComponent(q) + '&lat=' + c.lat + '&lon=' + c.lng; // lat/lon : priorité aux résultats proches
    return fetch(url, { referrerPolicy: 'no-referrer' }).then(function (res) {
      if (!res.ok) throw new Error('Géocodage indisponible (' + res.status + ')');
      return res.json();
    }).then(function (data) {
      var f = data && data.features && data.features[0];
      if (!f || !f.geometry || !f.geometry.coordinates) return null;
      var score = f.properties && typeof f.properties.score === 'number' ? f.properties.score : 1;
      if (score < MIN_SCORE) return null;
      return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: (f.properties && f.properties.label) || q, score: score };
    });
  };

  /* Géocode l'adresse d'un joueur et range le résultat dans sa fiche. → true si localisé */
  geo.locatePlayer = function (playerId) {
    var p = K.store.player(playerId);
    if (!p || !K.logic.hasAddress(p)) return Promise.resolve(false);
    return geo.geocode(p.address).then(function (hit) {
      if (!hit) return false;
      return K.store.update('players', playerId, { lat: hit.lat, lng: hit.lng }).then(function () { return true; });
    }).catch(function (err) { console.error(err); return false; });
  };

  /* Localise en série tous les joueurs qui ont une adresse mais pas de point. onStep(done, total) */
  geo.locateAll = function (onStep) {
    var L = K.logic, todo = K.store.state.players.filter(function (p) { return L.hasAddress(p) && !L.hasCoords(p); }).map(function (p) { return p.id; });
    var found = 0, i = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve({ total: todo.length, found: found });
      return geo.locatePlayer(todo[i++]).then(function (ok) {
        if (ok) found++;
        if (onStep) onStep(i, todo.length);
        return new Promise(function (r) { setTimeout(r, 120); }); // on reste très loin de la limite de 50 requêtes par seconde
      }).then(next);
    }
    return next();
  };

  var leaflet = null;
  geo.loadLeaflet = function () {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise(function (resolve, reject) {
      var fail = function () { leaflet = null; reject(new Error('carte indisponible')); };
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
