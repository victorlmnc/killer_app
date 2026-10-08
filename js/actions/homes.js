/* Shared flats and student residences. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions, _ = act._;

  /* ------------------------------------------- shared flats and student residences */
  /* The sheets of a flat's (or residence's) members follow it: address, position, housing type. */
  function homePatch(home) { return { home_id: home.id, address: home.address || '', lat: home.lat == null ? null : home.lat, lng: home.lng == null ? null : home.lng, address_type: L.homeKind(home) }; }
  /* Words that change between a shared flat and a residence */
  function homeWords(kind) {
    return kind === 'residence' ? {
      create: t('New student residence'), title: t('Residence: {name}'), placeholder: t('e.g. Tanneurs residence'), add: t('Add a resident'),
      del: t('Delete this residence?'), deleted: t('Residence deleted: {name}'), noName: t('Give the residence a name.'), notFound: t('Address not found: place the residence by hand from the Map tab.'),
      created: 'Residence created: {name}', updated: 'Residence updated: {name}', one: '{n} resident', many: '{n} residents', saved: t('Residence saved: the sheets of its residents are updated.')
    } : {
      create: t('New shared flat'), title: t('Shared flat: {name}'), placeholder: t('e.g. The Port flat'), add: t('Add a flatmate'),
      del: t('Delete this shared flat?'), deleted: t('Shared flat deleted: {name}'), noName: t('Give the flat a name.'), notFound: t('Address not found: place the flat by hand from the Map tab.'),
      created: 'Shared flat created: {name}', updated: 'Shared flat updated: {name}', one: '{n} flatmate', many: '{n} flatmates', saved: t('Shared flat saved: the sheets of its members are updated.')
    };
  }
  act.syncHome = function (homeId) {
    var home = store.state.homes.find(function (x) { return x.id === homeId; }); if (!home) return Promise.resolve();
    return Promise.all(store.state.players.filter(function (p) { return p.home_id === homeId; }).map(function (p) { return store.update('players', p.id, homePatch(home)); }));
  };
  /* Create or edit a flat or a residence. preset (detected one): { kind, address, lat, lng, players } */
  act.editHome = function (home, preset) {
    if (!store.canEdit()) return;
    var isNew = !home; preset = preset || {};
    home = home || { kind: preset.kind || 'coloc', name: '', address: preset.address || '', building: '', note: '', lat: preset.lat == null ? null : preset.lat, lng: preset.lng == null ? null : preset.lng };
    var kind = L.homeKind(home), isRes = kind === 'residence', w = homeWords(kind);
    var members = isNew ? (preset.players || []).map(function (p) { return p.id; }) : store.state.players.filter(function (p) { return p.home_id === home.id; }).map(function (p) { return p.id; });
    var apts = {};   // residence: apartment number of each member
    members.forEach(function (id) { var p = store.player(id); apts[id] = (p && p.apartment) || ''; });
    ui.dialog({ title: isNew ? w.create : w.title.replace('{name}', home.name), render: function (body, api) {
      var name = h('input', { type: 'text', value: home.name, placeholder: w.placeholder });
      var address = h('input', { type: 'text', value: home.address || '', placeholder: t('e.g. 12 High Street, Town') });
      var building = h('input', { type: 'text', value: home.building || '', placeholder: t('Optional: the apartment building it is in') });
      var note = h('textarea', { rows: '2', value: home.note || '', placeholder: t('Floor, door code, who is often there…') });
      var list = h('div', { class: 'stack-tight home-members' }), dead = L.deadSet(store.state);
      function drawMembers() {
        ui.clear(list);
        if (!members.length) list.appendChild(h('p', { class: 'muted small' }, t('Nobody yet.')));
        members.forEach(function (id) {
          var p = store.player(id); if (!p) return;
          list.appendChild(h('div', { class: 'row home-member' + (dead.has(id) ? ' is-dead' : '') }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
            p.home_id && p.home_id !== home.id ? h('span', { class: 'row-sub' }, t('leaves another flat or residence')) : null),
            dead.has(id) ? h('span', { class: 'tag tag-dead' }, t('Dead')) : null,
            isRes ? h('input', { type: 'text', class: 'apt-input', value: apts[id] || '', placeholder: t('Apt.'), 'aria-label': t('Apartment of {w}', { w: p.name }), oninput: function (e) { apts[id] = e.target.value; } }) : null,
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {w}', { w: p.name }), onclick: function () { members = members.filter(function (x) { return x !== id; }); drawMembers(); } }, K.icon('close'))));
        });
      }
      drawMembers();
      body.appendChild(h('div', { class: 'stack' }, ui.field(t('Name'), name), ui.field(t('Address'), address, t('Include the town: every member gets this address and its marker.')),
        isRes ? null : ui.field(t('Apartment building'), building), ui.field(t('Note'), note),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('Who lives there')), list,
          isRes ? h('p', { class: 'muted small' }, t('The apartment number is optional.')) : null,
          h('button', { type: 'button', class: 'btn', onclick: function () {
            ui.pickPlayer({ title: w.add, filter: function (p) { return members.indexOf(p.id) < 0; } }).then(function (id) { if (id) { members.push(id); var p = store.player(id); apts[id] = (p && p.apartment) || ''; drawMembers(); } });
          } }, K.icon('plus'), w.add))));
      body.appendChild(h('div', { class: 'actions' },
        isNew ? null : h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () {
          ui.confirm({ title: w.del, text: t('Its members keep their address; they are just no longer grouped.'), action: t('Delete'), danger: true }).then(function (ok) {
            if (!ok) return;
            store.state.players.filter(function (p) { return p.home_id === home.id; }).forEach(function (p) { store.update('players', p.id, { home_id: null }); });
            store.remove('homes', home.id); store.log(w.deleted.replace('{name}', home.name)); api.close();
          });
        } }, t('Delete')),
        h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var row = { name: name.value.trim(), address: address.value.trim(), building: isRes ? '' : building.value.trim(), note: note.value.trim() };
          if (isNew) row.kind = kind;
          if (!row.name) { name.focus(); return ui.toast(w.noName, 'error'); }
          var moved = row.address !== (home.address || '') || home.lat == null;
          var where = moved && row.address ? K.geo.geocode(row.address).catch(function () { return null; }) : Promise.resolve(null);
          api.close();
          where.then(function (hit) {
            if (hit) { row.lat = hit.lat; row.lng = hit.lng; } else if (moved && row.address !== (home.address || '')) { row.lat = null; row.lng = null; }
            if (moved && row.address && !hit) ui.toast(w.notFound, 'error');
            var saved = isNew ? store.insert('homes', Object.assign({ lat: home.lat, lng: home.lng }, row)) : store.update('homes', home.id, row).then(function () { return store.state.homes.find(function (x) { return x.id === home.id; }); });
            return saved.then(function (h2) {
              if (!h2) return;
              store.state.players.filter(function (p) { return p.home_id === h2.id && members.indexOf(p.id) < 0; }).forEach(function (p) { store.update('players', p.id, isRes ? { home_id: null, apartment: '' } : { home_id: null }); });   // moved out
              members.forEach(function (id) { store.update('players', id, Object.assign(homePatch(h2), isRes ? { apartment: (apts[id] || '').trim() } : {})); });
              store.log(t(isNew ? w.created : w.updated, { name: h2.name }) + ' (' + K.n(members.length, w.one, w.many) + ')');
              ui.toast(w.saved);
            });
          });
        } }, t('Save'))));
    } });
  };

  Object.assign(_, { homePatch: homePatch, homeWords: homeWords });
})();
