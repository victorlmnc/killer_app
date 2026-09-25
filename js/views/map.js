(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, geo = K.geo, t = K.t;
  K.views = K.views || {};
  var PREFS = 'killer.map.v1';

  // Layer glyphs (static markup, no user content)
  var GLYPH = {
    normale: '',
    coloc: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.3"/><circle cx="11" cy="6" r="2"/><path d="M1 13.5c0-2.6 2-4.2 4.5-4.2s4.5 1.6 4.5 4.2zM10.6 13.5c0-1.5-.5-2.7-1.4-3.6.5-.3 1.100-.4 1.800-.4 2.200 0 4 1.400 4 4z"/></svg>',
    immeuble: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.500h10v13H9.500v-3h-3v3H3zM5 3.500v2h2v-2zm4 0v2h2v-2zM5 7.500v2h2v-2zm4 0v2h2v-2z" fill-rule="evenodd"/></svg>',
    residence: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.500 3h1.800v5.500h11.200V14h-1.800v-2H3.300v2H1.500zM4.300 5.200h3.200v2.300H4.300zM8.500 5.200h4.200c1 0 1.800.8 1.800 1.800v.5h-6z"/></svg>',
    spot: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.500 1.500h1.500v.8h8l-2 3 2 3h-8v6.200H3.500z"/></svg>'
  };
  function hex(c, fallback) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback; } // only a real colour reaches a style attribute
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
      var LISTS = [['tous', t('All')], ['vivants', t('Alive')], ['cibles', t('Alliance targets')], ['killers', t('Alliance killers')]];
      var focus = (location.hash.match(/[?&]player=([^&]+)/) || [])[1] || null;
      var edit = store.canEdit();
      var view = { list: 'tous', placing: null, fit: true, busy: false };
      var prefs = loadPrefs(), bus = null, busReady = false;
      var map = null, layer = null, busLayer = null, pins = new Map(), gone = false;

      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': t('Players shown') });
      var hint = h('div', { class: 'link-hint map-hint', hidden: true });
      var box = h('div', { class: 'map', role: 'application', 'aria-label': t('Map of players and places') }, h('p', { class: 'map-wait' }, t('Loading the map…')));
      var layersBody = h('div', { class: 'layers-body' });
      var layers = h('details', { class: 'panel layers', open: window.innerWidth > 820 }, h('summary', {}, h('h2', {}, t('Layers'))), layersBody);
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
        return h('div', { class: 'map-pop' }, place.type !== 'normale' ? h('span', { class: 'tag' }, t(type.label)) : null, place.players.map(function (p) {
          return h('div', { class: 'map-pop-item' }, h('strong', { class: dead.has(p.id) ? 'is-dead' : '' }, p.name), h('span', {}, p.address),
            h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.openPlayer(p.id); } }, t('Open sheet')));
        }));
      }
      function popupSpot(id) {
        var s = store.state.spots.find(function (x) { return x.id === id; }); if (!s) return h('div', {});
        return h('div', { class: 'map-pop' }, h('div', { class: 'map-pop-item' }, h('span', { class: 'tag tag-spot' }, t('Strategic spot')), h('strong', {}, s.name),
          s.note ? h('span', {}, s.note) : null, s.address ? h('span', { class: 'muted' }, s.address) : null,
          edit ? h('div', { class: 'row-inline' }, h('button', { type: 'button', class: 'btn', onclick: function () { editSpot(s); } }, t('Edit')),
            h('button', { type: 'button', class: 'btn', onclick: function () { if (map) map.closePopup(); view.placing = { kind: 'spots', id: s.id, name: s.name }; refresh(); } }, t('Move'))) : null));
      }

      function goTo(key, lat, lng) {
        if (!map) return;
        map.setView([lat, lng], Math.max(map.getZoom(), 16));
        if (pins.get(key)) pins.get(key).openPopup();
        if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }

      function editSpot(s) {
        var isNew = !s; s = s || { name: '', note: '', address: '' };
        ui.dialog({ title: isNew ? t('Add a strategic spot') : t('Edit spot'), render: function (body, api) {
          var name = h('input', { type: 'text', value: s.name, placeholder: t('e.g. canteen, gym, bus stop') });
          var note = h('textarea', { rows: '3', value: s.note || '', placeholder: t('Why it matters: hours, who goes there…') });
          var address = h('input', { type: 'text', value: s.address || '', placeholder: t('Optional: otherwise tap the map') });
          body.appendChild(h('div', { class: 'stack' }, ui.field(t('Name'), name), ui.field(t('Note'), note), ui.field(t('Address'), address)));
          body.appendChild(h('div', { class: 'actions' },
            isNew ? null : h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { store.remove('spots', s.id); api.close(); if (map) map.closePopup(); } }, t('Delete')),
            h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), note: note.value.trim(), address: address.value.trim() };
              if (!row.name) { name.focus(); return ui.toast(t('Give the spot a name.'), 'error'); }
              api.close(); if (map) map.closePopup();
              var moved = row.address && row.address !== (s.address || '');
              var saved = isNew ? store.insert('spots', Object.assign({ lat: null, lng: null }, row)).then(function (r) { return r.id; }) : store.update('spots', s.id, row).then(function () { return s.id; });
              saved.then(function (id) {
                var ask = function () { view.placing = { kind: 'spots', id: id, name: row.name }; refresh(); if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
                if (moved) return geo.geocode(row.address).then(function (hit) { if (hit) return store.update('spots', id, { lat: hit.lat, lng: hit.lng }); ui.toast(t('Address not found: tap the map to place the spot.'), 'error'); ask(); }).catch(ask);
                if (isNew) ask();
              });
            } }, isNew ? t('Add the spot') : t('Save'))));
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
              .bindPopup(function () { return h('div', { class: 'map-pop-item' }, h('strong', {}, stop.n), h('span', { class: 'muted' }, t('Line {n}', { n: line.name }) + (line.long ? ', ' + line.long : ''))); }));
          });
        });
      }

      function layerRow(o) {
        return h('button', { type: 'button', class: 'layer-row' + (o.on ? '' : ' is-off'), 'aria-pressed': String(o.on), onclick: o.toggle },
          o.swatch, h('span', { class: 'layer-name' }, o.name), h('span', { class: 'muted small' }, o.count), K.icon(o.on ? 'eye' : 'eyeOff', 'layer-eye'));
      }
      function swatch(html) { var el = h('span', { class: 'layer-swatch' }); el.innerHTML = html; return el; } // html: only the static templates above

      function drawLayers(allPlaces, spots) {
        ui.clear(layersBody);
        L.ADDRESS_TYPES.slice().reverse().forEach(function (x) {
          var n = allPlaces.filter(function (pl) { return pl.type === x.id; }).length;
          layersBody.appendChild(layerRow({ name: t(x.plural), count: n, on: !isHidden(x.id), swatch: swatch(pinHtml(x.id, { year: '#8A93A0' })), toggle: function () { toggle(prefs.hidden, x.id); } }));
        });
        layersBody.appendChild(layerRow({ name: t('Strategic spots'), count: spots.length, on: !isHidden('spots'), swatch: swatch(pinHtml('spot')), toggle: function () { toggle(prefs.hidden, 'spots'); } }));
        if (edit) layersBody.appendChild(h('button', { type: 'button', class: 'btn btn-block', disabled: !map, onclick: function () { editSpot(null); } }, t('Add a strategic spot')));

        layersBody.appendChild(h('h3', {}, t('Bus lines')));
        if (!busReady) layersBody.appendChild(h('p', { class: 'muted small' }, t('Loading…')));
        else if (!bus) layersBody.appendChild(h('p', { class: 'muted small' }, t('No bus network yet. Run tools/build_bus.py with the GTFS feed of your city to generate data/bus.js.')));
        else {
          var all = bus.lines.map(function (l) { return l.id; }), anyOn = prefs.bus.some(function (id) { return all.indexOf(id) >= 0; });
          layersBody.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { prefs.bus = anyOn ? [] : all.slice(); savePrefs(); refresh(); } }, anyOn ? t('Hide all') : t('Show all')));
          bus.lines.forEach(function (line) {
            var sw = h('span', { class: 'layer-swatch' }, h('span', { class: 'bus-line', style: { background: hex(line.color, '#4363D8') } }));
            layersBody.appendChild(layerRow({ name: t('Line {n}', { n: line.name }), count: K.n(line.stops.length, '{n} stop', '{n} stops'), on: prefs.bus.indexOf(line.id) >= 0, swatch: sw, toggle: function () { toggle(prefs.bus, line.id); } }));
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
        if (view.placing) { hint.appendChild(h('span', {}, t('Tap the map where {name} is.', { name: view.placing.name })));
          hint.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { view.placing = null; refresh(); } }, t('Cancel'))); }
        box.classList.toggle('is-placing', !!view.placing);

        drawPins(s, places, spots); drawBus(); drawLayers(allPlaces, allSpots);

        ui.clear(located);
        located.appendChild(h('h2', {}, t('Located players'), h('small', { class: 'muted' }, ' ' + here.length)));
        if (!here.length) located.appendChild(h('p', { class: 'empty' }, allPlaces.length ? t('All player layers are hidden.') : view.list === 'tous' || view.list === 'vivants'
          ? t('Nobody on the map yet. Add an address on a sheet and the marker is placed automatically.')
          : t('None of these players has a located address, or the chain does not point at them yet.')));
        here.forEach(function (p) {
          var ty = L.addressType(p.address_type);
          located.appendChild(h('div', { class: 'row map-row' + (s.dead.has(p.id) ? ' is-dead' : '') },
            h('button', { type: 'button', class: 'row row-btn', 'aria-label': t('Show {name} on the map', { name: p.name }), onclick: function () { goTo(p.id, p.lat, p.lng); } },
              ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, p.address)),
              ty !== 'normale' ? h('span', { class: 'tag' }, t(L.ADDRESS_TYPES.find(function (x) { return x.id === ty; }).label)) : null, ui.yearTag(p)),
            h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.openPlayer(p.id); } }, t('Sheet'))));
        });

        ui.clear(spotsList);
        spotsList.hidden = !allSpots.length && !lostSpots.length;
        spotsList.appendChild(h('h2', {}, t('Strategic spots'), h('small', { class: 'muted' }, ' ' + allSpots.length)));
        allSpots.concat(lostSpots).forEach(function (sp) {
          var placed = L.hasCoords(sp);
          spotsList.appendChild(h('div', { class: 'row map-row' },
            h('button', { type: 'button', class: 'row row-btn', disabled: !placed, onclick: function () { goTo('spot:' + sp.id, sp.lat, sp.lng); } },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, sp.name), h('span', { class: 'row-sub' }, placed ? (sp.note || sp.address || '') : t('Not placed on the map yet')))),
            placed || !edit ? null : h('button', { type: 'button', class: 'btn', disabled: !map, onclick: function () { view.placing = { kind: 'spots', id: sp.id, name: sp.name }; refresh(); } }, t('Place')),
            edit ? h('button', { type: 'button', class: 'btn', onclick: function () { editSpot(sp); } }, t('Edit')) : null));
        });

        ui.clear(missing);
        missing.hidden = !lost.length || !edit;
        if (lost.length && edit) {
          missing.appendChild(h('div', { class: 'panel-head' }, h('h2', {}, t('Addresses to locate'), h('small', { class: 'muted' }, ' ' + lost.length)),
            h('button', { type: 'button', class: 'btn btn-primary', disabled: view.busy, onclick: locateAll }, view.busy ? t('Searching…') : t('Locate these addresses'))));
          missing.appendChild(h('p', { class: 'prose muted small' }, t('When an address cannot be found (residence without a number, typo), fix it on the sheet or place the marker by hand.')));
          lost.forEach(function (p) {
            missing.appendChild(h('div', { class: 'row map-row map-row-lost' },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, p.address)),
              h('button', { type: 'button', class: 'btn', disabled: !map, onclick: function () { view.placing = { kind: 'players', id: p.id, name: p.name }; refresh(); if (box.scrollIntoView) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, t('Place on the map')),
              h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.editPlayer(p.id); } }, t('Fix'))));
          });
        }
      }

      function locateAll() {
        view.busy = true; refresh();
        geo.locateAll().then(function (r) {
          view.busy = false; view.fit = true; refresh();
          ui.toast(K.n(r.found, '{n} address located', '{n} addresses located') + (r.total - r.found ? ', ' + K.n(r.total - r.found, '{n} not found', '{n} not found') : '') + '.');
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
          store.update(job.kind, job.id, { lat: e.latlng.lat, lng: e.latlng.lng }).then(function () { ui.toast(t('Marker placed.')); });
        });
        refresh();
        var fp = focus && store.player(focus);
        if (fp && L.hasCoords(fp)) setTimeout(function () { goTo(fp.id, fp.lat, fp.lng); }, 60);
      }).catch(function () {
        if (gone) return;
        box.classList.add('map-off');
        ui.clear(box).appendChild(h('p', { class: 'map-wait' }, t('The map tiles cannot load here (offline, or a preview that blocks external resources). The lists below still work; on the deployed site the map shows normally.')));
      });

      refresh();
      refresh.destroy = function () { gone = true; if (map) { map.remove(); map = null; } };
      return refresh;
    }
  };
})();
