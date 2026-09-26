(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  K.views = K.views || {};
  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', K.i18n.lang); }

  /* ================================================================ Players */
  K.views.players = {
    title: t('Players'),
    render: function (root) {
      var view = { q: '', list: 'alive', year: '', dept: '', sort: 'name' };
      var LISTS = [['all', t('All')], ['alive', t('Alive')], ['dead', t('Dead')], ['allies', t('Alliance')], ['notarget', t('Unknown target')], ['weapons', t('Known weapons')]];
      var search = h('input', { type: 'search', placeholder: t('Search a name, a note, an address'), 'aria-label': t('Search a player'), oninput: function (e) { view.q = e.target.value; paint(); } });
      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': t('List') }), filters = h('div', { class: 'toolbar' }), count = h('p', { class: 'muted small' }), list = h('div', { class: 'list' });
      root.appendChild(h('div', { class: 'toolbar' }, search,
        store.canEdit() ? h('button', { type: 'button', class: 'btn', onclick: K.actions.importDialog }, K.icon('upload'), t('Import')) : null,
        h('button', { type: 'button', class: 'btn', onclick: exportMenu }, K.icon('download'), t('Export')),
        store.canEdit() ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { K.actions.editPlayer(null); } }, K.icon('plus'), t('Add a player')) : null));
      root.appendChild(chips); root.appendChild(filters); root.appendChild(count); root.appendChild(list);

      function exportMenu() {
        ui.dialog({ title: t('Export'), render: function (b, api) {
          b.appendChild(h('p', { class: 'prose' }, t('The CSV opens in any spreadsheet. The report is a printable page: use "Save as PDF" in the print dialog. The JSON backup contains the whole game and can be kept for next year\'s statistics.')));
          b.appendChild(h('div', { class: 'stack' },
            h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.exportCsv(); api.close(); } }, K.icon('download'), t('Players (CSV)')),
            h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.exportPdf(); api.close(); } }, K.icon('print'), t('Report (print / PDF)')),
            h('button', { type: 'button', class: 'btn btn-block', onclick: function () { K.actions.exportJson(); api.close(); } }, K.icon('download'), t('Full backup (JSON)'))));
        } });
      }
      function refresh() {
        var s = store.state.settings;
        ui.clear(chips);
        LISTS.forEach(function (l) { chips.appendChild(h('button', { type: 'button', class: 'chip' + (view.list === l[0] ? ' is-on' : ''), 'aria-pressed': String(view.list === l[0]), onclick: function () { view.list = l[0]; refresh(); } }, l[1])); });
        ui.clear(filters);
        filters.appendChild(ui.select([{ value: '', label: t('All years') }].concat((s.years || []).map(function (y) { return y.name; })), view.year, { 'aria-label': t('Year'), onchange: function (e) { view.year = e.target.value; paint(); } }));
        if ((s.depts || []).length) filters.appendChild(ui.select([{ value: '', label: t('All departments') }].concat(s.depts), view.dept, { 'aria-label': t('Department'), onchange: function (e) { view.dept = e.target.value; paint(); } }));
        filters.appendChild(ui.select([{ value: 'name', label: t('Sort: name') }, { value: 'points', label: t('Sort: points') }, { value: 'kills', label: t('Sort: kills') }, { value: 'class', label: t('Sort: class') }], view.sort, { 'aria-label': t('Sort'), onchange: function (e) { view.sort = e.target.value; paint(); } }));
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
          if (view.list === 'alive' && d) return false;
          if (view.list === 'dead' && !d) return false;
          if (view.list === 'allies' && !p.is_ally) return false;
          if (view.list === 'notarget' && (d || targets.get(p.id))) return false;
          if (view.list === 'weapons' && (d || !p.weapons)) return false;
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
              p.weapons && !d ? h('span', { class: 'row-sub' }, p.weapons) : null),
            h('span', { class: 'row-side' }, h('span', { class: 'tags' }, p.is_ally ? h('span', { class: 'tag tag-ally' }, t('Alliance')) : null, ui.yearTag(p)),
              h('span', { class: 'muted small' }, K.n(p.points || 0, '{n} pt', '{n} pts') + (n ? ', ' + K.n(n, '{n} kill', '{n} kills') : '')))));
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
      var q = '';
      var search = h('input', { type: 'search', placeholder: t('Search a weapon'), 'aria-label': t('Search a weapon'), oninput: function (e) { q = e.target.value; paint(); } });
      var body = h('div', { class: 'stack-lg' });
      root.appendChild(h('div', { class: 'toolbar' }, search, store.canEdit() ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { edit(null); } }, K.icon('plus'), t('Add a weapon')) : null));
      root.appendChild(body);
      function edit(w) {
        if (!store.canEdit()) return;
        ui.dialog({ title: w ? t('Edit weapon') : t('Add a weapon'), render: function (b, api) {
          var name = h('input', { type: 'text', value: w ? w.name : '' }), diff = ui.select([{ value: 'facile', label: t('Easy (1 pt)') }, { value: 'difficile', label: t('Hard (3 pts)') }], w ? w.difficulty : 'facile');
          b.appendChild(h('div', { class: 'stack' }, ui.field(t('Name'), name), ui.field(t('Difficulty'), diff)));
          b.appendChild(h('div', { class: 'actions' },
            w ? h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { store.remove('weapons', w.id); api.close(); } }, t('Delete')) : null,
            h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), difficulty: diff.value }; if (!row.name) return name.focus();
              if (w) store.update('weapons', w.id, row); else store.insert('weapons', row); api.close();
            } }, w ? t('Save') : t('Add the weapon'))));
        } });
      }
      function paint() {
        var st = store.state, dead = L.deadSet(st), nq = L.norm(q);
        ui.clear(body);
        if (!st.weapons.length) {
          body.appendChild(h('section', { class: 'panel panel-empty' }, h('h2', {}, t('Empty catalogue')), h('p', { class: 'prose' }, t('Load the {n} weapons seen in previous games, sorted easy or hard, or add your own.', { n: K.seed.weapons.length })),
            store.canEdit() ? h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { store.insertMany('weapons', K.seed.weapons.map(function (w) { return { name: w[0], difficulty: w[1] }; })); } }, t('Load the list'))) : null));
          return;
        }
        var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w.difficulty]; }));
        var inPlay = [];
        st.players.forEach(function (p) { if (!dead.has(p.id)) L.weaponList(p.weapons).forEach(function (w) { inPlay.push({ name: w, holder: p, difficulty: catalog.get(L.norm(w)) }); }); });
        inPlay = inPlay.filter(function (w) { return !nq || L.norm(w.name).indexOf(nq) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); });
        var sec = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Currently in play'), h('small', { class: 'muted' }, ' ' + inPlay.length)), h('span', { class: 'muted small' }, t('From the weapons noted on living players\' sheets'))));
        if (!inPlay.length) sec.appendChild(h('p', { class: 'empty' }, nq ? t('No weapon in play matches this search.') : t('Note weapons on player sheets and they will show here with their holder.')));
        else sec.appendChild(h('div', { class: 'weapon-grid' }, inPlay.map(function (w) {
          return h('button', { type: 'button', class: 'weapon-card weapon-' + (w.difficulty || 'unknown'), onclick: function () { K.actions.openPlayer(w.holder.id); } },
            h('span', { class: 'weapon-name' }, w.name),
            h('span', { class: 'weapon-meta' }, h('span', { class: 'tag tag-' + (w.difficulty || 'none') }, w.difficulty ? (w.difficulty === 'difficile' ? t('Hard, 3 pts') : t('Easy, 1 pt')) : t('Not in catalogue')),
              h('span', { class: 'weapon-holder' }, ui.avatar(w.holder, 'sm'), h('span', {}, w.holder.name))));
        })));
        body.appendChild(sec);
        var cols = h('div', { class: 'cols-2' }), held = new Set(inPlay.map(function (w) { return L.norm(w.name); }));
        [['facile', t('Easy'), t('1 point')], ['difficile', t('Hard'), t('3 points')]].forEach(function (d) {
          var items = st.weapons.filter(function (w) { return w.difficulty === d[0] && (!nq || L.norm(w.name).indexOf(nq) >= 0); }).sort(byName);
          cols.appendChild(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, d[1], h('small', { class: 'muted' }, ' ' + items.length)), h('span', { class: 'tag tag-' + d[0] }, d[2])),
            items.length ? h('div', { class: 'weapon-cloud' }, items.map(function (w) {
              return h('button', { type: 'button', class: 'chip chip-' + d[0] + (held.has(L.norm(w.name)) ? ' is-held' : ''), title: held.has(L.norm(w.name)) ? t('Currently in play.') : null, onclick: function () { edit(w); } }, w.name);
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
        var s = store.state.settings, items = (s.shop || []).slice(), it = i == null ? { name: '', price: 1, description: '' } : items[i];
        ui.dialog({ title: i == null ? t('Add a bonus') : t('Edit bonus'), render: function (b, api) {
          var name = h('input', { type: 'text', value: it.name }), price = h('input', { type: 'number', min: '0', value: String(it.price) }), desc = h('textarea', { rows: '6', value: it.description });
          b.appendChild(h('div', { class: 'stack' }, ui.field(t('Name'), name), ui.field(t('Price in points'), price), ui.field(t('Description'), desc)));
          b.appendChild(h('div', { class: 'actions' },
            i != null ? h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { items.splice(i, 1); store.setSetting('shop', items); api.close(); } }, t('Delete')) : null,
            h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), price: Math.max(0, parseInt(price.value, 10) || 0), description: desc.value.trim() }; if (!row.name) return name.focus();
              if (i == null) items.push(row); else items[i] = row; store.setSetting('shop', items); api.close();
            } }, t('Save'))));
        } });
      }
      function refresh() {
        var st = store.state, s = st.settings, dead = L.deadSet(st), round = L.currentRound(st), admin = store.isAdmin();
        var hunters = new Set();
        if (round) st.players.forEach(function (p) { if (p.is_ally && !dead.has(p.id)) { var k = L.resolveHunter(st, round.id, p.id).id; if (k) hunters.add(k); } });
        var rivals = st.players.filter(function (p) { return !dead.has(p.id) && !p.is_ally; });
        ui.clear(root);
        var cols = root.appendChild(h('div', { class: 'cols-shop' }));
        var items = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Bonuses')), admin ? h('button', { type: 'button', class: 'btn', onclick: function () { editItem(null); } }, K.icon('plus'), t('Add a bonus')) : null));
        (s.shop || []).forEach(function (it, i) {
          var can = rivals.filter(function (p) { return (p.points || 0) >= it.price; }).sort(function (a, b) { return hunters.has(b.id) - hunters.has(a.id) || b.points - a.points; });
          items.appendChild(h('article', { class: 'shop-item' },
            h('div', { class: 'shop-head' }, h('h3', {}, it.name), h('span', { class: 'price' }, K.n(it.price, '{n} pt', '{n} pts')), admin ? h('button', { type: 'button', class: 'linkish', onclick: function () { editItem(i); } }, t('Edit')) : null),
            h('details', { class: 'desc' }, h('summary', {}, K.icon('chevron', 'ic-sm'), t('What it does')), h('p', { class: 'prose' }, it.description)),
            h('p', { class: 'small' }, can.length ? h('span', { class: 'muted' }, K.n(can.length, '{n} rival can afford it: ', '{n} rivals can afford it: ')) : h('span', { class: 'muted' }, t('No known rival has enough points.')),
              can.slice(0, 8).map(function (p, j) { return [j ? ', ' : '', h('button', { type: 'button', class: 'linkish' + (hunters.has(p.id) ? ' threat' : ''), onclick: function () { K.actions.openPlayer(p.id); } }, p.name + ' (' + p.points + ')')]; }))));
        });
        if (hunters.size) items.appendChild(h('p', { class: 'muted small' }, t('In red: players hunting a member of the alliance.')));
        cols.appendChild(items);
        cols.appendChild(h('section', { class: 'panel' }, h('h2', {}, t('Kill scoring')),
          h('table', { class: 'table' }, h('tbody', {}, (s.point_rules || []).map(function (r) { return h('tr', {}, h('th', { scope: 'row' }, t(r.label)), h('td', {}, t(r.points))); }))),
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
      var bar = h('div', { class: 'toolbar' }), chips = h('div', { class: 'chips', role: 'group', 'aria-label': t('Year') }), body = h('div', { class: 'classes' });
      root.appendChild(bar); root.appendChild(chips); root.appendChild(body);
      function refresh() {
        var st = store.state, dead = L.deadSet(st), g = GROUPS.find(function (x) { return x.id === view.group; });
        ui.clear(bar);
        bar.appendChild(h('div', { class: 'segmented segmented-wrap', role: 'group', 'aria-label': t('Group by') }, GROUPS.map(function (x) {
          return h('button', { type: 'button', class: view.group === x.id ? 'is-on' : '', 'aria-pressed': String(view.group === x.id), onclick: function () { view.group = x.id; refresh(); } }, x.label);
        })));
        bar.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: view.alive, onchange: function (e) { view.alive = e.target.checked; refresh(); } }), t('Alive only')));
        bar.appendChild(h('input', { type: 'search', placeholder: t('Find someone'), value: view.q, 'aria-label': t('Find a player'), oninput: function (e) { view.q = e.target.value; paint(); } }));
        ui.clear(chips);
        [''].concat((st.settings.years || []).map(function (y) { return y.name; })).forEach(function (y) {
          chips.appendChild(h('button', { type: 'button', class: 'chip' + (view.year === y ? ' is-on' : ''), 'aria-pressed': String(view.year === y), onclick: function () { view.year = y; refresh(); } }, y || t('All years')));
        });
        paint();
        function paint() {
          ui.clear(body);
          if (!st.players.length) { body.appendChild(h('p', { class: 'empty' }, t('Classes are built from the player sheets (year, department, TD, TP, option, language group).'))); return; }
          var q = L.norm(view.q), years = {}, otherLanguages = {}, unknown = t('Not set');
          st.players.forEach(function (p) {
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
                    onclick: function () { K.actions.openPlayer(p.id); } }, h('span', { class: 'class-who' }, p.name), extra ? h('span', { class: 'class-extra' }, extra) : null);
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
                    onclick: function () { K.actions.openPlayer(p.id); } }, h('span', { class: 'class-who' }, p.name), extra ? h('span', { class: 'class-extra' }, extra) : null);
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
