(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  K.views = K.views || {};
  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', K.i18n.lang); }

  /* ================================================================ Players */
  K.views.players = {
    title: t('Players'),
    render: function (root) {
      /* Filters: who (all / alive / dead), one extra filter that combines with it, year, department, sort */
      var DEFAULT = { q: '', state: 'alive', extra: '', year: '', dept: '', sort: 'name' }, view = Object.assign({}, DEFAULT);
      var STATES = [['all', t('All')], ['alive', t('Alive')], ['dead', t('Dead')]];
      var EXTRAS = [['allies', t('Alliance')], ['notarget', t('Unknown target')], ['weapons', t('Known weapons')], ['noaddress', t('Unknown address')], ['flagged', t('Special status')], ['timetable', t('With a timetable')]];
      var search = h('input', { type: 'search', placeholder: t('Search a name, a note, an address'), 'aria-label': t('Search a player'), oninput: function (e) { view.q = e.target.value; paint(); } });
      var filters = h('div', { class: 'filterbar' }), count = h('span', { class: 'muted small' }), list = h('div', { class: 'list' });
      root.appendChild(h('div', { class: 'toolbar toolbar-search' }, search,
        h('div', { class: 'toolbar-actions' },
          store.canEdit() ? h('button', { type: 'button', class: 'btn', onclick: K.actions.importDialog }, K.icon('upload'), t('Import')) : null,
          h('button', { type: 'button', class: 'btn', onclick: exportMenu }, K.icon('download'), t('Export')),
          store.canEdit() ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { K.actions.editPlayer(null); } }, K.icon('plus'), t('Add a player')) : null)));
      root.appendChild(filters); root.appendChild(list);

      function exportMenu() {
        ui.dialog({ title: t('Export'), render: function (b, api) {
          b.appendChild(h('p', { class: 'prose' }, t('The CSV opens in any spreadsheet. The report is a printable page: use "Save as PDF" in the print dialog. The saved game contains everything, photos included, and can be imported again from the settings.')));
          b.appendChild(h('div', { class: 'stack' },
            h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.exportCsv(); api.close(); } }, K.icon('download'), t('Players (CSV)')),
            h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.exportPdf(); api.close(); } }, K.icon('print'), t('Report (print / PDF)')),
            h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.exportJson(); api.close(); } }, K.icon('download'), t('Save the game'))));
        } });
      }
      function refresh() {
        var s = store.state.settings;
        ui.clear(filters);
        filters.appendChild(h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, t('Show')),
          h('div', { class: 'segmented', role: 'group', 'aria-label': t('List') }, STATES.map(function (x) {
            return h('button', { type: 'button', class: view.state === x[0] ? 'is-on' : '', 'aria-pressed': String(view.state === x[0]), onclick: function () { view.state = x[0]; refresh(); } }, x[1]);
          }))));
        filters.appendChild(h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, t('Filter')),
          h('div', { class: 'chips chips-wrap', role: 'group', 'aria-label': t('Filter') }, EXTRAS.map(function (x) {   // tap again to remove it
            return h('button', { type: 'button', class: 'chip' + (view.extra === x[0] ? ' is-on' : ''), 'aria-pressed': String(view.extra === x[0]), onclick: function () { view.extra = view.extra === x[0] ? '' : x[0]; refresh(); } }, x[1]);
          }))));
        filters.appendChild(h('div', { class: 'filter-selects' },
          ui.chipSelect([{ value: '', label: t('All years') }].concat((s.years || []).map(function (y) { return y.name; })), view.year, { empty: t('Year'), prefix: t('Year'), 'aria-label': t('Year'), onchange: function (e) { view.year = e.target.value; refresh(); } }),
          (s.depts || []).length ? ui.chipSelect([{ value: '', label: t('All departments') }].concat(s.depts), view.dept, { empty: t('Department'), prefix: t('Department'), 'aria-label': t('Department'), onchange: function (e) { view.dept = e.target.value; refresh(); } }) : null,
          ui.chipSelect([{ value: 'name', label: t('Sort: name') }, { value: 'points', label: t('Sort: points') }, { value: 'kills', label: t('Sort: kills') }, { value: 'class', label: t('Sort: class') }], view.sort, { lit: false, 'aria-label': t('Sort'), onchange: function (e) { view.sort = e.target.value; paint(); } })));
        var changed = ['state', 'extra', 'year', 'dept'].some(function (k) { return view[k] !== DEFAULT[k]; });
        filters.appendChild(h('div', { class: 'filter-foot' }, count,
          changed ? h('button', { type: 'button', class: 'linkish small', onclick: function () { Object.assign(view, DEFAULT, { q: view.q, sort: view.sort }); refresh(); } }, t('Reset filters')) : null));
        paint();
      }
      function paint() {
        var st = store.state, dead = L.deadSet(st), round = L.currentRound(st), maps = round && L.linkMaps(st, round.id);
        var kills = new Map(); st.kills.forEach(function (k) { if (k.killer_id) kills.set(k.killer_id, (kills.get(k.killer_id) || 0) + 1); });
        var targets = new Map();
        if (round) st.players.forEach(function (p) { if (!dead.has(p.id)) targets.set(p.id, L.resolveTarget(st, round.id, p.id, maps, dead).id); });
        var q = L.norm(view.q);
        var rows = st.players.filter(function (p) {
          var d = dead.has(p.id);
          if (view.state === 'alive' && d) return false;
          if (view.state === 'dead' && !d) return false;
          if (view.extra === 'allies' && !p.is_ally) return false;
          if (view.extra === 'notarget' && (d || targets.get(p.id))) return false;
          if (view.extra === 'weapons' && (d || !p.weapons)) return false;
          if (view.extra === 'flagged' && !p.status) return false;
          if (view.extra === 'timetable' && !store.calendarsFor(p).length) return false;
          if (view.extra === 'noaddress' && (p.is_ally || L.hasAddress(p))) return false;   // same scope as the dashboard statistics
          if (view.year && p.year !== view.year) return false;
          if (view.dept && p.dept !== view.dept) return false;
          return !q || L.norm([p.name, p.notes, p.address, p.weapons, p.option].join(' ')).indexOf(q) >= 0;
        });
        var by = { name: function () { return 0; }, points: function (a, b) { return (b.points || 0) - (a.points || 0); },
          kills: function (a, b) { return (kills.get(b.id) || 0) - (kills.get(a.id) || 0); },
          'class': function (a, b) { return [a.year, a.dept, a.td].join(' ').localeCompare([b.year, b.dept, b.td].join(' '), K.i18n.lang); } }[view.sort];
        rows.sort(function (a, b) { return by(a, b) || byName(a, b); });
        count.textContent = K.n(rows.length, '{n} player', '{n} players');
        ui.clear(list);
        if (!rows.length) list.appendChild(h('p', { class: 'empty' }, st.players.length ? t('Nobody in this list with these filters.') : t('The database is empty. Import the registered players or add one.')));
        rows.forEach(function (p) {
          var d = dead.has(p.id), tg = targets.get(p.id) && store.player(targets.get(p.id)), n = kills.get(p.id) || 0;
          list.appendChild(h('button', { type: 'button', class: 'row row-btn row-player' + (d ? ' is-dead' : ''), onclick: function () { K.actions.openPlayer(p.id); } },
            ui.avatar(p), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
              h('span', { class: 'row-sub' }, d ? t('Dead') : tg ? t('Hunts {name}', { name: tg.name }) : t('Unknown target')),
              p.weapons && !d ? h('span', { class: 'row-sub tags' }, ui.weaponsInOrder(p.weapons).map(function (w) { return ui.weaponTag(w, true); })) : null,
              d ? null : ui.bonusTags(p, true)),
            h('span', { class: 'row-side' }, h('span', { class: 'tags' }, p.is_mystery ? h('span', { class: 'tag tag-mystery' }, t('Mystery player')) : null, p.is_ally ? h('span', { class: 'tag tag-ally' }, t('Alliance')) : null, ui.statusTag(p, true), ui.yearTag(p)),
              h('span', { class: 'muted small' }, ui.pointsText(p) + (n ? ', ' + K.n(n, '{n} kill', '{n} kills') : '')))));
        });
      }
      refresh();
      return refresh;
    }
  };

  /* ================================================================== Weapons */
  K.views.weapons = {
    title: t('Weapons'),
    render: function (root) {
      var q = '', stock = '';   // stock filter: '' all, 'owned', 'missing'
      var search = h('input', { type: 'search', placeholder: t('Search a weapon'), 'aria-label': t('Search a weapon'), oninput: function (e) { q = e.target.value; paint(); } });
      var body = h('div', { class: 'stack-lg' }), preshot = h('div', { class: 'preshot-box' });   // pre-shot first, the search under it
      root.appendChild(preshot);
      root.appendChild(h('div', { class: 'toolbar' }, search, store.canEdit() ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { edit(null); } }, K.icon('plus'), t('Add a weapon')) : null));
      root.appendChild(body);
      function edit(w, preset) {   // preset: name of a weapon seen in play but missing from the catalogue
        if (!store.canEdit()) return;
        ui.dialog({ title: w ? t('Edit weapon') : t('Add a weapon'), render: function (b, api) {
          var name = h('input', { type: 'text', value: w ? w.name : preset || '' }), diff = ui.select(ui.levelOptions(false).concat([{ value: 'inconnue', label: t('Unknown difficulty') }]), w ? w.difficulty : 'facile');
          var owned = h('input', { type: 'checkbox', checked: !!(w && w.owned) });
          var note = h('textarea', { rows: '3', value: (w && w.note) || '', placeholder: t('e.g. in the kitchen of the residence, Emma keeps one, buy at the market') });
          b.appendChild(h('div', { class: 'stack' }, ui.field(t('Name'), name), ui.field(t('Difficulty'), diff),
            h('label', { class: 'check' }, owned, t('We have it')), ui.field(t('Note'), note, t('Where to find it, who keeps it.'))));
          if (w && store.state.weapons.length > 1) b.appendChild(h('p', { class: 'small' }, h('button', { type: 'button', class: 'linkish', onclick: function () { api.close(); merge(w); } }, t('Merge with another weapon…')),
            h('span', { class: 'muted' }, ' ' + t('for a duplicate: the sheets that carry it are updated.'))));
          b.appendChild(h('div', { class: 'actions' },
            w ? h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () {
              ui.confirm({ title: t('Delete {name}?', { name: w.name }), text: t('It leaves the catalogue for the whole team. The sheets and kills that mention it keep its name.'), action: t('Delete'), danger: true })
                .then(function (ok) { if (ok) { api.close(); store.remove('weapons', w.id); store.log(t('Weapon removed from the catalogue: {w}', { w: w.name })); } });
            } }, t('Delete')) : null,
            h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), difficulty: diff.value, owned: owned.checked, note: note.value.trim() }; if (!row.name) return name.focus();
              var twin = store.state.weapons.find(function (x) { return x !== w && L.norm(x.name) === L.norm(row.name); });
              if (twin) return ui.toast(t('"{w}" is already in the catalogue.', { w: twin.name }), 'error');
              var was = w && w.difficulty;   // read before the update: it changes the row in place
              if (w) store.update('weapons', w.id, row).then(function () { if (row.difficulty !== was) K.actions.applyWeaponDifficulty(row.name, row.difficulty); });
              else store.insert('weapons', row).then(function () { K.actions.applyWeaponDifficulty(row.name, row.difficulty); });   // kills already made with it
              api.close();
            } }, w ? t('Save') : t('Add the weapon'))));
        } });
      }
      /* Duplicate cleanup: "from" disappears into "into"; sheets and kills that name it are renamed, stock and notes kept. */
      function merge(from) {
        var others = store.state.weapons.filter(function (x) { return x !== from; }).sort(byName);
        var close = L.matchWeapons(from.name, others)[0];
        ui.dialog({ title: t('Merge "{w}"', { w: from.name }), render: function (b, api) {
          var into = ui.select(others.map(function (x) { return { value: x.id, label: x.name + ' (' + (x.difficulty === 'difficile' ? t('hard') : x.difficulty === 'facile' ? t('easy') : t('unknown difficulty')) + ')' }; }), close ? close.weapon.id : others[0].id);
          b.appendChild(h('p', { class: 'prose' }, t('"{w}" is removed from the catalogue and replaced by the weapon chosen below on every sheet and kill that mentions it. Its stock and note are kept.', { w: from.name })));
          b.appendChild(ui.field(t('Merge into'), into, close ? t('Closest spelling selected.') : null));
          b.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var target = store.state.weapons.find(function (x) { return x.id === into.value; }); if (!target) return;
              var st = store.state, n = 0;
              st.players.forEach(function (p) { var text = L.renameWeapon(p.weapons, from.name, target.name); if (text !== null) { n++; store.update('players', p.id, { weapons: text }); } });
              st.kills.forEach(function (k) { if (k.weapon && L.norm(k.weapon) === L.norm(from.name)) store.update('kills', k.id, { weapon: target.name }); });
              var notes = [target.note, from.note].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' · ');
              store.update('weapons', target.id, { owned: !!(target.owned || from.owned), note: notes });
              store.remove('weapons', from.id);
              store.log(t('Weapon "{a}" merged into "{b}"', { a: from.name, b: target.name }));
              api.close(); ui.toast(t('Merged: {n} sheets updated.', { n: n }));
            } }, t('Merge'))));
        } });
      }
      function paint() {
        var st = store.state, dead = L.deadSet(st), nq = L.norm(q);
        ui.clear(body); ui.clear(preshot);
        if (!st.weapons.length) {
          body.appendChild(h('section', { class: 'panel panel-empty' }, h('h2', {}, t('Empty catalogue')), h('p', { class: 'prose' }, t('Load the {n} weapons seen in previous games, sorted easy or hard, or add your own.', { n: K.seed.weapons.length })),
            store.canEdit() ? h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { store.insertMany('weapons', K.seed.weapons.map(function (w) { return { name: w[0], difficulty: w[1] }; })); } }, t('Load the list'))) : null));
          return;
        }
        var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w]; }));
        /* Pre-shot: for each living ally, the weapons of their target and whether we already have them */
        var round = L.currentRound(st), plan = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Pre-shot')), h('span', { class: 'muted small' }, t('The weapons of our targets, and whether we have them.'))));
        var toFind = 0, rows = 0;
        st.players.filter(function (p) { return p.is_ally && !dead.has(p.id); }).sort(byName).forEach(function (ally) {
          var tg = round && L.resolveTarget(st, round.id, ally.id).id, target = tg && store.player(tg);
          if (!target || target.is_ally) return;   // no point gathering weapons against one of us
          var ws = L.weaponList(target.weapons);
          if (nq) {   // the search also filters the pre-shot: the weapon, or the names on the row
            var byWho = L.norm(ally.name + ' ' + target.name).indexOf(nq) >= 0;
            if (!byWho) ws = ws.filter(function (w) { return L.norm(w).indexOf(nq) >= 0; });
            if (!byWho && !ws.length) return;
          }
          rows++;
          plan.appendChild(h('div', { class: 'preshot-row' },
            h('p', { class: 'preshot-who' }, h('button', { type: 'button', class: 'linkish', onclick: function () { K.actions.openPlayer(ally.id); } }, ally.name), h('span', { class: 'muted' }, ' → '),
              h('button', { type: 'button', class: 'linkish', onclick: function () { K.actions.openPlayer(target.id); } }, target.name)),
            ws.length ? h('div', { class: 'preshot-weapons' }, ws.map(function (w) {
              var c = catalog.get(L.norm(w)); if (!(c && c.owned)) toFind++;
              return h('div', { class: 'preshot-weapon' }, ui.weaponTag(w, true),
                c && c.owned ? h('span', { class: 'tag tag-owned tag-sm' }, '✓ ' + t('We have it')) : h('span', { class: 'tag tag-sm tag-tofind' }, t('To find')),
                c && c.note ? h('span', { class: 'muted small' }, c.note) : null);
            })) : h('p', { class: 'muted small' }, t('Weapons unknown: note them on the sheet of the target.'))));
        });
        if (!rows) plan.appendChild(h('p', { class: 'empty' }, nq ? t('No weapon of our targets matches this search.') : t('No known target outside the alliance yet.')));
        else plan.querySelector('.panel-head').appendChild(h('span', { class: 'tag ' + (toFind ? 'tag-tofind' : 'tag-owned') }, toFind ? K.n(toFind, '{n} weapon to find', '{n} weapons to find') : t('Everything is ready')));
        preshot.appendChild(plan);
        var inPlay = [];
        st.players.forEach(function (p) { if (!dead.has(p.id)) L.weaponList(p.weapons).forEach(function (w) { var c = catalog.get(L.norm(w)); inPlay.push({ name: w, holder: p, listed: !!c, difficulty: c && c.difficulty !== 'inconnue' ? c.difficulty : null, owned: !!(c && c.owned) }); }); });
        inPlay = inPlay.filter(function (w) { return !nq || L.norm(w.name).indexOf(nq) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); });
        var sec = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Currently in play'), h('small', { class: 'muted' }, ' ' + inPlay.length)), h('span', { class: 'muted small' }, t('From the weapons noted on living players\' sheets'))));
        var count = new Map(); inPlay.forEach(function (w) { var k = L.norm(w.name); count.set(k, (count.get(k) || 0) + 1); });   // a weapon is in play once per loop
        if (!inPlay.length) sec.appendChild(h('p', { class: 'empty' }, nq ? t('No weapon in play matches this search.') : t('Note weapons on player sheets and they will show here with their holder.')));
        else sec.appendChild(h('div', { class: 'weapon-grid' }, inPlay.map(function (w) {
          var twice = count.get(L.norm(w.name)) > 1;
          return h('div', { class: 'weapon-card weapon-' + (w.difficulty || 'unknown') + (twice ? ' is-twice' : '') },
            h('button', { type: 'button', class: 'weapon-open', onclick: function () { K.actions.openPlayer(w.holder.id); } },
              h('span', { class: 'weapon-name' }, w.name, w.owned ? h('span', { class: 'tag tag-owned' }, t('We have it')) : null, twice ? h('span', { class: 'tag tag-twice', title: t('A weapon is in play only once per loop: one of these sheets is wrong.') }, t('Held twice')) : null),
              h('span', { class: 'weapon-meta' }, h('span', { class: 'tag tag-' + (w.difficulty || 'none') }, w.difficulty ? ui.levelText(w.difficulty) : w.listed ? t('Unknown difficulty') : t('Not in catalogue')),
                h('span', { class: 'weapon-holder' }, ui.avatar(w.holder, 'sm'), h('span', {}, w.holder.name)))),
            !w.listed && store.canEdit() ? h('button', { type: 'button', class: 'linkish small weapon-add', onclick: function () { edit(null, w.name); } }, K.icon('plus', 'ic-sm'), t('Add to the catalogue')) : null);
        })));
        body.appendChild(sec);
        var ownedCount = st.weapons.filter(function (w) { return w.owned; }).length;
        body.appendChild(h('div', { class: 'toolbar' },
          h('div', { class: 'chips', role: 'group', 'aria-label': t('Stock') }, [['', t('All')], ['owned', t('We have it')], ['missing', t('To find')]].map(function (f) {
            return h('button', { type: 'button', class: 'chip' + (stock === f[0] ? ' is-on' : ''), 'aria-pressed': String(stock === f[0]), onclick: function () { stock = f[0]; paint(); } }, f[1]);
          })),
          h('span', { class: 'muted small' }, t('{a} of {b} weapons gathered', { a: ownedCount, b: st.weapons.length }))));
        /* Weapons of unknown difficulty: in the catalogue as such, or noted on a sheet and missing from it. Saying which
           difficulty it is settles the kills made with it. */
        var unknown = new Map();
        st.weapons.forEach(function (w) { if (w.difficulty === 'inconnue') unknown.set(L.norm(w.name), { name: w.name, weapon: w, holders: [], kills: [] }); });
        inPlay.forEach(function (w) { var k = L.norm(w.name); if (!w.listed && !unknown.has(k)) unknown.set(k, { name: w.name, weapon: null, holders: [], kills: [] }); if (unknown.has(k)) unknown.get(k).holders.push(w.holder); });
        L.pendingKills(st).forEach(function (k) { var key = L.norm(k.weapon || ''); if (k.weapon && !unknown.has(key) && !catalog.has(key)) unknown.set(key, { name: k.weapon, weapon: null, holders: [], kills: [] }); if (unknown.has(key)) unknown.get(key).kills.push(k); });
        var unknownList = Array.from(unknown.values()).filter(function (u) { return !nq || L.norm(u.name).indexOf(nq) >= 0; }).sort(byName);
        var lost = L.pendingKills(st).filter(function (k) { return !k.weapon; });   // kills of unknown difficulty and no weapon name
        if (unknownList.length || lost.length) {
          var unk = h('section', { class: 'panel unknown-weapons' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Unknown difficulty'), h('small', { class: 'muted' }, ' ' + unknownList.length)),
            h('span', { class: 'tag tag-none' }, ui.levelText('inconnue'))),
            h('p', { class: 'muted small' }, t('Say whether it is easy or hard once you know: the kills made with it get their points.')));
          unknownList.forEach(function (u) {
            unk.appendChild(h('div', { class: 'row unknown-weapon' }, h('span', { class: 'row-main' }, h('button', { type: 'button', class: 'linkish row-title', onclick: function () { if (u.weapon) edit(u.weapon); else edit(null, u.name); } }, u.name),
                h('span', { class: 'row-sub' }, [u.holders.length ? t('Held by {names}', { names: u.holders.map(function (p) { return p.name; }).join(', ') }) : null,
                  u.kills.length ? K.n(u.kills.length, '{n} kill to settle', '{n} kills to settle') : null].filter(Boolean).join(' · ') || t('Nobody holds it now'))),
              store.canEdit() ? h('div', { class: 'settle-btns' }, [['facile', t('Set easy')], ['difficile', t('Set hard')]].map(function (o) {
                return h('button', { type: 'button', class: 'btn chip-' + o[0], onclick: function () { K.actions.setWeaponDifficulty(u.name, o[0]); } }, o[1]);
              })) : null));
          });
          if (lost.length) unk.appendChild(h('p', { class: 'muted small' }, K.n(lost.length, '{n} kill of unknown difficulty has no weapon name: settle it from the kill.', '{n} kills of unknown difficulty have no weapon name: settle them from each kill.')));
          body.appendChild(unk);
        }
        var cols = h('div', { class: 'cols-2' }), held = new Set(inPlay.map(function (w) { return L.norm(w.name); }));
        var sc = L.scoring(st);
        [['facile', t('Easy'), K.n(sc.easy, '{n} point', '{n} points')], ['difficile', t('Hard'), K.n(sc.hard, '{n} point', '{n} points')]].forEach(function (d) {
          var items = st.weapons.filter(function (w) { return w.difficulty === d[0] && (!nq || L.norm(w.name).indexOf(nq) >= 0) && (!stock || !!w.owned === (stock === 'owned')); }).sort(byName);
          cols.appendChild(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, d[1], h('small', { class: 'muted' }, ' ' + items.length)), h('span', { class: 'tag tag-' + d[0] }, d[2])),
            items.length ? h('div', { class: 'weapon-cloud' }, items.map(function (w) {
              var tip = [w.owned ? t('We have it.') : null, held.has(L.norm(w.name)) ? t('Currently in play.') : null, w.note || null].filter(Boolean).join(' ');
              return h('button', { type: 'button', class: 'chip chip-' + d[0] + (held.has(L.norm(w.name)) ? ' is-held' : '') + (w.owned ? ' is-owned' : ''), title: tip || null, onclick: function () { edit(w); } },
                w.owned ? h('span', { class: 'owned-mark' }, h('span', { 'aria-hidden': 'true' }, '✓ '), h('span', { class: 'sr-only' }, t('We have it') + ': ')) : null, w.name, w.note ? h('span', { class: 'chip-note' }, w.note) : null);
            })) : h('p', { class: 'empty' }, t('Nothing matches.'))));
        });
        body.appendChild(cols);
      }
      paint();
      return paint;
    }
  };

  /* =================================================================== Shop */
  K.views.shop = {
    title: t('Shop'),
    render: function (root) {
      function editItem(i) {
        if (!store.isAdmin()) return;
        var s = store.state.settings, items = (s.shop || []).slice(), it = i == null ? { name: '', price: 1, description: '', start: 'now', hours: 0 } : items[i];
        ui.dialog({ title: i == null ? t('Add a bonus') : t('Edit bonus'), render: function (b, api) {
          var name = h('input', { type: 'text', value: it.name }), price = h('input', { type: 'number', min: '0', value: String(it.price) }), desc = h('textarea', { rows: '6', value: t(it.description) });
          var tm = L.bonusTiming(it), start = ui.select([{ value: 'now', label: t('As soon as it is bought') }, { value: 'next_day', label: t('At 00:10 the next day') }], tm.start);
          var hours = h('input', { type: 'number', min: '0', step: '0.5', value: String(tm.hours) });
          b.appendChild(h('div', { class: 'stack' }, ui.field(t('Name'), name), ui.field(t('Price in points'), price), ui.field(t('Description'), desc),
            h('div', { class: 'grid-2 grid-align-start' }, ui.field(t('In effect'), start), ui.field(t('Duration (hours)'), hours, t('0 for a one-off bonus.')))));
          b.appendChild(h('div', { class: 'actions' },
            i != null ? h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { items.splice(i, 1); store.setSetting('shop', items); api.close(); } }, t('Delete')) : null,
            h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), price: Math.max(0, parseInt(price.value, 10) || 0), description: desc.value.trim(), start: start.value, hours: Math.max(0, parseFloat(hours.value) || 0) }; if (!row.name) return name.focus();
              if (i == null) items.push(row); else items[i] = row; store.setSetting('shop', items); api.close();
            } }, t('Save'))));
        } });
      }
      var pastOpen = false, pastAll = false;   // the history stays open (and complete) across redraws
      function refresh() {
        var st = store.state, s = st.settings, dead = L.deadSet(st), round = L.currentRound(st), admin = store.isAdmin();
        var hunters = new Set();
        if (round) st.players.forEach(function (p) { if (p.is_ally && !dead.has(p.id)) { var k = L.resolveHunter(st, round.id, p.id).id; if (k) hunters.add(k); } });
        var rivals = st.players.filter(function (p) { return !dead.has(p.id) && !p.is_ally; });
        ui.clear(root);
        /* Bonuses bought and still to come or in effect, then the history */
        var edit = store.canEdit(), cur = L.currentBonuses(st), past = (st.bonuses || []).filter(function (b) { return cur.indexOf(b) < 0; }).sort(function (a, b) { return new Date(b.bought_at) - new Date(a.bought_at); });
        function bonusRow(b) {
          var p = store.player(b.player_id);
          return h('div', { class: 'row bonus-row' + (p ? '' : ' bonus-unknown') }, p ? ui.avatar(p, 'sm') : h('span', { class: 'avatar avatar-sm avatar-mystery', 'aria-hidden': 'true' }, h('span', {}, '?')),
            h('button', { type: 'button', class: 'row-main linkish-row', onclick: function () { if (p) K.actions.openPlayer(p.id); else if (edit) K.actions.setBonusBuyer(b); } }, h('span', { class: 'row-title' }, p ? p.name : t('Someone (unknown)')),
              h('span', { class: 'bonus-line' }, ui.bonusTag(b, true)),
              h('span', { class: 'row-sub' }, t('bought {date}', { date: ui.whenShort(b.bought_at) }) + (b.note ? ' · ' + b.note : ''))),
            !p && edit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { K.actions.setBonusBuyer(b); } }, t('Who was it?')) : null,
            edit ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove this purchase'), onclick: function () { K.actions.removeBonus(b); } }, K.icon('close')) : null);
        }
        var active = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Bonuses in play'), h('small', { class: 'muted' }, ' ' + cur.length)),
          h('span', { class: 'muted small' }, t('Record a purchase from the bonus below.'))));
        if (!cur.length) active.appendChild(h('p', { class: 'empty' }, t('No bonus in effect or to come.')));
        cur.forEach(function (b) { active.appendChild(bonusRow(b)); });
        if (past.length) active.appendChild(h('details', { class: 'bonus-history', open: pastOpen, ontoggle: function (e) { pastOpen = e.target.open; } },
          h('summary', {}, K.icon('chevron', 'ic-sm'), t('History ({n})', { n: past.length })), past.slice(0, pastAll ? past.length : 40).map(bonusRow),
          past.length > 40 ? h('button', { type: 'button', class: 'linkish small', onclick: function () { pastAll = !pastAll; refresh(); } }, pastAll ? t('Show less') : t('Show all ({n})', { n: past.length })) : null));
        root.appendChild(active);
        var cols = root.appendChild(h('div', { class: 'cols-shop' }));
        var items = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Bonuses')), admin ? h('button', { type: 'button', class: 'btn', onclick: function () { editItem(null); } }, K.icon('plus'), t('Add a bonus')) : null));
        (s.shop || []).forEach(function (it, i) {
          var most = function (p) { return L.pointsRange(store.state, p).max; };   // a kill with a weapon of unknown difficulty may count more
          var can = rivals.filter(function (p) { return most(p) >= it.price; }).sort(function (a, b) { return hunters.has(b.id) - hunters.has(a.id) || most(b) - most(a); });
          items.appendChild(h('article', { class: 'shop-item' },
            h('div', { class: 'shop-head' }, h('h3', {}, it.name), h('span', { class: 'price' }, K.n(it.price, '{n} pt', '{n} pts')), admin ? h('button', { type: 'button', class: 'linkish', onclick: function () { editItem(i); } }, t('Edit')) : null),
            h('p', { class: 'muted small' }, (function () { var tm = L.bonusTiming(it); return (tm.start === 'next_day' ? t('From 00:10 the next day') : t('Immediately')) + ' · ' + (tm.hours ? K.n(tm.hours, '{n} hour', '{n} hours') : t('one-off')); })()),
            edit ? h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.recordBonus(it); } }, K.icon('plus'), t('Record a purchase')) : null,
            h('details', { class: 'desc' }, h('summary', {}, K.icon('chevron', 'ic-sm'), t('What it does')), h('p', { class: 'prose' }, t(it.description))),
            h('p', { class: 'small' }, can.length ? h('span', { class: 'muted' }, K.n(can.length, '{n} rival can afford it: ', '{n} rivals can afford it: ')) : h('span', { class: 'muted' }, t('No known rival has enough points.')),
              can.slice(0, 8).map(function (p, j) { return [j ? ', ' : '', h('button', { type: 'button', class: 'linkish' + (hunters.has(p.id) ? ' threat' : ''), onclick: function () { K.actions.openPlayer(p.id); } }, p.name + ' (' + ui.pointsText(p) + ')')]; }))));
        });
        if (hunters.size) items.appendChild(h('p', { class: 'muted small' }, t('In red: players hunting a member of the alliance.')));
        cols.appendChild(items);
        var sc = L.scoring(store.state), range = function (a, b) { return a === b ? '+' + a : t('+{a} to +{b}', { a: a, b: b }); };
        var rules = [[t('Easy weapon'), K.n(sc.easy, '{n} pt', '{n} pts')], [t('Hard weapon'), K.n(sc.hard, '{n} pt', '{n} pts')],
          [t('Video'), range(sc.video_min, sc.video_max)], [t('Kill witnessed by the organiser'), range(sc.witness_min, sc.witness_max)],
          [t('First blood'), '+' + sc.first_blood], [t('Multi-kill'), t('+{n} per teammate', { n: sc.teammate })]];
        cols.appendChild(h('section', { class: 'panel' }, h('h2', {}, t('Kill scoring')),
          h('table', { class: 'table' }, h('tbody', {}, rules.map(function (r) { return h('tr', {}, h('th', { scope: 'row' }, r[0]), h('td', {}, r[1])); }))),
          h('p', { class: 'muted small' }, t('Video and witnessed bonuses do not stack. Edit the scoring and the shop in Settings.'))));
      }
      refresh();
      return refresh;
    }
  };

  /* ================================================================ Classes */
  K.views.classes = {
    title: t('Classes'),
    render: function (root) {
      var GROUPS = [
        { id: 'td', label: 'TD', key: function (p) { return p.td ? [p.dept, p.td].filter(Boolean).join(' ') : ''; }, others: ['tp', 'option', 'lang_group'] },
        { id: 'tp', label: 'TP', key: function (p) { return p.tp ? [p.dept, p.tp].filter(Boolean).join(' ') : ''; }, others: ['td', 'option', 'lang_group'] },
        { id: 'option', label: t('Option'), key: function (p) { return p.option || ''; }, others: ['td', 'tp'] },
        { id: 'lang_group', label: t('Language group'), keys: function (p) { return L.languageGroups(p.lang_group); }, others: ['td', 'tp'] },
        { id: 'dept', label: t('Department'), key: function (p) { return p.dept || ''; }, others: ['td', 'tp'] }
      ];
      var view = { group: 'td', year: '', alive: false, q: '' };
      var bar = h('div', { class: 'filterbar' }), body = h('div', { class: 'classes' });
      var search = h('input', { type: 'search', placeholder: t('Find someone'), 'aria-label': t('Find a player'), oninput: function (e) { view.q = e.target.value; refresh(); } });   // built once: typing keeps the focus
      root.appendChild(search); root.appendChild(bar); root.appendChild(body);
      function refresh() {
        var st = store.state, dead = L.deadSet(st), g = GROUPS.find(function (x) { return x.id === view.group; });
        ui.clear(bar);
        var seg = h('div', { class: 'segmented segmented-wrap', role: 'group', 'aria-label': t('Group by') }, GROUPS.map(function (x) {
          return h('button', { type: 'button', class: view.group === x.id ? 'is-on' : '', 'aria-pressed': String(view.group === x.id), onclick: function () { view.group = x.id; refresh(); } }, x.label);
        }));
        bar.appendChild(h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, t('Group')), ui.scrollHint(seg)));
        requestAnimationFrame(function () {   // on a phone the options scroll sideways: keep the chosen one in view
          var on = seg.querySelector('.is-on'); if (!on || seg.scrollWidth <= seg.clientWidth) return;
          seg.scrollLeft += on.getBoundingClientRect().left - seg.getBoundingClientRect().left - (seg.clientWidth - on.offsetWidth) / 2;
        });
        var years = h('div', { class: 'chips chips-wrap', role: 'group', 'aria-label': t('Year') });
        [''].concat((st.settings.years || []).map(function (y) { return y.name; })).forEach(function (y) {
          years.appendChild(h('button', { type: 'button', class: 'chip' + (view.year === y ? ' is-on' : ''), 'aria-pressed': String(view.year === y), onclick: function () { view.year = y; refresh(); } }, y || t('All years')));
        });
        years.appendChild(h('button', { type: 'button', class: 'chip chip-toggle' + (view.alive ? ' is-on' : ''), 'aria-pressed': String(view.alive), onclick: function () { view.alive = !view.alive; refresh(); } }, t('Alive only')));
        bar.appendChild(h('div', { class: 'filter-row' }, h('span', { class: 'filter-label' }, t('Year')), years));
        paint();
        function paint() {
          ui.clear(body);
          if (!st.players.length) { body.appendChild(h('p', { class: 'empty' }, t('Classes are built from the player sheets (year, department, TD, TP, option, language group).'))); return; }
          var q = L.norm(view.q), years = {}, otherLanguages = {}, unknown = t('Not set');
          st.players.forEach(function (p) {
            if (p.is_mystery) return;   // clues, not a real member of a class
            if (view.year && p.year !== view.year) return;
            if (view.alive && dead.has(p.id)) return;
            var y = p.year || t('Unknown year'), keys;
            if (g.id === 'lang_group') {
              var languageBuckets = L.languageGroupBuckets(p.lang_group);
              languageBuckets.english.forEach(function (k) { years[y] = years[y] || {}; (years[y][k] = years[y][k] || []).push(p); });
              languageBuckets.other.forEach(function (k) { (otherLanguages[k] = otherLanguages[k] || []).push(p); });
              if (!languageBuckets.english.length && !languageBuckets.other.length) { years[y] = years[y] || {}; (years[y][unknown] = years[y][unknown] || []).push(p); }
            } else {
              keys = g.keys ? g.keys(p) : [g.key(p) || unknown];
              if (!keys.length) keys = [unknown];
              years[y] = years[y] || {};
              keys.forEach(function (k) { (years[y][k] = years[y][k] || []).push(p); });
            }
          });
          if (!Object.keys(years).length && !Object.keys(otherLanguages).length) body.appendChild(h('p', { class: 'empty' }, t('Nobody with these filters.')));
          Object.keys(years).sort().forEach(function (y) {
            var groups = years[y], all = [].concat.apply([], Object.keys(groups).map(function (k) { return groups[k]; }));
            var alive = all.filter(function (p) { return !dead.has(p.id); }).length;
            var sec = h('section', { class: 'panel year-block', style: { '--year': ui.yearColor(y) } },
              h('div', { class: 'panel-head' }, h('h2', {}, t('Year {y}', { y: y })), h('span', { class: 'muted small' }, t('{a} players, {b} alive, grouped by {g}', { a: all.length, b: alive, g: g.label }))));
            var grid = sec.appendChild(h('div', { class: 'class-grid' }));
            Object.keys(groups).sort(function (a, b) { return (a === unknown) - (b === unknown) || a.localeCompare(b, K.i18n.lang, { numeric: true }); }).forEach(function (k) {
              var ps = groups[k].sort(function (a, b) { return dead.has(a.id) - dead.has(b.id) || byName(a, b); });
              var n = ps.filter(function (p) { return !dead.has(p.id); }).length;
              grid.appendChild(h('div', { class: 'class-col' + (k === unknown ? ' class-unknown' : '') },
                h('div', { class: 'class-head' }, h('h3', {}, k), h('span', { class: 'class-count' + (n ? '' : ' is-zero') }, n + ' / ' + ps.length)),
                ps.map(function (p) {
                  var match = q && L.norm(p.name).indexOf(q) >= 0, extra = g.others.map(function (f) { return p[f]; }).filter(Boolean).join(' ');
                  return h('button', { type: 'button', class: 'class-name' + (dead.has(p.id) ? ' is-dead' : '') + (p.is_ally ? ' is-ally' : '') + (match ? ' is-match' : '') + (q && !match ? ' is-dim' : ''),
                    onclick: function () { K.actions.openPlayer(p.id); } }, h('span', { class: 'class-who' }, p.name, ui.nameMarks(p)), extra ? h('span', { class: 'class-extra' }, extra) : null);
                })));
            });
            body.appendChild(sec);
          });
          if (Object.keys(otherLanguages).length) {
            var otherPlayers = [].concat.apply([], Object.keys(otherLanguages).map(function (k) { return otherLanguages[k]; }));
            var aliveOther = otherPlayers.filter(function (p) { return !dead.has(p.id); }).length;
            var otherSection = h('section', { class: 'panel year-block', style: { '--year': ui.yearColor(t('Other languages')) } },
              h('div', { class: 'panel-head' }, h('h2', {}, t('Other languages')), h('span', { class: 'muted small' }, t('{a} players, {b} alive, grouped by {g}', { a: otherPlayers.length, b: aliveOther, g: t('Language group') }))));
            var otherGrid = otherSection.appendChild(h('div', { class: 'class-grid' }));
            Object.keys(otherLanguages).sort(function (a, b) { return a.localeCompare(b, K.i18n.lang, { numeric: true }); }).forEach(function (k) {
              var ps = otherLanguages[k].sort(function (a, b) { return dead.has(a.id) - dead.has(b.id) || byName(a, b); });
              var n = ps.filter(function (p) { return !dead.has(p.id); }).length;
              otherGrid.appendChild(h('div', { class: 'class-col' },
                h('div', { class: 'class-head' }, h('h3', {}, k), h('span', { class: 'class-count' + (n ? '' : ' is-zero') }, n + ' / ' + ps.length)),
                ps.map(function (p) {
                  var match = q && L.norm(p.name).indexOf(q) >= 0, extra = [p.year, p.td, p.tp].filter(Boolean).join(' ');
                  return h('button', { type: 'button', class: 'class-name' + (dead.has(p.id) ? ' is-dead' : '') + (p.is_ally ? ' is-ally' : '') + (match ? ' is-match' : '') + (q && !match ? ' is-dim' : ''),
                    onclick: function () { K.actions.openPlayer(p.id); } }, h('span', { class: 'class-who' }, p.name, ui.nameMarks(p)), extra ? h('span', { class: 'class-extra' }, extra) : null);
                })));
            });
            body.appendChild(otherSection);
          }
        }
      }
      refresh();
      return refresh;
    }
  };
})();
