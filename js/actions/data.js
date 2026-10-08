/* Data: the activity log, import, export, backups, deletion journal, printable report and the profile. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions, _ = act._;
  function name() { return _.name.apply(null, arguments); }

  /* ----------------------------------------- activity log entries */
  act.eventSummary = function (e) {
    var d = e.details || {};
    if (d.type === 'kill') return [d.admin_reason ? t('Administrative elimination: {reason}', { reason: t(d.admin_reason === 'cheating' ? 'Cheating' : 'Other') }) : null,
      d.weapon ? t('Weapon: {w}', { w: d.weapon }) : null, K.n(d.points || 0, '{n} pt', '{n} pts'), d.note ? t('Note: {n}', { n: d.note }) : t('No note')].filter(Boolean).join('. ') + '.';
    if (d.type === 'link') return ui.confLabel(d.confidence || 'sur') + '. ' + (d.source ? t('Source: {s}', { s: d.source }) : t('No source given')) + '.';
    if (d.type === 'move') return (d.added || []).join(' ; ') || t('No new link.');
    return e.text;
  };
  act.eventDetails = function (e) {
    var d = e.details || {};
    if (d.type === 'kill' && store.state.kills.some(function (k) { return k.id === d.kill_id; })) return act.killDetails(d.kill_id);
    ui.dialog({
      title: t('Event details'),
      render: function (body, api) {
        body.appendChild(h('p', { class: 'prose' }, h('strong', {}, e.text)));
        var facts = [[t('By'), e.actor || t('unknown')], [t('When'), ui.when(e.created_at)]];
        if (d.type === 'link') facts.push([t('Reliability'), ui.confLabel(d.confidence || 'sur')], [t('Source'), d.source || t('Not given')]);
        if (d.type === 'kill') facts.push([t('Weapon'), d.weapon || t('Not given')], [t('Points'), String(d.points || 0)], [t('Note'), d.note || t('None')], [t('Status'), t('This kill has since been undone.')]);
        if (d.type === 'move') facts.push([t('Links created'), (d.added || []).join(' ; ') || t('None')], [t('Links removed'), (d.removed || []).join(' ; ') || t('None')]);
        body.appendChild(h('dl', { class: 'facts facts-wide' }, facts.map(function (f) { return h('div', {}, h('dt', {}, f[0]), h('dd', {}, f[1])); })));
        var actions = h('div', { class: 'actions' });
        if (d.type === 'link' && store.canEdit()) {
          var live = store.state.links.filter(function (l) { return l.hunter_id === d.hunter_id && l.target_id === d.target_id; });
          if (live.length) actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); act.editEdge(live.slice(-1)); } }, t('Edit this link')));
        }
        [d.hunter_id, d.target_id, d.killer_id, d.victim_id].filter(function (id) { return id && store.player(id); }).forEach(function (id) {
          actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); act.openPlayer(id); } }, name(id)));
        });
        actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onclick: api.close }, t('Close')));
        body.appendChild(actions);
      }
    });
  };

  /* ------------------------------------------------------------ import */
  act.importDialog = function () {
    if (!store.canEdit()) return;
    ui.dialog({
      title: t('Import players'), wide: true,
      render: function (body, api) {
        var table = null, mapping = [], filterCol = -1, filterVal = '';
        var area = h('textarea', { rows: '6', placeholder: t('Name\tYear\tTD\nDOE Jane\t3\tTD1'), oninput: function () { load(area.value); } });
        var file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain', onchange: function () {
          var f = file.files[0]; if (!f) return;
          var r = new FileReader(); r.onload = function () { area.value = String(r.result); load(area.value); }; r.readAsText(f);
        } });
        var mapBox = h('div', { class: 'map-cols' }), out = h('p', { class: 'muted' }), go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: run }, t('Import'));
        body.appendChild(h('p', { class: 'prose' }, t('Paste rows copied from a spreadsheet (with the header row) or open a CSV file. Each column is then matched to a field; unmatched columns are ignored.')));
        body.appendChild(h('div', { class: 'grid-2' }, ui.field(t('Text'), area), ui.field(t('File'), file)));
        body.appendChild(mapBox); body.appendChild(out);
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')), go));
        var fieldLabels = { name: t('Name'), year: t('Year'), dept: t('Department'), td: 'TD', tp: 'TP', option: t('Option'), lang_group: t('Language group'), address: t('Address'), address_type: t('Housing type'), notes: t('Notes'), weapons: t('Weapons'), points: t('Points') };
        function load(text) {
          table = L.parseTable(text); mapping = L.guessMapping(table); filterCol = -1; filterVal = '';
          ui.clear(mapBox);
          if (!table.rows.length) { preview(); return; }
          var opts = [{ value: '', label: t('ignore') }].concat(L.FIELDS.map(function (f) { return { value: f, label: fieldLabels[f] }; }));
          mapBox.appendChild(h('h3', {}, t('Columns')));
          var grid = mapBox.appendChild(h('div', { class: 'map-grid' }));
          table.header.forEach(function (hd, i) {
            var sample = table.rows.slice(0, 3).map(function (r) { return r[i]; }).filter(Boolean).join(', ');
            grid.appendChild(h('div', { class: 'map-col' }, h('span', { class: 'map-col-head' }, hd || t('Column {n}', { n: i + 1 })), h('span', { class: 'muted small' }, sample || '—'),
              ui.select(opts, mapping[i], { 'aria-label': t('Field for column {n}', { n: i + 1 }), onchange: function (e) { mapping[i] = e.target.value; preview(); } })));
          });
          var colSel = ui.select([{ value: '-1', label: t('No filter') }].concat(table.header.map(function (hd, i) { return { value: String(i), label: hd || t('Column {n}', { n: i + 1 }) }; })), '-1', { onchange: function (e) { filterCol = parseInt(e.target.value, 10); preview(); } });
          var valIn = h('input', { type: 'text', placeholder: t('e.g. yes'), oninput: function (e) { filterVal = e.target.value; preview(); } });
          mapBox.appendChild(h('div', { class: 'grid-2' }, ui.field(t('Only keep rows where this column…'), colSel), ui.field(t('…equals'), valIn)));
          preview();
        }
        function fresh() {
          if (!table) return { rows: [], skipped: 0 };
          var r = L.mapRows(table, mapping, { column: filterCol, value: filterVal });
          var known = new Set(store.state.players.map(function (p) { return L.norm(p.name); })), out = [];
          r.rows.forEach(function (row) { var n = L.norm(row.name); if (known.has(n)) return; known.add(n); out.push(row); });
          return { rows: out, dupes: r.rows.length - out.length, skipped: r.skipped };
        }
        function preview() {
          var r = fresh();
          out.textContent = table && table.rows.length ? t('{a} to import, {b} already in the database, {c} skipped (filtered out or without a name).', { a: r.rows.length, b: r.dupes || 0, c: r.skipped }) : t('No row recognised yet.');
          go.disabled = !r.rows.length || mapping.indexOf('name') < 0;
        }
        function run() {
          var rows = fresh().rows.map(function (r) { return Object.assign({ year: '', dept: '', td: '', tp: '', option: '', lang_group: '', address: '', address_type: 'normale', lat: null, lng: null, notes: '', weapons: '', points: 0, is_ally: false, photo_path: null }, r); });
          var saved = store.insertMany('players', rows); store.log(t('{n} players imported', { n: rows.length }));
          api.close(); ui.toast(t('{n} players imported.', { n: rows.length }));
          saved.then(function (inserted) {
            if (!inserted) return;
            var todo = inserted.filter(L.hasAddress), i = 0;
            function locateNext() {
              if (i >= todo.length) return;
              return K.geo.locatePlayer(todo[i++].id).then(function () {
                if (i < todo.length) return new Promise(function (resolve) { setTimeout(resolve, 120); }).then(locateNext);
              });
            }
            return locateNext();
          });
        }
        preview();
      }
    });
  };

  /* ------------------------------------------------------------ export */
  /* Every real player for the exports: the living first (by name), then the dead, latest death first. */
  function playerRows() {
    var st = store.state, dead = L.deadSet(st), round = L.currentRound(st), maps = round && L.linkMaps(st, round.id);
    var deathOf = new Map(st.kills.map(function (k) { return [k.victim_id, k]; }));
    return L.realPlayers(st).map(function (p) {
      var d = dead.has(p.id), tg = round && !d ? L.resolveTarget(st, round.id, p.id, maps, dead) : null, hu = round && !d ? L.resolveHunter(st, round.id, p.id, maps, dead) : null;
      return { p: p, dead: d, kill: deathOf.get(p.id) || null, target: tg && tg.id ? name(tg.id) : '', hunter: hu && hu.id ? name(hu.id) : '', targetConf: tg && tg.id ? tg.confidence : '' };
    }).sort(function (a, b) {
      if (a.dead !== b.dead) return a.dead ? 1 : -1;
      if (a.dead) return Date.parse((b.kill || {}).happened_at || 0) - Date.parse((a.kill || {}).happened_at || 0) || a.p.name.localeCompare(b.p.name, K.i18n.lang);
      return a.p.name.localeCompare(b.p.name, K.i18n.lang);
    });
  }
  /* The players as an Excel file: one column per piece of information whatever the spreadsheet's language, a tab for
     the living (alliance highlighted) and one for the dead (latest death first), real dates, filters on every column. */
  act.exportXlsx = function () {
    var st = store.state;
    function housing(p) {
      var type = L.addressType(p.address_type), home = p.home_id && (st.homes || []).find(function (x) { return x.id === p.home_id; });
      return { type: type === 'normale' ? '' : t(L.ADDRESS_TYPES.find(function (x) { return x.id === type; }).label), home: home ? home.name : '', apt: home && L.homeKind(home) === 'residence' ? p.apartment || '' : '' };
    }
    function points(p) { var r = L.pointsRange(st, p); return r.max > r.min ? t('{a} to {b}', { a: r.min, b: r.max }) : r.min; }
    function weapons(p, level) { return ui.weaponsInOrder(p.weapons).filter(function (w) { var d = ui.weaponDifficulty(w); return level ? d === level : d !== 'facile' && d !== 'difficile'; }).join(', '); }
    function notes(p) { return String(p.notes || '').replace(/(\r?\n\s*){2,}/g, '\n').trim(); }
    var cls = [{ title: t('Year'), width: 7, type: 'number' }, { title: t('Department'), width: 12 }, { title: 'TD', width: 6 }, { title: 'TP', width: 6 }];
    var place = [{ title: t('Housing type'), width: 16 }, { title: t('Housing'), width: 18 }, { title: t('Apartment'), width: 11, type: 'number' }, { title: t('Address'), width: 34 }, { title: t('Notes'), width: 50 }];
    var all = playerRows(), living = [], dead = [];
    all.forEach(function (r) {
      var p = r.p, k = r.kill, hs = housing(p), c = [p.year, p.dept, p.td, p.tp], where = [hs.type, hs.home, hs.apt, p.address, notes(p)];
      if (!r.dead) {
        living.push({ style: p.is_ally ? 'ally' : null, cells: [p.name].concat(c, [p.option, p.lang_group, points(p), weapons(p, 'facile'), weapons(p, 'difficile'), weapons(p, null),
          r.target, r.target ? ui.confLabel(r.targetConf) : '', r.hunter, p.is_ally ? t('yes') : ''], where) });
      } else {
        var by = !k ? '' : k.admin_reason ? t('Administration') + ' (' + t(k.admin_reason === 'cheating' ? 'Cheating' : 'Other') + ')' : k.killer_id ? name(k.killer_id) : t('Unknown');
        dead.push({ style: p.is_ally ? 'ally' : null, cells: [p.name].concat(c, [k ? k.happened_at : '', by, k ? k.weapon || '' : '', points(p), p.is_ally ? t('yes') : ''], where) });
      }
    });
    var file = K.xlsx.build([
      { name: t('Alive ({n})', { n: living.length }), rows: living, columns: [{ title: t('Name'), width: 24 }].concat(cls, [{ title: t('Option'), width: 12 }, { title: t('Language group'), width: 12 },
        { title: t('Points'), width: 8, type: 'number' }, { title: t('Easy weapon'), width: 18 }, { title: t('Hard weapon'), width: 18 }, { title: t('Other weapons'), width: 16 },
        { title: t('Target'), width: 22 }, { title: t('Reliability'), width: 11 }, { title: t('Killer'), width: 22 }, { title: t('Alliance'), width: 9 }], place) },
      { name: t('Dead ({n})', { n: dead.length }), rows: dead, columns: [{ title: t('Name'), width: 24 }].concat(cls, [{ title: t('Died on'), width: 17, type: 'date' }, { title: t('Killed by'), width: 22 },
        { title: t('Weapon of the kill'), width: 18 }, { title: t('Points'), width: 8, type: 'number' }, { title: t('Alliance'), width: 9 }], place) }
    ]);
    ui.download('players-' + new Date().toISOString().slice(0, 10) + '.xlsx', file);
  };
  /* The whole game in one file: sheets, rounds, links, kills, the full log, catalogue, spots and settings. */
  act.exportJson = function () {
    ui.dialog({
      title: t('Save the game'),
      render: function (body, api) {
        var withPhotos = h('input', { type: 'checkbox', checked: true }), out = h('p', { class: 'muted small' });
        var go = h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          go.disabled = true; out.textContent = t('Preparing the file…');
          store.snapshot(withPhotos.checked, function (done, total) { out.textContent = t('Photos: {a} / {b}', { a: done, b: total }); }).then(function (backup) {
            ui.download('killer-' + L.norm(backup.game_name || 'game').replace(/[^a-z0-9]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(backup), 'application/json');
            api.close(); ui.toast(t('Game saved.'));
          }).catch(function (e) { console.error(e); go.disabled = false; out.textContent = ''; ui.toast(e.message || String(e), 'error'); });
        } }, K.icon('download'), t('Download'));
        body.appendChild(h('p', { class: 'prose' }, t('One file with the whole game: sheets, rounds, links, kills, the full activity log, the weapon catalogue, spots and settings. It can be imported again here or into another database.')));
        body.appendChild(h('label', { class: 'check' }, withPhotos, t('Include the photos (larger file)')));
        body.appendChild(out);
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')), go));
      }
    });
  };

  /* Replaces the current game with a file made by exportJson (older backups work too). */
  act.restoreDialog = function () {
    if (!store.isAdmin()) return;
    ui.dialog({
      title: t('Import a saved game'),
      render: function (body, api) {
        var backup = null, summary = h('div', {}), catalogue = h('input', { type: 'checkbox', checked: true });
        var go = h('button', { type: 'button', class: 'btn btn-danger', disabled: true, onclick: run }, t('Replace the game'));
        var file = h('input', { type: 'file', accept: '.json,application/json', onchange: function () {
          var f = file.files[0]; backup = null; go.disabled = true; ui.clear(summary);
          if (!f) return;
          var r = new FileReader();
          r.onload = function () {
            var res = L.readBackup(String(r.result), { uuid: store.uuid });
            if (res.error) return summary.appendChild(h('p', { class: 'prose danger' }, t(res.error)));
            backup = res; go.disabled = false;
            var d = res.data;
            summary.appendChild(h('p', { class: 'prose' }, h('strong', {}, res.meta.name || t('Unnamed game')), res.meta.exported_at ? ' · ' + t('saved {when}', { when: ui.when(res.meta.exported_at) }) : ''));
            summary.appendChild(h('p', { class: 'prose muted' }, t('{p} players ({ph} photos), {r} rounds, {l} links, {k} kills, {e} log entries, {w} weapons, {s} spots.',
              { p: d.players.length, ph: res.meta.photos, r: d.rounds.length, l: d.links.length, k: d.kills.length, e: d.events.length, w: d.weapons.length, s: d.spots.length })));
            var geo = String(d.settings.geocoder_url || '').trim();   // a file from elsewhere could send the addresses to its own server
            if (geo && geo !== String(store.state.settings.geocoder_url || '').trim()) summary.appendChild(h('p', { class: 'prose danger' },
              t('With the settings, this file also changes the geocoder to {url}: the addresses of the sheets would be sent there.', { url: geo })));
          };
          r.readAsText(f);
        } });
        body.appendChild(h('p', { class: 'prose' }, t('Open a file made with "Save the game". The sheets, photos, chains, kills and log of the current game are replaced for the whole team.')));
        body.appendChild(ui.field(t('File'), file));
        body.appendChild(summary);
        body.appendChild(h('label', { class: 'check' }, catalogue, t('Also replace the weapon catalogue, spots and settings')));
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')), go));
        function run() {
          if (!backup) return;
          ui.confirm({ title: t('Replace the current game?'), text: [t('The {n} current sheets, their photos, the chains, kills and log will be deleted for the whole team.', { n: store.state.players.length }), t('Save the current game first if you want to keep it.')], action: t('Replace the game'), danger: true })
            .then(function (ok) {
              if (!ok) return;
              go.disabled = true; go.textContent = t('Importing…');
              store.restore(backup.data, { catalogue: catalogue.checked }).then(function (done) {
                if (!done) { go.disabled = false; go.textContent = t('Replace the game'); return; }
                store.log(t('Saved game imported: {name}', { name: backup.meta.name || t('Unnamed game') }));
                api.close(); ui.toast(t('Game imported.'));
              });
            });
        }
      }
    });
  };
  /* Nightly copies of the game kept by the database (14 days): download one, restore one, or take one now. */
  /* Deletion journal (administrators): every row deleted in the last 14 days, by whom. Written by the database itself,
     nobody can erase it through the app or the API. */
  act.auditDialog = function () {
    if (!store.audit.available()) return;
    var TABLE = { players: t('Sheet'), rounds: t('Round'), links: t('Link'), kills: t('Kill'), weapons: t('Weapon'), events: t('Log entry'), spots: t('Strategic spot'), bonuses: t('Bonus'), homes: t('Shared flat or residence'), intel: t('Info') };
    function what(r) {
      var d = r.row_data || {};
      if (r.table_name === 'links') return name(d.hunter_id) + ' → ' + name(d.target_id);
      if (r.table_name === 'kills') return t('{name} is dead', { name: name(d.victim_id) });
      return d.name || d.text || d.weapon || '';
    }
    ui.dialog({ title: t('Deletion journal'), wide: true, render: function (body) {
      body.appendChild(h('p', { class: 'muted small' }, t('Every deletion of the last 14 days, recorded by the database: nobody can change it from the app or the API.')));
      var box = body.appendChild(h('div', { class: 'stack-tight' }, h('p', { class: 'muted small' }, t('Loading…'))));
      store.audit.list().then(function (rows) {
        ui.clear(box);
        if (!rows.length) return box.appendChild(h('p', { class: 'empty' }, t('Nothing deleted lately.')));
        rows.forEach(function (r) {
          box.appendChild(h('div', { class: 'row audit-row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, (TABLE[r.table_name] || r.table_name) + (what(r) ? ' · ' + what(r) : '')),
            h('span', { class: 'row-sub' }, [r.actor || t('automatic'), ui.when(r.at)].join(' · ')))));
        });
      }, function (err) { ui.clear(box).appendChild(h('p', { class: 'empty' }, t('Could not load the journal: {err}', { err: err.message || err }))); });
    } });
  };
  act.nightlyDialog = function () {
    if (!store.nightly.available()) return;
    ui.dialog({ title: t('Automatic backups'), render: function (body, api) {
      var list = h('div', { class: 'stack-tight' });
      body.appendChild(h('p', { class: 'prose muted small' }, t('The database keeps a copy of the whole game every night, for 14 days (photos stay in storage). Useful after a mistake.')));
      body.appendChild(list);
      body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: function (e) {
        e.target.disabled = true;
        store.nightly.take().then(function () { ui.toast(t('Backup taken.')); draw(); }, function (err) { ui.toast(err.message || String(err), 'error'); }).then(function () { e.target.disabled = false; });
      } }, t('Take one now')), h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Close'))));
      function draw() {
        ui.clear(list).appendChild(h('p', { class: 'muted small' }, t('Loading…')));
        store.nightly.list().then(function (rows) {
          ui.clear(list);
          if (!rows || !rows.length) return list.appendChild(h('p', { class: 'empty' }, t('No automatic backup yet: the first one is taken tonight (see the README if it never comes).')));
          rows.forEach(function (r) {
            list.appendChild(h('div', { class: 'row row-wrap backup-row' }, h('span', { class: 'row-main' }, ui.when(r.taken_at)),
              h('button', { type: 'button', class: 'btn', onclick: function () {
                store.nightly.get(r.id).then(function (data) { ui.download('killer-' + String(r.taken_at).slice(0, 10) + '.json', JSON.stringify(data), 'application/json'); });
              } }, K.icon('download'), t('Download')),
              h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { store.nightly.get(r.id).then(function (data) { restoreFrom(data, ui.when(r.taken_at)); }); } }, t('Restore this backup'))));
          });
        }, function (err) { ui.clear(list).appendChild(h('p', { class: 'muted small' }, t('Unavailable: {err} (run supabase/schema.sql again).', { err: err.message || err }))); });
      }
      function restoreFrom(data, label) {
        var res = L.readBackup(data, { uuid: store.uuid });
        if (res.error) return ui.toast(t(res.error), 'error');
        ui.confirm({ title: t('Restore the backup of {when}?', { when: label }), text: [t('The {n} current sheets, their photos, the chains, kills and log will be deleted for the whole team.', { n: store.state.players.length }),
          t('{p} players, {k} kills, {l} links in this backup.', { p: res.data.players.length, k: res.data.kills.length, l: res.data.links.length })], action: t('Replace the game'), danger: true })
          .then(function (ok) {
            if (!ok) return;
            store.restore(res.data, { catalogue: true }).then(function (done) { if (done) { store.log(t('Automatic backup restored: {when}', { when: label })); api.close(); ui.toast(t('Game imported.')); } });
          });
      }
      draw();
    } });
  };
  /* Printable report in a new window: the browser's "Save as PDF" does the rest, no library needed. */
  act.exportPdf = function () {
    var st = store.state, s = L.stats(st), round = L.currentRound(st), rows = playerRows();
    var w = window.open('', '_blank');
    if (!w) return ui.toast(t('The browser blocked the report window. Allow pop-ups for this site.'), 'error');
    var d = w.document, hh = function (tag, attrs, kids) { var el = d.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (c) { el.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); }); return el; };
    d.title = (st.settings.game_name || 'Killer') + ' — ' + t('Report');
    var style = hh('style', {}, ['body{font:11pt/1.4 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#111}h1{font-size:20pt;margin:0 0 4px}h2{font-size:13pt;margin:22px 0 8px;border-bottom:1px solid #999;padding-bottom:3px}table{border-collapse:collapse;width:100%;font-size:9.5pt}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}tr.dead td{color:#777}.muted{color:#666}.frag{margin:4px 0}@media print{button{display:none}}']);
    d.head.appendChild(style);
    var body = d.body;
    body.appendChild(hh('button', {}, [t('Print / Save as PDF')])).addEventListener('click', function () { w.print(); });   // no inline handler: the security policy forbids them
    body.appendChild(hh('h1', {}, [st.settings.game_name || 'Killer']));
    body.appendChild(hh('p', { class: 'muted' }, [ui.when(new Date().toISOString()) + ' · ' + (round ? round.name : t('No round')) + ' · ' + t('{a} alive / {b} players · {c} of the loop known', { a: s.alive, b: s.total, c: ui.pct(s.coverage) })]));
    if (round) {
      body.appendChild(hh('h2', {}, [t('Chain')]));
      L.fragments(st, round.id, 'current').fragments.forEach(function (f) {
        body.appendChild(hh('p', { class: 'frag' }, [f.ids.map(name).join('  →  ') + (f.closed ? '  →  ' + name(f.ids[0]) : '  →  ?')]));
      });
    }
    body.appendChild(hh('h2', {}, [t('Players')]));
    var table = hh('table', {}, [hh('tr', {}, [t('Name'), t('Status'), t('Class'), t('Points'), t('Weapons'), t('Target'), t('Killer'), t('Address')].map(function (x) { return hh('th', {}, [x]); }))]);
    rows.forEach(function (r) {
      var p = r.p;
      table.appendChild(hh('tr', { class: r.dead ? 'dead' : '' }, [p.name, r.dead ? t('Dead') : t('Alive'), [p.year, p.dept, p.td, p.tp].filter(Boolean).join(' '), String(p.points || 0), p.weapons || '', r.target, r.hunter, p.address || ''].map(function (x) { return hh('td', {}, [x]); })));
    });
    body.appendChild(table);
    body.appendChild(hh('h2', {}, [t('Kills')]));
    var kt = hh('table', {}, [hh('tr', {}, [t('When'), t('Killer'), t('Victim'), t('Weapon'), t('Points'), t('Note')].map(function (x) { return hh('th', {}, [x]); }))]);
    st.kills.slice().sort(function (a, b) { return a.happened_at < b.happened_at ? 1 : -1; }).forEach(function (k) {
      kt.appendChild(hh('tr', {}, [ui.when(k.happened_at), k.admin_reason ? t('Administration') + ' (' + t(k.admin_reason === 'cheating' ? 'Cheating' : 'Other') + ')' : k.killer_id ? name(k.killer_id) : '?', name(k.victim_id), k.weapon || '', String(k.points || 0), k.note || ''].map(function (x) { return hh('td', {}, [x]); })));
    });
    body.appendChild(kt);
    w.focus();
  };

  /* ---------------------------------------------------------- my profile */
  act.profileDialog = function () {
    if (store.isObserver()) return;
    var me = store.me();
    /* Link this account to its player sheet (or unlink it). */
    function mySheetButton() {
      var btn = h('button', { type: 'button', class: 'btn btn-block' });
      function label() { var mine = store.myPlayer(); ui.clear(btn); if (mine) { btn.appendChild(ui.avatar(mine, 'sm')); btn.appendChild(h('span', {}, mine.name)); } else btn.appendChild(h('span', {}, t('Choose my sheet'))); }
      btn.addEventListener('click', function () {
        // every sheet, dead ones included; the alliance first
        ui.pickPlayer({ title: t('Which sheet is yours?'), prefer: function (x) { return x.is_ally; }, extra: store.myPlayer() ? [{ label: t('None (unlink)'), value: null }] : [] })
          .then(function (v) { if (v === undefined) return; store.updateMember(me.email, { player_id: v }).then(label); label(); });
      });
      label();
      return btn;
    }
    ui.dialog({
      title: t('My profile'),
      render: function (body, api) {
        var email = store.user ? store.user.email : '';
        var nameIn = h('input', { type: 'text', value: (me && me.name) || '', maxlength: '40', placeholder: email.split('@')[0] });
        var file = h('input', { type: 'file', accept: 'image/*,.gif', hidden: true, onchange: function () { var f = file.files[0]; file.value = ''; if (f) ui.pickPhoto(f).then(function (c) { if (c) store.setAvatar(c).then(function () { ui.toast(t('Photo saved.')); }); }); } });
        var pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', placeholder: t('8 characters minimum') });
        var lang = ui.select([{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }], K.i18n.lang);
        var roleLabel = { admin: t('Administrator'), member: t('Alliance member'), observer: t('Observer') }[store.role] || '';
        body.appendChild(h('div', { class: 'profile' },
          h('button', { type: 'button', class: 'profile-photo', 'aria-label': t('Change photo'), onclick: function () { file.click(); } }, ui.avatar({ name: store.displayName(), avatar_path: me && me.avatar_path }, 'xl')), file,
          h('div', { class: 'profile-meta' }, h('strong', {}, store.displayName()), h('span', { class: 'muted small' }, email), h('span', { class: 'tag' }, roleLabel))));
        body.appendChild(h('div', { class: 'stack' },
          ui.field(t('Display name'), nameIn, t('Shown in the activity log next to what you record.')),
          me && store.state.players.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('My sheet')), mySheetButton(), h('span', { class: 'field-hint' }, t('Your own player sheet: the dashboard then shows your target, your hunter and your quick actions.'))) : null,
          ui.field(t('Language'), lang),
          store.mode === 'supabase' ? ui.field(t('New password'), pass, t('Leave empty to keep the current one.')) : null));
        body.appendChild(h('div', { class: 'actions' },
          store.mode === 'supabase' ? h('button', { type: 'button', class: 'btn btn-push', onclick: function () { api.close(); store.auth.signOut(); } }, K.icon('logout'), t('Sign out')) : null,
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var jobs = [];
            if (me && nameIn.value.trim() !== (me.name || '')) jobs.push(store.updateMember(me.email, { name: nameIn.value.trim() }));
            if (pass.value) {
              if (pass.value.length < 8) return ui.toast(t('The password needs at least 8 characters.'), 'error');
              jobs.push(store.auth.updatePassword(pass.value).then(function (r) { if (r.error) throw r.error; }));
            }
            Promise.all(jobs).then(function () {
              api.close();
              if (lang.value !== K.i18n.lang) return K.setLang(lang.value);
              ui.toast(t('Profile saved.'));
            }).catch(function (e) { ui.toast(e.message || String(e), 'error'); });
          } }, t('Save'))));
      }
    });
  };

  Object.assign(_, { playerRows: playerRows });
})();
