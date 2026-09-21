(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, geo = K.geo;
  K.views = K.views || {};
  var PREFS = 'killer-qg-map-v1';

  // Pictogrammes des calques (chaînes fixes, aucun contenu saisi n'y entre)
  var GLYPH = {
    normale: '',
    coloc: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.3"/><circle cx="11" cy="6" r="2"/><path d="M1 13.5c0-2.6 2-4.2 4.5-4.2s4.5 1.6 4.5 4.2zM10.6 13.5c0-1.5-.5-2.7-1.4-3.6.5-.3 1.100-.4 1.800-.4 2.200 0 4 1.400 4 4z"/></svg>',
    immeuble: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.500h10v13H9.500v-3h-3v3H3zM5 3.500v2h2v-2zm4 0v2h2v-2zM5 7.500v2h2v-2zm4 0v2h2v-2z" fill-rule="evenodd"/></svg>',
    residence: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.500 3h1.800v5.500h11.200V14h-1.800v-2H3.300v2H1.500zM4.300 5.200h3.200v2.300H4.300zM8.500 5.200h4.200c1 0 1.800.8 1.800 1.800v.5h-6z"/></svg>',
    spot: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.500 1.500h1.500v.8h8l-2 3 2 3h-8v6.200H3.500z"/></svg>'
  };
  function hex(c, fallback) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback; } // seule une vraie couleur entre dans un style
  function hexYear(year) { var y = (store.state.settings.years || []).find(function (x) { return x.name === year; }); return hex(y && y.color, '#8A93A0'); }
  function pinHtml(kind, o) {
    o = o || {};
    return '<span class="pin pin-' + kind + (o.dead ? ' pin-dead' : '') + (o.ally ? ' pin-ally' : '') + '"' + (o.year ? ' style="--year:' + o.year + '"' : '') + '>' + GLYPH[kind]
      + (o.count > 1 ? '<b class="pin-count">' + o.count + '</b>' : '') + '</span>';
  }

  function loadPrefs() { try { var p = JSON.parse(localStorage.getItem(PREFS)); if (p && p.hidden && p.bus) return p; } catch (e) { /* rien */ } return { hidden: [], bus: [] }; }

  K.views.map = {
    title: 'Map',
    render: function (root) {
      var LISTS = [['tous', 'Tous'], ['vivants', 'Vivants'], ['cibles', 'Cibles de l\'alliance'], ['killers', 'Killers de l\'alliance']];
      var focus = (location.hash.match(/[?&]joueur=([^&]+)/) || [])[1] || null;
      var view = { list: 'tous', placing: null, fit: true, busy: false };
      var prefs = loadPrefs(), bus = null, busReady = false;
      var map = null, layer = null, busLayer = null, pins = new Map(), gone = false;

      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Joueurs affichés' });
      var hint = h('div', { class: 'link-hint map-hint', hidden: true });
      var box = h('div', { class: 'map', role: 'application', 'aria-label': 'Carte des joueurs et des lieux' }, h('p', { class: 'map-wait' }, 'Chargement de la carte…'));
      var layersBody = h('div', { class: 'layers-body' });
      var layers = h('details', { class: 'panel layers', open: window.innerWidth > 820 }, h('summary', {}, h('h2', {}, 'Calques')), layersBody);
      var located = h('section', { class: 'panel' }), spotsList = h('section', { class: 'panel' }), missing = h('section', { class: 'panel' });
      root.appendChild(chips); root.appendChild(hint);
      root.appendChild(h('div', { class: 'map-layout' }, box, layers));
      [located, spotsList, missing].forEach(function (el) { root.appendChild(el); });

      function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* rien */ } }
      function isHidden(id) { return prefs.hidden.indexOf(id) >= 0; }
      function toggle(list, id) { var i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); savePrefs(); refresh(); }

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
        return { dead: dead, players: st.players.filter(function (p) { return wanted ? wanted.has(p.id) : (view.list !== 'vivants' || !dead.has(p.id)); }) };
      }

      function popupPlace(place) {
        var dead = L.deadSet(store.state), type = L.ADDRESS_TYPES.find(function (t) { return t.id === place.type; });
        return h('div', { class: 'map-pop' }, place.type !== 'normale' ? h('span', { class: 'tag' }, type.label) : null, place.players.map(function (p) {
          return h('div', { class: 'map-pop-item' }, h('strong', { class: dead.has(p.id) ? 'is-dead' : '' }, p.name), h('span', {}, p.address),
            h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.openPlayer(p.id); } }, 'Ouvrir la fiche'));
        }));
      }
      function popupSpot(id) {
        var s = store.state.spots.find(function (x) { return x.id === id; }); if (!s) return h('div', {});
        return h('div', { class: 'map-pop' }, h('div', { class: 'map-pop-item' }, h('span', { class: 'tag tag-spot' }, 'Lieu stratégique'), h('strong', {}, s.name),
          s.note ? h('span', {}, s.note) : null, s.address ? h('span', { class: 'muted' }, s.address) : null,
          h('div', { class: 'row-inline' }, h('button', { type: 'button', class: 'btn', onclick: function () { editSpot(s); } }, 'Modifier'),
            h('button', { type: 'button', class: 'btn', onclick: function () { if (map) map.closePopup(); view.placing = { kind: 'spots', id: s.id, name: s.name }; refresh(); } }, 'Déplacer'))));
      }

      function goTo(key, lat, lng) {
        if (!map) return;
        map.setView([lat, lng], Math.max(map.getZoom(), 16));
        if (pins.get(key)) pins.get(key).openPopup();
        if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }

      function editSpot(s) {
        var isNew = !s; s = s || { name: '', note: '', address: '' };
        ui.dialog({ title: isNew ? 'Ajouter un lieu stratégique' : 'Modifier le lieu', render: function (body, api) {
          var name = h('input', { type: 'text', value: s.name, placeholder: 'ex. Resto U, salle de muscu, arrêt Lahitolle' });
          var note = h('textarea', { rows: '3', value: s.note || '', placeholder: 'Pourquoi c\'est stratégique : horaires, qui y passe…' });
          var address = h('input', { type: 'text', value: s.address || '', placeholder: 'Facultatif : sinon tu touches la carte' });
          body.appendChild(h('div', { class: 'stack' }, ui.field('Nom', name), ui.field('Note', note), ui.field('Adresse', address)));
          body.appendChild(h('div', { class: 'actions' },
            isNew ? null : h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { store.remove('spots', s.id); api.close(); if (map) map.closePopup(); } }, 'Supprimer'),
            h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), note: note.value.trim(), address: address.value.trim() };
              if (!row.name) { name.focus(); return ui.toast('Donne un nom au lieu.', 'error'); }
              api.close(); if (map) map.closePopup();
              var moved = row.address && row.address !== (s.address || '');
              var saved = isNew ? store.insert('spots', Object.assign({ lat: null, lng: null }, row)).then(function (r) { return r.id; }) : store.update('spots', s.id, row).then(function () { return s.id; });
              saved.then(function (id) {
                var ask = function () { view.placing = { kind: 'spots', id: id, name: row.name }; refresh(); if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
                if (moved) return geo.geocode(row.address).then(function (hit) { if (hit) return store.update('spots', id, { lat: hit.lat, lng: hit.lng }); ui.toast('Adresse introuvable : touche la carte pour placer le lieu.', 'error'); ask(); }).catch(ask);
                if (isNew) ask();
              });
            } }, isNew ? 'Ajouter le lieu' : 'Enregistrer')));
        } });
      }

      function drawPins(s, places, spots) {
        if (!map) return;
        layer.clearLayers(); pins.clear();
        var Lf = window.L, bounds = [];
        places.forEach(function (place) {
          var allDead = place.players.every(function (p) { return s.dead.has(p.id); }), ally = place.players.some(function (p) { return p.is_ally; });
          var first = place.players.find(function (p) { return !s.dead.has(p.id); }) || place.players[0];
          var icon = Lf.divIcon({ className: 'pin-wrap', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -13],
            html: pinHtml(place.type, { dead: allDead, ally: ally, count: place.players.length, year: hexYear(first.year) }) });
          var title = place.players.map(function (p) { return p.name; }).join(', ');
          var m = Lf.marker([place.lat, place.lng], { icon: icon, title: title, alt: title, keyboard: true }).bindPopup(function () { return popupPlace(place); }, { maxWidth: 270, minWidth: 190 });
          layer.addLayer(m); bounds.push([place.lat, place.lng]);
          place.players.forEach(function (p) { pins.set(p.id, m); });
        });
        spots.forEach(function (sp) {
          var icon = Lf.divIcon({ className: 'pin-wrap', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -15], html: pinHtml('spot') });
          var m = Lf.marker([sp.lat, sp.lng], { icon: icon, title: sp.name, alt: sp.name, keyboard: true, zIndexOffset: 500 }).bindPopup(function () { return popupSpot(sp.id); }, { maxWidth: 270, minWidth: 190 });
          layer.addLayer(m); pins.set('spot:' + sp.id, m); bounds.push([sp.lat, sp.lng]);
        });
        if (view.fit && bounds.length) {
          view.fit = false;
          if (bounds.length === 1) map.setView(bounds[0], 16); else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
        }
      }

      function drawBus() {
        if (!map || !busLayer) return;
        busLayer.clearLayers();
        if (!bus) return;
        var Lf = window.L;
        bus.lines.forEach(function (line) {
          if (prefs.bus.indexOf(line.id) < 0) return;
          var color = hex(line.color, '#4363D8');
          line.paths.forEach(function (path) { busLayer.addLayer(Lf.polyline(path, { color: color, weight: 4, opacity: 0.85, interactive: false })); });
          line.stops.forEach(function (stop) {
            busLayer.addLayer(Lf.circleMarker([stop.lat, stop.lng], { radius: 5, color: color, weight: 3, fillColor: '#fff', fillOpacity: 1 })
              .bindPopup(function () { return h('div', { class: 'map-pop-item' }, h('strong', {}, stop.n), h('span', { class: 'muted' }, 'Ligne ' + line.name + (line.long ? ', ' + line.long : ''))); }));
          });
        });
      }

      function layerRow(o) {
        return h('button', { type: 'button', class: 'layer-row' + (o.on ? '' : ' is-off'), 'aria-pressed': String(o.on), onclick: o.toggle },
          o.swatch, h('span', { class: 'layer-name' }, o.name), h('span', { class: 'muted small' }, o.count), h('span', { class: 'layer-eye', 'aria-hidden': 'true' }, o.on ? '👁' : '—'));
      }
      function swatch(html) { var el = h('span', { class: 'layer-swatch' }); el.innerHTML = html; return el; } // html : uniquement les gabarits fixes ci-dessus

      function drawLayers(allPlaces, spots) {
        ui.clear(layersBody);
        L.ADDRESS_TYPES.slice().reverse().forEach(function (t) {
          var n = allPlaces.filter(function (pl) { return pl.type === t.id; }).length;
          layersBody.appendChild(layerRow({ name: t.plural, count: n, on: !isHidden(t.id), swatch: swatch(pinHtml(t.id, { year: '#8A93A0' })), toggle: function () { toggle(prefs.hidden, t.id); } }));
        });
        layersBody.appendChild(layerRow({ name: 'Lieux stratégiques', count: spots.length, on: !isHidden('spots'), swatch: swatch(pinHtml('spot')), toggle: function () { toggle(prefs.hidden, 'spots'); } }));
        layersBody.appendChild(h('button', { type: 'button', class: 'btn btn-block', disabled: !map, onclick: function () { editSpot(null); } }, 'Ajouter un lieu stratégique'));

        layersBody.appendChild(h('h3', {}, 'Lignes de bus'));
        if (!busReady) layersBody.appendChild(h('p', { class: 'muted small' }, 'Chargement…'));
        else if (!bus) layersBody.appendChild(h('p', { class: 'muted small' }, 'Pas encore de réseau. Lance « python3 tools/build_bus.py » à la racine du dépôt : il télécharge les données officielles AggloBus et crée data/bus.js. Pousse ensuite le fichier sur GitHub.'));
        else {
          var all = bus.lines.map(function (l) { return l.id; }), anyOn = prefs.bus.some(function (id) { return all.indexOf(id) >= 0; });
          layersBody.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { prefs.bus = anyOn ? [] : all.slice(); savePrefs(); refresh(); } }, anyOn ? 'Tout masquer' : 'Tout afficher'));
          bus.lines.forEach(function (line) {
            var sw = h('span', { class: 'layer-swatch' }, h('span', { class: 'bus-line', style: { background: hex(line.color, '#4363D8') } }));
            layersBody.appendChild(layerRow({ name: 'Ligne ' + line.name, count: line.stops.length + ' arrêts', on: prefs.bus.indexOf(line.id) >= 0, swatch: sw, toggle: function () { toggle(prefs.bus, line.id); } }));
          });
          layersBody.appendChild(h('p', { class: 'muted small' }, bus.source + ' (' + bus.generated + ').'));
        }
      }

      function refresh() {
        var s = shown(), allPlaces = L.places(s.players);
        var places = allPlaces.filter(function (pl) { return !isHidden(pl.type); });
        var allSpots = store.state.spots.filter(L.hasCoords).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var spots = isHidden('spots') ? [] : allSpots;
        var visibleIds = new Set(); places.forEach(function (pl) { pl.players.forEach(function (p) { visibleIds.add(p.id); }); });
        var here = s.players.filter(function (p) { return visibleIds.has(p.id); }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var lost = store.state.players.filter(function (p) { return L.hasAddress(p) && !L.hasCoords(p); }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var lostSpots = store.state.spots.filter(function (x) { return !L.hasCoords(x); });

        ui.clear(chips);
        LISTS.forEach(function (l) {
          chips.appendChild(h('button', { type: 'button', class: 'chip' + (view.list === l[0] ? ' is-on' : ''), 'aria-pressed': String(view.list === l[0]),
            onclick: function () { view.list = l[0]; view.fit = true; refresh(); } }, l[1]));
        });

        hint.hidden = !view.placing;
        ui.clear(hint);
        if (view.placing) { hint.appendChild(h('span', {}, 'Touche la carte à l\'emplacement de ' + view.placing.name + '.'));
          hint.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { view.placing = null; refresh(); } }, 'Annuler')); }
        box.classList.toggle('is-placing', !!view.placing);

        drawPins(s, places, spots); drawBus(); drawLayers(allPlaces, allSpots);

        ui.clear(located);
        located.appendChild(h('h2', {}, 'Joueurs localisés', h('small', { class: 'muted' }, ' ' + here.length)));
        if (!here.length) located.appendChild(h('p', { class: 'empty' }, allPlaces.length ? 'Tous les calques de joueurs sont masqués.' : view.list === 'tous' || view.list === 'vivants'
          ? 'Personne sur la carte pour l\'instant. Renseigne une adresse sur une fiche : le point se place tout seul.'
          : 'Aucun de ces joueurs n\'a d\'adresse localisée, ou la chaîne ne les désigne pas encore.'));
        here.forEach(function (p) {
          var t = L.addressType(p.address_type);
          located.appendChild(h('div', { class: 'row map-row' + (s.dead.has(p.id) ? ' is-dead' : '') },
            h('button', { type: 'button', class: 'row row-btn', 'aria-label': 'Montrer ' + p.name + ' sur la carte', onclick: function () { goTo(p.id, p.lat, p.lng); } },
              ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, p.address)),
              t !== 'normale' ? h('span', { class: 'tag' }, L.ADDRESS_TYPES.find(function (x) { return x.id === t; }).label) : null, ui.yearTag(p)),
            h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.openPlayer(p.id); } }, 'Fiche')));
        });

        ui.clear(spotsList);
        spotsList.hidden = !allSpots.length && !lostSpots.length;
        spotsList.appendChild(h('h2', {}, 'Lieux stratégiques', h('small', { class: 'muted' }, ' ' + allSpots.length)));
        allSpots.concat(lostSpots).forEach(function (sp) {
          var placed = L.hasCoords(sp);
          spotsList.appendChild(h('div', { class: 'row map-row' },
            h('button', { type: 'button', class: 'row row-btn', disabled: !placed, onclick: function () { goTo('spot:' + sp.id, sp.lat, sp.lng); } },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, sp.name), h('span', { class: 'row-sub' }, placed ? (sp.note || sp.address || '') : 'Pas encore placé sur la carte'))),
            placed ? null : h('button', { type: 'button', class: 'btn', disabled: !map, onclick: function () { view.placing = { kind: 'spots', id: sp.id, name: sp.name }; refresh(); } }, 'Placer'),
            h('button', { type: 'button', class: 'btn', onclick: function () { editSpot(sp); } }, 'Modifier')));
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
              h('button', { type: 'button', class: 'btn', disabled: !map, onclick: function () { view.placing = { kind: 'players', id: p.id, name: p.name }; refresh(); if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 'Placer sur la carte'),
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

      geo.loadBus().then(function (data) { bus = data && data.lines && data.lines.length ? data : null; busReady = true; if (!gone) refresh(); });

      geo.loadLeaflet().then(function (Lf) {
        if (gone) return;
        ui.clear(box);
        var c = geo.center();
        map = Lf.map(box, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lng], 13);
        Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
          attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map);
        busLayer = Lf.layerGroup().addTo(map);
        layer = Lf.layerGroup().addTo(map);
        map.on('click', function (e) {
          if (!view.placing) return;
          var job = view.placing; view.placing = null;
          store.update(job.kind, job.id, { lat: e.latlng.lat, lng: e.latlng.lng }).then(function () { ui.toast('Point placé.'); });
        });
        refresh();
        var fp = focus && store.player(focus);
        if (fp && L.hasCoords(fp)) setTimeout(function () { goTo(fp.id, fp.lat, fp.lng); }, 60);
      }).catch(function () {
        if (gone) return;
        box.classList.add('map-off');
        ui.clear(box).appendChild(h('p', { class: 'map-wait' }, 'Le fond de carte ne peut pas se charger ici (hors ligne, ou aperçu qui bloque les ressources externes). Les listes ci-dessous restent utilisables ; sur le site déployé, la carte s\'affiche normalement.'));
      });

      refresh();
      refresh.destroy = function () { gone = true; if (map) { map.remove(); map = null; } };
      return refresh;
    }
  };
})();
