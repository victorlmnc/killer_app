(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, geo = K.geo;
  K.views = K.views || {};

  function hexYear(year) { // couleur injectée dans un style : on n'accepte qu'un vrai code hexadécimal
    var y = (store.state.settings.years || []).find(function (x) { return x.name === year; });
    return y && /^#[0-9a-f]{3,8}$/i.test(y.color) ? y.color : '#8A93A0';
  }

  K.views.map = {
    title: 'Map',
    render: function (root) {
      var LISTS = [['tous', 'Tous'], ['vivants', 'Vivants'], ['cibles', 'Cibles de l\'alliance'], ['killers', 'Killers de l\'alliance']];
      var focus = (location.hash.match(/[?&]joueur=([^&]+)/) || [])[1] || null;
      var view = { list: 'tous', placing: null, fit: true, busy: false };
      var map = null, layer = null, pins = new Map(), gone = false;

      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Joueurs affichés' });
      var hint = h('div', { class: 'link-hint map-hint', hidden: true });
      var box = h('div', { class: 'map', role: 'application', 'aria-label': 'Carte des joueurs localisés' }, h('p', { class: 'map-wait' }, 'Chargement de la carte…'));
      var located = h('section', { class: 'panel' }), missing = h('section', { class: 'panel' });
      [chips, hint, box, located, missing].forEach(function (el) { root.appendChild(el); });

      function shown() {
        var st = store.state, dead = L.deadSet(st), round = L.currentRound(st), wanted = null;
        if (view.list === 'cibles' || view.list === 'killers') {
          wanted = new Set();
          if (round) st.players.forEach(function (p) {
            if (!p.is_ally || dead.has(p.id)) return;
            var r = view.list === 'cibles' ? L.resolveTarget(st, round.id, p.id) : L.resolveHunter(st, round.id, p.id);
            if (r.id) wanted.add(r.id);
          });
        }
        return { dead: dead, players: st.players.filter(function (p) {
          if (wanted) return wanted.has(p.id);
          return view.list !== 'vivants' || !dead.has(p.id);
        }) };
      }

      function popup(place, dead) {
        return h('div', { class: 'map-pop' }, place.players.map(function (p) {
          return h('div', { class: 'map-pop-item' }, h('strong', { class: dead.has(p.id) ? 'is-dead' : '' }, p.name), h('span', {}, p.address),
            h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.openPlayer(p.id); } }, 'Ouvrir la fiche'));
        }));
      }

      function goTo(p) {
        if (!map || !L.hasCoords(p)) return;
        var pin = pins.get(p.id);
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16));
        if (pin) pin.openPopup();
        if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }

      function drawPins(s, places) {
        if (!map) return;
        layer.clearLayers(); pins.clear();
        places.forEach(function (place) {
          var allDead = place.players.every(function (p) { return s.dead.has(p.id); }), ally = place.players.some(function (p) { return p.is_ally; });
          var n = place.players.length, first = place.players.find(function (p) { return !s.dead.has(p.id); }) || place.players[0];
          var icon = window.L.divIcon({ className: 'pin-wrap', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12],
            html: '<span class="pin' + (allDead ? ' pin-dead' : '') + (ally ? ' pin-ally' : '') + '" style="--year:' + hexYear(first.year) + '">' + (n > 1 ? n : '') + '</span>' });
          var title = place.players.map(function (p) { return p.name; }).join(', ');
          var m = window.L.marker([place.lat, place.lng], { icon: icon, title: title, alt: title, keyboard: true }).bindPopup(function () { return popup(place, L.deadSet(store.state)); }, { maxWidth: 270, minWidth: 190 });
          layer.addLayer(m);
          place.players.forEach(function (p) { pins.set(p.id, m); });
        });
        if (view.fit && places.length) {
          view.fit = false;
          if (places.length === 1) map.setView([places[0].lat, places[0].lng], 16);
          else map.fitBounds(places.map(function (pl) { return [pl.lat, pl.lng]; }), { padding: [36, 36], maxZoom: 17 });
        }
      }

      function refresh() {
        var s = shown(), places = L.places(s.players);
        var here = s.players.filter(function (p) { return L.hasAddress(p) && L.hasCoords(p); }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var lost = store.state.players.filter(function (p) { return L.hasAddress(p) && !L.hasCoords(p); }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });

        ui.clear(chips);
        LISTS.forEach(function (l) {
          chips.appendChild(h('button', { type: 'button', class: 'chip' + (view.list === l[0] ? ' is-on' : ''), 'aria-pressed': String(view.list === l[0]),
            onclick: function () { view.list = l[0]; view.fit = true; refresh(); } }, l[1]));
        });

        var placing = view.placing && store.player(view.placing);
        hint.hidden = !placing;
        ui.clear(hint);
        if (placing) { hint.appendChild(h('span', {}, 'Touche la carte là où se trouve l\'adresse de ' + placing.name + '.'));
          hint.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { view.placing = null; refresh(); } }, 'Annuler')); }
        box.classList.toggle('is-placing', !!placing);

        drawPins(s, places);

        ui.clear(located);
        located.appendChild(h('h2', {}, 'Joueurs localisés', h('small', { class: 'muted' }, ' ' + here.length)));
        if (!here.length) located.appendChild(h('p', { class: 'empty' }, view.list === 'tous' || view.list === 'vivants'
          ? 'Personne sur la carte pour l\'instant. Renseigne une adresse sur une fiche : le point se place tout seul.'
          : 'Aucun de ces joueurs n\'a d\'adresse localisée, ou la chaîne ne les désigne pas encore.'));
        here.forEach(function (p) {
          located.appendChild(h('div', { class: 'row map-row' + (s.dead.has(p.id) ? ' is-dead' : '') },
            h('button', { type: 'button', class: 'row row-btn', 'aria-label': 'Montrer ' + p.name + ' sur la carte', onclick: function () { goTo(p); } },
              ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, p.address)), ui.yearTag(p)),
            h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.openPlayer(p.id); } }, 'Fiche')));
        });

        ui.clear(missing);
        missing.hidden = !lost.length;
        if (lost.length) {
          missing.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, 'Adresses à localiser', h('small', { class: 'muted' }, ' ' + lost.length)),
            h('button', { type: 'button', class: 'btn btn-primary', disabled: view.busy, onclick: locateAll }, view.busy ? 'Recherche en cours…' : 'Localiser ces adresses')));
          missing.appendChild(h('p', { class: 'prose muted small' }, 'Si une adresse reste introuvable (résidence sans numéro, faute de frappe), corrige-la sur la fiche ou place le point à la main.'));
          lost.forEach(function (p) {
            missing.appendChild(h('div', { class: 'row map-row map-row-lost' },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, p.address)),
              h('button', { type: 'button', class: 'btn', disabled: !map, onclick: function () { view.placing = p.id; refresh(); if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 'Placer sur la carte'),
              h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.editPlayer(p.id); } }, 'Corriger')));
          });
        }
      }

      function locateAll() {
        view.busy = true; refresh();
        geo.locateAll().then(function (r) {
          view.busy = false; view.fit = true; refresh();
          ui.toast(r.found + ' adresse' + (r.found > 1 ? 's localisées' : ' localisée') + (r.total - r.found ? ', ' + (r.total - r.found) + ' introuvable' + (r.total - r.found > 1 ? 's' : '') : '') + '.');
        });
      }

      geo.loadLeaflet().then(function (Lf) {
        if (gone) return;
        ui.clear(box);
        var c = geo.center();
        map = Lf.map(box, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lng], 13);
        Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
          attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map);
        layer = Lf.layerGroup().addTo(map);
        map.on('click', function (e) {
          if (!view.placing) return;
          var id = view.placing; view.placing = null;
          store.update('players', id, { lat: e.latlng.lat, lng: e.latlng.lng }).then(function () { ui.toast('Point placé.'); });
        });
        refresh();
        if (focus && store.player(focus)) setTimeout(function () { goTo(store.player(focus)); }, 60);
      }).catch(function () {
        if (gone) return;
        box.classList.add('map-off');
        ui.clear(box).appendChild(h('p', { class: 'map-wait' }, 'Le fond de carte ne peut pas se charger ici (hors ligne, ou aperçu qui bloque les ressources externes). La liste ci-dessous reste utilisable ; sur le site déployé, la carte s\'affiche normalement.'));
      });

      refresh();
      refresh.destroy = function () { gone = true; if (map) { map.remove(); map = null; } };
      return refresh;
    }
  };
})();
