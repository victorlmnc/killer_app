(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store;
  K.views = K.views || {};

  /* ================================================================ Joueurs */
  K.views.joueurs = {
    title: 'Joueurs',
    render: function (root) {
      var view = { q: '', list: 'vivants', year: '', dept: '', sort: 'nom' };
      var LISTS = [['tous', 'Tous'], ['vivants', 'Vivants'], ['morts', 'Morts'], ['allies', 'Alliance'], ['sanscible', 'Cible inconnue'], ['armes', 'Armes connues']];
      var search = h('input', { type: 'search', placeholder: 'Chercher un nom, une note, une adresse', 'aria-label': 'Chercher un joueur', oninput: function (e) { view.q = e.target.value; paint(); } });
      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Liste affichée' }), filters = h('div', { class: 'toolbar' }), count = h('p', { class: 'muted small' }), list = h('div', { class: 'list' });
      root.appendChild(h('div', { class: 'toolbar' }, search,
        h('button', { type: 'button', class: 'btn', onclick: K.actions.importDialog }, 'Importer'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { K.actions.editPlayer(null); } }, 'Ajouter un joueur')));
      root.appendChild(chips); root.appendChild(filters); root.appendChild(count); root.appendChild(list);

      function refresh() {
        var s = store.state.settings;
        ui.clear(chips);
        LISTS.forEach(function (l) {
          chips.appendChild(h('button', { type: 'button', class: 'chip' + (view.list === l[0] ? ' is-on' : ''), 'aria-pressed': String(view.list === l[0]), onclick: function () { view.list = l[0]; refresh(); } }, l[1]));
        });
        ui.clear(filters);
        filters.appendChild(ui.select([{ value: '', label: 'Toutes les années' }].concat((s.years || []).map(function (y) { return y.name; })), view.year, { 'aria-label': 'Année', onchange: function (e) { view.year = e.target.value; paint(); } }));
        filters.appendChild(ui.select([{ value: '', label: 'Tous les départements' }].concat(s.depts || []), view.dept, { 'aria-label': 'Département', onchange: function (e) { view.dept = e.target.value; paint(); } }));
        filters.appendChild(ui.select([{ value: 'nom', label: 'Tri : nom' }, { value: 'points', label: 'Tri : points' }, { value: 'kills', label: 'Tri : kills' }, { value: 'classe', label: 'Tri : classe' }], view.sort, { 'aria-label': 'Tri', onchange: function (e) { view.sort = e.target.value; paint(); } }));
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
          if (view.list === 'vivants' && d) return false;
          if (view.list === 'morts' && !d) return false;
          if (view.list === 'allies' && !p.is_ally) return false;
          if (view.list === 'sanscible' && (d || targets.get(p.id))) return false;
          if (view.list === 'armes' && (d || !p.weapons)) return false;
          if (view.year && p.year !== view.year) return false;
          if (view.dept && p.dept !== view.dept) return false;
          return !q || L.norm([p.name, p.notes, p.address, p.weapons, p.option].join(' ')).indexOf(q) >= 0;
        });
        var by = { nom: function (a, b) { return 0; }, points: function (a, b) { return (b.points || 0) - (a.points || 0); },
          kills: function (a, b) { return (kills.get(b.id) || 0) - (kills.get(a.id) || 0); },
          classe: function (a, b) { return [a.year, a.dept, a.td].join(' ').localeCompare([b.year, b.dept, b.td].join(' '), 'fr'); } }[view.sort];
        rows.sort(function (a, b) { return by(a, b) || (a.name || '').localeCompare(b.name || '', 'fr'); });

        count.textContent = rows.length + ' joueur' + (rows.length > 1 ? 's' : '');
        ui.clear(list);
        if (!rows.length) list.appendChild(h('p', { class: 'empty' }, st.players.length ? 'Personne dans cette liste avec ces filtres.' : 'La base est vide. Importe la liste des inscrits ou ajoute un joueur.'));
        rows.forEach(function (p) {
          var d = dead.has(p.id), t = targets.get(p.id) && store.player(targets.get(p.id)), n = kills.get(p.id) || 0;
          list.appendChild(h('button', { type: 'button', class: 'row row-btn row-player' + (d ? ' is-dead' : ''), onclick: function () { K.actions.openPlayer(p.id); } },
            ui.avatar(p), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
              h('span', { class: 'row-sub' }, d ? 'Mort' : t ? 'Chasse ' + t.name : 'Cible inconnue'),
              p.weapons && !d ? h('span', { class: 'row-sub' }, '🔪 ' + p.weapons) : null),
            h('span', { class: 'row-side' }, h('span', { class: 'tags' }, p.is_ally ? h('span', { class: 'tag tag-ally' }, 'Alliance') : null, ui.yearTag(p)), h('span', { class: 'muted small' }, (p.points || 0) + ' pts' + (n ? ', ' + n + ' kill' + (n > 1 ? 's' : '') : '')))));
        });
      }
      refresh();
      return refresh;
    }
  };

  /* ================================================================== Armes */
  K.views.armes = {
    title: 'Armes',
    render: function (root) {
      var q = '';
      var search = h('input', { type: 'search', placeholder: 'Chercher une arme', 'aria-label': 'Chercher une arme', oninput: function (e) { q = e.target.value; paint(); } });
      var body = h('div', {});
      root.appendChild(h('div', { class: 'toolbar' }, search, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { edit(null); } }, 'Ajouter une arme')));
      root.appendChild(body);

      function edit(w) {
        ui.dialog({ title: w ? 'Modifier l\'arme' : 'Ajouter une arme', render: function (b, api) {
          var name = h('input', { type: 'text', value: w ? w.name : '' }), diff = ui.select([{ value: 'facile', label: 'Facile (1 pt)' }, { value: 'difficile', label: 'Difficile (3 pts)' }], w ? w.difficulty : 'facile');
          b.appendChild(h('div', { class: 'stack' }, ui.field('Nom', name), ui.field('Difficulté', diff)));
          b.appendChild(h('div', { class: 'actions' },
            w ? h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { store.remove('weapons', w.id); api.close(); } }, 'Supprimer') : null,
            h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), difficulty: diff.value }; if (!row.name) return name.focus();
              if (w) store.update('weapons', w.id, row); else store.insert('weapons', row); api.close();
            } }, w ? 'Enregistrer' : 'Ajouter l\'arme')));
        } });
      }
      function paint() {
        var st = store.state, dead = L.deadSet(st), nq = L.norm(q);
        ui.clear(body);
        if (!st.weapons.length) {
          body.appendChild(h('section', { class: 'panel panel-empty' }, h('h2', {}, 'Catalogue vide'), h('p', { class: 'prose' }, 'Charge les ' + K.seed.weapons.length + ' armes des années précédentes, classées facile ou difficile.'),
            h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { store.insertMany('weapons', K.seed.weapons.map(function (w) { return { name: w[0], difficulty: w[1] }; })); } }, 'Charger la liste'))));
          return;
        }
        var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w.difficulty]; }));
        var inPlay = [];
        st.players.forEach(function (p) { if (!dead.has(p.id)) L.weaponList(p.weapons).forEach(function (w) { inPlay.push({ name: w, holder: p, difficulty: catalog.get(L.norm(w)) }); }); });
        inPlay = inPlay.filter(function (w) { return !nq || L.norm(w.name).indexOf(nq) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var sec = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'En jeu en ce moment', h('small', { class: 'muted' }, ' ' + inPlay.length)),
          h('span', { class: 'muted small' }, 'D\'après les armes notées sur les fiches des joueurs vivants')));
        if (!inPlay.length) sec.appendChild(h('p', { class: 'empty' }, nq ? 'Aucune arme en jeu ne correspond à cette recherche.' : 'Renseigne les armes sur les fiches des joueurs : elles apparaîtront ici avec leur porteur.'));
        else sec.appendChild(h('div', { class: 'weapon-grid' }, inPlay.map(function (w) {
          return h('button', { type: 'button', class: 'weapon-card weapon-' + (w.difficulty || 'inconnue'), onclick: function () { K.actions.openPlayer(w.holder.id); } },
            h('span', { class: 'weapon-name' }, w.name),
            h('span', { class: 'weapon-meta' }, h('span', { class: 'tag tag-' + (w.difficulty || 'none') }, w.difficulty ? (w.difficulty === 'difficile' ? 'Difficile, 3 pts' : 'Facile, 1 pt') : 'Hors catalogue'),
              h('span', { class: 'weapon-holder' }, ui.avatar(w.holder, 'sm'), h('span', {}, w.holder.name))));
        })));
        body.appendChild(sec);
        var cols = h('div', { class: 'cols-2' });
        var held = new Set(inPlay.map(function (w) { return L.norm(w.name); }));
        [['facile', 'Faciles', '1 point'], ['difficile', 'Difficiles', '3 points']].forEach(function (d) {
          var items = st.weapons.filter(function (w) { return w.difficulty === d[0] && (!nq || L.norm(w.name).indexOf(nq) >= 0); }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
          cols.appendChild(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, d[1], h('small', { class: 'muted' }, ' ' + items.length)), h('span', { class: 'tag tag-' + d[0] }, d[2])),
            items.length ? h('div', { class: 'weapon-cloud' }, items.map(function (w) {
              return h('button', { type: 'button', class: 'chip chip-' + d[0] + (held.has(L.norm(w.name)) ? ' is-held' : ''), title: held.has(L.norm(w.name)) ? 'En jeu en ce moment. Cliquer pour modifier.' : 'Cliquer pour modifier', onclick: function () { edit(w); } }, w.name);
            })) : h('p', { class: 'empty' }, 'Rien ne correspond.')));
        });
        body.appendChild(cols);
      }
      paint();
      return paint;
    }
  };

  /* =================================================================== Shop */
  K.views.shop = {
    title: 'Shop',
    render: function (root) {
      function editItem(i) {
        var s = store.state.settings, items = (s.shop || []).slice(), it = i == null ? { name: '', price: 1, description: '' } : items[i];
        ui.dialog({ title: i == null ? 'Ajouter un bonus' : 'Modifier le bonus', render: function (b, api) {
          var name = h('input', { type: 'text', value: it.name }), price = h('input', { type: 'number', min: '0', value: String(it.price) }), desc = h('textarea', { rows: '6', value: it.description });
          b.appendChild(h('div', { class: 'stack' }, ui.field('Nom', name), ui.field('Prix en points', price), ui.field('Description', desc)));
          b.appendChild(h('div', { class: 'actions' },
            i != null ? h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () { items.splice(i, 1); store.setSetting('shop', items); api.close(); } }, 'Supprimer') : null,
            h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var row = { name: name.value.trim(), price: Math.max(0, parseInt(price.value, 10) || 0), description: desc.value.trim() }; if (!row.name) return name.focus();
              if (i == null) items.push(row); else items[i] = row; store.setSetting('shop', items); api.close();
            } }, 'Enregistrer')));
        } });
      }
      function refresh() {
        var st = store.state, s = st.settings, dead = L.deadSet(st), round = L.currentRound(st);
        var hunters = new Set();
        if (round) st.players.forEach(function (p) { if (p.is_ally && !dead.has(p.id)) { var k = L.resolveHunter(st, round.id, p.id).id; if (k) hunters.add(k); } });
        var rivals = st.players.filter(function (p) { return !dead.has(p.id) && !p.is_ally; });
        ui.clear(root);
        var cols = root.appendChild(h('div', { class: 'cols-shop' }));
        var items = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Bonus'), h('button', { type: 'button', class: 'btn', onclick: function () { editItem(null); } }, 'Ajouter un bonus')));
        (s.shop || []).forEach(function (it, i) {
          var can = rivals.filter(function (p) { return (p.points || 0) >= it.price; }).sort(function (a, b) { return hunters.has(b.id) - hunters.has(a.id) || b.points - a.points; });
          items.appendChild(h('article', { class: 'shop-item' },
            h('div', { class: 'shop-head' }, h('h3', {}, it.name), h('span', { class: 'price' }, it.price + ' pts'), h('button', { type: 'button', class: 'linkish', onclick: function () { editItem(i); } }, 'Modifier')),
            h('details', { class: 'desc' }, h('summary', {}, 'Ce que ça fait'), h('p', { class: 'prose' }, it.description)),
            h('p', { class: 'small' }, can.length ? h('span', { class: 'muted' }, can.length + ' adversaire' + (can.length > 1 ? 's peuvent' : ' peut') + ' se l\'offrir : ') : h('span', { class: 'muted' }, 'Aucun adversaire connu n\'a assez de points.'),
              can.slice(0, 8).map(function (p, j) { return [j ? ', ' : '', h('button', { type: 'button', class: 'linkish' + (hunters.has(p.id) ? ' threat' : ''), onclick: function () { K.actions.openPlayer(p.id); } }, p.name + ' (' + p.points + ')')]; }))));
        });
        if (hunters.size) items.appendChild(h('p', { class: 'muted small' }, 'En rouge : ceux qui chassent un membre de l\'alliance.'));
        cols.appendChild(items);
        cols.appendChild(h('section', { class: 'panel' }, h('h2', {}, 'Barème des kills'),
          h('table', { class: 'table' }, h('tbody', {}, (s.point_rules || []).map(function (r) { return h('tr', {}, h('th', { scope: 'row' }, r.label), h('td', {}, r.points)); }))),
          h('p', { class: 'muted small' }, 'Vidéo et kill avec Orion ne se cumulent pas. Coupe-gorge, super coupe-gorge et immunité s\'activent le lendemain de l\'achat à 00:10, pour 24 h.')));
      }
      refresh();
      return refresh;
    }
  };

  /* ================================================================ Classes */
  K.views.classes = {
    title: 'Classes',
    render: function (root) {
      var GROUPS = [
        { id: 'td', label: 'TD', key: function (p) { return p.td ? [p.dept, p.td].filter(Boolean).join(' ') : ''; }, others: ['tp', 'option', 'lang_group'] },
        { id: 'tp', label: 'TP', key: function (p) { return p.tp ? [p.dept, p.tp].filter(Boolean).join(' ') : ''; }, others: ['td', 'option', 'lang_group'] },
        { id: 'option', label: 'Option', key: function (p) { return p.option || ''; }, others: ['td', 'tp'] },
        { id: 'lang_group', label: 'Groupe de langue', key: function (p) { return p.lang_group || ''; }, others: ['td', 'tp'] },
        { id: 'dept', label: 'Département', key: function (p) { return p.dept || ''; }, others: ['td', 'tp'] }
      ];
      var view = { group: 'td', year: '', alive: false, q: '' };
      var bar = h('div', { class: 'toolbar' }), chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Année' }), body = h('div', { class: 'classes' });
      root.appendChild(bar); root.appendChild(chips); root.appendChild(body);

      function refresh() {
        var st = store.state, dead = L.deadSet(st), g = GROUPS.find(function (x) { return x.id === view.group; });
        ui.clear(bar);
        bar.appendChild(h('div', { class: 'segmented segmented-wrap', role: 'group', 'aria-label': 'Regrouper par' }, GROUPS.map(function (x) {
          return h('button', { type: 'button', class: view.group === x.id ? 'is-on' : '', 'aria-pressed': String(view.group === x.id), onclick: function () { view.group = x.id; refresh(); } }, x.label);
        })));
        bar.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: view.alive, onchange: function (e) { view.alive = e.target.checked; refresh(); } }), 'Vivants seulement'));
        bar.appendChild(h('input', { type: 'search', placeholder: 'Repérer quelqu\'un', value: view.q, 'aria-label': 'Repérer un joueur', oninput: function (e) { view.q = e.target.value; paint(); } }));
        ui.clear(chips);
        [''].concat((st.settings.years || []).map(function (y) { return y.name; })).forEach(function (y) {
          chips.appendChild(h('button', { type: 'button', class: 'chip' + (view.year === y ? ' is-on' : ''), 'aria-pressed': String(view.year === y), onclick: function () { view.year = y; refresh(); } }, y || 'Toutes les années'));
        });
        paint();

        function paint() {
          ui.clear(body);
          if (!st.players.length) { body.appendChild(h('p', { class: 'empty' }, 'Les classes se remplissent toutes seules à partir des fiches joueurs (année, département, TD, TP, option, groupe de langue).')); return; }
          var q = L.norm(view.q), years = {};
          st.players.forEach(function (p) {
            if (view.year && p.year !== view.year) return;
            if (view.alive && dead.has(p.id)) return;
            var y = p.year || 'Année inconnue', k = g.key(p) || 'Non renseigné';
            years[y] = years[y] || {}; (years[y][k] = years[y][k] || []).push(p);
          });
          if (!Object.keys(years).length) body.appendChild(h('p', { class: 'empty' }, 'Personne avec ces filtres.'));
          Object.keys(years).sort().forEach(function (y) {
            var groups = years[y], all = [].concat.apply([], Object.keys(groups).map(function (k) { return groups[k]; }));
            var alive = all.filter(function (p) { return !dead.has(p.id); }).length;
            var sec = h('section', { class: 'panel year-block', style: { '--year': ui.yearColor(y) } },
              h('div', { class: 'panel-head' }, h('h2', {}, y), h('span', { class: 'muted small' }, all.length + ' joueurs, ' + alive + ' vivants, regroupés par ' + g.label.toLowerCase())));
            var grid = sec.appendChild(h('div', { class: 'class-grid' }));
            Object.keys(groups).sort(function (a, b) { return (a === 'Non renseigné') - (b === 'Non renseigné') || a.localeCompare(b, 'fr', { numeric: true }); }).forEach(function (k) {
              var ps = groups[k].sort(function (a, b) { return dead.has(a.id) - dead.has(b.id) || a.name.localeCompare(b.name, 'fr'); });
              var n = ps.filter(function (p) { return !dead.has(p.id); }).length;
              grid.appendChild(h('div', { class: 'class-col' + (k === 'Non renseigné' ? ' class-unknown' : '') },
                h('div', { class: 'class-head' }, h('h3', {}, k), h('span', { class: 'class-count' + (n ? '' : ' is-zero') }, n + ' / ' + ps.length)),
                ps.map(function (p) {
                  var match = q && L.norm(p.name).indexOf(q) >= 0;
                  var extra = g.others.map(function (f) { return p[f]; }).filter(Boolean).join(' ');
                  return h('button', { type: 'button', class: 'class-name' + (dead.has(p.id) ? ' is-dead' : '') + (p.is_ally ? ' is-ally' : '') + (match ? ' is-match' : '') + (q && !match ? ' is-dim' : ''),
                    onclick: function () { K.actions.openPlayer(p.id); } }, h('span', { class: 'class-who' }, p.name), extra ? h('span', { class: 'class-extra' }, extra) : null);
                })));
            });
            body.appendChild(sec);
          });
        }
      }
      refresh();
      return refresh;
    }
  };
})();
