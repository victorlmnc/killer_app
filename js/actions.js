(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var ui = K.ui, h = ui.h, L = K.logic, store = K.store;
  var act = K.actions = {};

  function name(id) { var p = store.player(id); return p ? p.name : 'joueur inconnu'; }
  act.currentRoundId = function () { var r = L.currentRound(store.state); return r ? r.id : null; };
  act.isDead = function (id) { return L.deadSet(store.state).has(id); };

  function ensureRound() {
    var r = L.currentRound(store.state);
    if (r) return Promise.resolve(r.id);
    return store.insert('rounds', { name: 'Boucle initiale', position: 0 }).then(function (row) { return row.id; });
  }

  function applyPlan(plan) {
    return Promise.all(plan.remove.map(function (l) { return store.remove('links', l.id); }))
      .then(function () { return Promise.all(plan.add.map(function (l) { return store.insert('links', l); })); });
  }

  /* « hunter chasse target ». Demande confirmation si des liens existants sont contredits. */
  act.setTarget = function (hunterId, targetId, o) {
    o = o || {};
    return (o.roundId ? Promise.resolve(o.roundId) : ensureRound()).then(function (roundId) {
      var plan = L.planSetTarget(store.state, roundId, hunterId, targetId, o.confidence, o.source, { raw: o.raw });
      if (plan.error) { ui.toast(plan.error, 'error'); return false; }
      if (plan.noop) { if (!o.silent) ui.toast('Ce lien est déjà connu.'); return true; }
      var ask = plan.remove.length && !o.silent
        ? ui.confirm({
          title: 'Remplacer ce qu\'on savait ?',
          text: ['Ce lien contredit :'].concat(plan.remove.map(function (l) { return name(l.hunter_id) + ' chasse ' + name(l.target_id); })),
          action: 'Remplacer'
        }) : Promise.resolve(true);
      return ask.then(function (ok) {
        if (!ok) return false;
        return applyPlan(plan).then(function () {
          if (!o.silent) {
            store.log('Lien ajouté : ' + name(hunterId) + ' chasse ' + name(targetId));
            ui.toast(plan.viaDead ? 'Lien ajouté, raccordé derrière ' + name(plan.anchorId) + ' (mort).' : 'Lien ajouté.');
          }
          return true;
        });
      });
    });
  };

  act.removeLink = function (link) {
    return store.remove('links', link.id).then(function () { ui.toast('Lien retiré.'); });
  };

  /* Formulaire « confiance + source » avant de lier deux joueurs */
  act.askLink = function (hunterId, targetId, o) {
    return new Promise(function (resolve) {
      var done = false;
      ui.dialog({
        title: 'Nouveau lien', onClose: function () { if (!done) resolve(false); },
        render: function (body, api) {
          var conf = ui.select([{ value: 'sur', label: 'Sûr (vu sur un contrat)' }, { value: 'probable', label: 'Probable' }, { value: 'rumeur', label: 'Rumeur' }], 'sur');
          var src = h('input', { type: 'text', placeholder: 'ex. vu sur son téléphone, dit par Emma' });
          body.appendChild(h('p', { class: 'link-preview' }, h('strong', {}, name(hunterId)), h('span', { class: 'thread-arrow' }, ' chasse '), h('strong', {}, name(targetId))));
          body.appendChild(ui.field('Fiabilité', conf));
          body.appendChild(ui.field('D\'où vient l\'info', src));
          body.appendChild(h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              done = true; api.close();
              resolve(act.setTarget(hunterId, targetId, Object.assign({}, o, { confidence: conf.value, source: src.value.trim() })));
            } }, 'Ajouter le lien')));
        }
      });
    });
  };

  /* ------------------------------------------------------------- kill */
  act.killDialog = function (victimId) {
    var st = store.state, roundId = act.currentRoundId();
    var guess = roundId ? L.resolveHunter(st, roundId, victimId).id : null;
    var killerId = guess, victim = store.player(victimId);
    ui.dialog({
      title: victim.name + ' est mort',
      render: function (body, api) {
        var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w.difficulty]; }));
        var killerBtn = h('button', { type: 'button', class: 'btn btn-block', onclick: pickKiller });
        var weapon = h('input', { type: 'text', list: 'kill-weapons', placeholder: 'Arme utilisée', oninput: onWeapon });
        var options = h('datalist', { id: 'kill-weapons' });
        var diff = ui.select([{ value: 'facile', label: 'Facile (1 pt)' }, { value: 'difficile', label: 'Difficile (3 pts)' }], 'facile', { onchange: total });
        var bonus = ui.select([{ value: '0', label: 'Aucun' }, { value: '1', label: 'Vidéo +1' }, { value: '2', label: 'Vidéo ou Orion +2' }, { value: '3', label: 'Vidéo ou Orion +3' }, { value: '4', label: 'Orion +4' }], '0', { onchange: total });
        var fb = h('input', { type: 'checkbox', checked: st.kills.length === 0, onchange: total });
        var mates = h('input', { type: 'number', min: '0', max: '20', value: '0', inputmode: 'numeric', oninput: total });
        var inherit = h('input', { type: 'checkbox', checked: true });
        var note = h('input', { type: 'text', placeholder: 'Lieu, circonstances…' });
        var sum = h('strong', {});
        var scoring = h('div', { class: 'stack' },
          ui.field('Arme', weapon), options,
          h('div', { class: 'grid-2' }, ui.field('Difficulté', diff), ui.field('Bonus', bonus)),
          h('div', { class: 'grid-2' }, ui.field('Coéquipiers (multi-kill)', mates), h('label', { class: 'check' }, fb, 'First blood (+5)')),
          h('label', { class: 'check' }, inherit, 'Le killer récupère les armes de la victime'),
          h('p', { class: 'muted' }, 'Points gagnés : ', sum));

        function refreshKiller() {
          ui.clear(killerBtn);
          var k = killerId && store.player(killerId);
          killerBtn.appendChild(k ? h('span', { class: 'row-inline' }, ui.avatar(k, 'sm'), k.name) : document.createTextNode('Killer inconnu pour l\'instant'));
          scoring.hidden = !k;
          ui.clear(options);
          L.weaponList(k && k.weapons).forEach(function (w) { options.appendChild(h('option', { value: w })); });
        }
        function pickKiller() {
          ui.pickPlayer({ title: 'Qui l\'a tué ?', filter: function (p) { return p.id !== victimId && !act.isDead(p.id); }, extra: [{ label: 'Killer inconnu pour l\'instant', value: null }] })
            .then(function (v) { if (v !== undefined) { killerId = v; refreshKiller(); } });
        }
        function onWeapon() { var d = catalog.get(L.norm(weapon.value)); if (d) { diff.value = d; } total(); }
        function total() { sum.textContent = String(L.killPoints({ difficulty: diff.value, bonus: bonus.value, firstBlood: fb.checked, mates: mates.value })); }

        body.appendChild(ui.field('Tué par', killerBtn, guess ? 'Proposé d\'après la chaîne. Touche pour changer.' : null));
        body.appendChild(scoring);
        body.appendChild(ui.field('Note', note));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            api.close();
            act.recordKill({ victimId: victimId, killerId: killerId, weapon: weapon.value.trim(), note: note.value.trim(), inherit: inherit.checked,
              points: killerId ? L.killPoints({ difficulty: diff.value, bonus: bonus.value, firstBlood: fb.checked, mates: mates.value }) : 0 });
          } }, 'Enregistrer le kill')));
        refreshKiller(); total();
      }
    });
  };

  act.recordKill = function (k) {
    return ensureRound().then(function (roundId) {
      var pre = Promise.resolve(true);
      // Le kill prouve que killer chassait la victime : on complète la chaîne si on ne le savait pas.
      if (k.killerId && L.resolveTarget(store.state, roundId, k.killerId).id !== k.victimId) {
        pre = act.setTarget(k.killerId, k.victimId, { roundId: roundId, confidence: 'sur', source: 'kill', silent: true });
      }
      return pre.then(function () {
        var victim = store.player(k.victimId), killer = k.killerId && store.player(k.killerId);
        var jobs = [store.insert('kills', { round_id: roundId, killer_id: k.killerId || null, victim_id: k.victimId, weapon: k.weapon || '', points: k.points || 0, note: k.note || '', happened_at: new Date().toISOString() })];
        if (killer) {
          var patch = { points: (killer.points || 0) + (k.points || 0) };
          if (k.inherit && victim.weapons) patch.weapons = victim.weapons;
          jobs.push(store.update('players', killer.id, patch));
        }
        store.log(killer ? killer.name + ' a éliminé ' + victim.name + (k.weapon ? ' (' + k.weapon + ')' : '') : victim.name + ' est mort');
        return Promise.all(jobs);
      }).then(function () {
        var next = k.killerId ? L.resolveTarget(store.state, roundId, k.killerId) : null;
        ui.toast(next && next.id ? 'Kill enregistré. Nouvelle cible de ' + name(k.killerId) + ' : ' + name(next.id) + '.' : 'Kill enregistré.');
      });
    });
  };

  act.revive = function (playerId) {
    var kill = store.state.kills.find(function (k) { return k.victim_id === playerId; });
    if (!kill) return Promise.resolve();
    return ui.confirm({ title: 'Annuler ce kill ?', text: name(playerId) + ' redevient vivant. Les points du killer ne sont pas retirés automatiquement.', action: 'Annuler le kill', danger: true })
      .then(function (ok) { if (ok) return store.remove('kills', kill.id).then(function () { store.log('Kill annulé : ' + name(playerId) + ' est de nouveau vivant'); }); });
  };

  act.editKill = function (kill) {
    ui.pickPlayer({ title: 'Qui a tué ' + name(kill.victim_id) + ' ?', filter: function (p) { return p.id !== kill.victim_id; }, extra: [{ label: 'Killer inconnu', value: null }] })
      .then(function (v) { if (v !== undefined) store.update('kills', kill.id, { killer_id: v }); });
  };

  /* ------------------------------------------------------------- reroll */
  act.newRound = function () {
    var rounds = L.sortedRounds(store.state), n = rounds.length;
    var input = h('input', { type: 'text', value: n === 0 ? 'Boucle initiale' : 'Reroll ' + n });
    ui.dialog({
      title: n === 0 ? 'Démarrer la boucle' : 'Nouveau reroll',
      render: function (body, api) {
        if (n) body.appendChild(h('p', { class: 'prose' }, 'La boucle « ' + rounds[n - 1].name + ' » est archivée telle quelle et reste consultable. La nouvelle repart vide, avec les ' + L.stats(store.state).alive + ' joueurs encore vivants.'));
        body.appendChild(ui.field('Nom de la boucle', input));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var label = input.value.trim() || 'Reroll ' + n;
            store.insert('rounds', { name: label, position: n ? rounds[n - 1].position + 1 : 0 });
            store.log('Nouvelle boucle : ' + label);
            api.close(); ui.toast('Boucle « ' + label + ' » créée.');
          } }, n === 0 ? 'Démarrer' : 'Créer le reroll')));
      }
    });
  };

  /* ------------------------------------------------------- fiche joueur */
  act.openPlayer = function (playerId, ctx) {
    ctx = ctx || {};
    var off = null;
    var dlg = ui.dialog({ title: '', onClose: function () { if (off) off(); }, render: function (body, api) { draw(body, api); } });
    off = store.on(function () { if (dlg.el.open) draw(dlg.body, dlg); });

    function draw(body, api) {
      var p = store.player(playerId);
      if (!p) { api.close(); return; }
      var st = store.state, roundId = ctx.roundId || act.currentRoundId();
      var isCurrent = roundId === act.currentRoundId();
      var dead = L.deadSet(st).has(p.id);
      var kill = st.kills.find(function (k) { return k.victim_id === p.id; });
      var target = roundId && !dead ? L.resolveTarget(st, roundId, p.id) : null;
      var hunter = roundId && !dead ? L.resolveHunter(st, roundId, p.id) : null;
      var maps = roundId ? L.linkMaps(st, roundId) : null;
      var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w.difficulty]; }));
      api.setTitle(p.name);
      ui.clear(body);

      function person(label, res, emptyText) {
        var other = res && res.id && store.player(res.id);
        return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label),
          other ? h('button', { type: 'button', class: 'row row-btn', onclick: function () { api.close(); act.openPlayer(other.id, ctx); } },
            ui.avatar(other, 'sm'), h('span', { class: 'row-main' }, other.name),
            res.confidence !== 'sur' ? h('span', { class: 'tag tag-' + res.confidence }, ui.confLabel[res.confidence]) : null)
            : h('p', { class: 'muted' }, res && res.via.length ? 'Piste perdue après ' + name(res.via[res.via.length - 1]) + ' (mort).' : emptyText));
      }

      var file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function () { if (file.files[0]) store.setPhoto(p.id, file.files[0]); } });
      body.appendChild(h('div', { class: 'profile' },
        h('button', { type: 'button', class: 'profile-photo', 'aria-label': 'Changer la photo', onclick: function () { file.click(); } }, ui.avatar(p, 'xl')), file,
        h('div', { class: 'profile-meta' },
          h('div', { class: 'tags' }, ui.yearTag(p), p.tp ? h('span', { class: 'tag' }, p.tp) : null, p.lang_group ? h('span', { class: 'tag' }, p.lang_group) : null,
            p.option ? h('span', { class: 'tag' }, p.option) : null),
          h('div', { class: 'tags' }, h('span', { class: 'tag ' + (dead ? 'tag-dead' : 'tag-alive') }, dead ? 'Mort' : 'Vivant'),
            p.is_ally ? h('span', { class: 'tag tag-ally' }, 'Alliance') : null, h('span', { class: 'tag tag-points' }, (p.points || 0) + ' pts')))));

      if (dead && kill) {
        body.appendChild(h('p', { class: 'prose' }, 'Tué ' + (kill.killer_id ? 'par ' + name(kill.killer_id) : 'par un killer inconnu') + (kill.weapon ? ' avec « ' + kill.weapon + ' »' : '') + ', ' + ui.ago(kill.happened_at) + '.'));
      } else {
        body.appendChild(h('div', { class: 'relations' }, person('Sa cible', target, 'Cible inconnue.'), person('Son killer', hunter, 'Killer inconnu.')));
      }

      var weapons = L.weaponList(p.weapons);
      if (weapons.length) body.appendChild(h('div', { class: 'tags' }, weapons.map(function (w) {
        var d = catalog.get(L.norm(w));
        return h('span', { class: 'tag tag-weapon' }, '🔪 ' + w + (d ? ' (' + d + ')' : ''));
      })));
      if (p.address) body.appendChild(h('p', { class: 'prose' }, h('span', { class: 'muted' }, 'Adresse : '), p.address, L.addressType(p.address_type) !== 'normale' ? ' (' + L.ADDRESS_TYPES.find(function (t) { return t.id === L.addressType(p.address_type); }).label.toLowerCase() + ')' : '',
        L.hasCoords(p) ? [' ', h('a', { class: 'linkish', href: '#/map?joueur=' + p.id, onclick: function () { api.close(); } }, 'Voir sur la carte')] : null));
      if (p.notes) body.appendChild(h('p', { class: 'prose notes' }, p.notes));

      var mine = st.kills.filter(function (k) { return k.killer_id === p.id; });
      if (mine.length) body.appendChild(h('p', { class: 'prose' }, h('span', { class: 'muted' }, mine.length + ' kill' + (mine.length > 1 ? 's' : '') + ' : '),
        mine.map(function (k) { return name(k.victim_id); }).join(', ')));

      var A = h('div', { class: 'action-grid' });
      function add(label, fn, cls) { A.appendChild(h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: fn }, label)); }
      if (!dead && isCurrent) {
        add('Définir sa cible', function () {
          ui.pickPlayer({ title: 'Qui est la cible de ' + p.name + ' ?', filter: function (x) { return x.id !== p.id && !act.isDead(x.id); } })
            .then(function (id) { if (id) act.askLink(p.id, id); });
        });
        add('Définir son killer', function () {
          ui.pickPlayer({ title: 'Qui chasse ' + p.name + ' ?', filter: function (x) { return x.id !== p.id && !act.isDead(x.id); } })
            .then(function (id) { if (id) act.askLink(id, p.id); });
        });
        add('Il est mort', function () { api.close(); act.killDialog(p.id); }, 'btn-danger');
      }
      if (dead && kill) { add(kill.killer_id ? 'Changer le killer' : 'Indiquer le killer', function () { act.editKill(kill); }); add('Annuler le kill', function () { act.revive(p.id); }); }
      if (maps && maps.targetOf.get(p.id)) add('Retirer le lien vers sa cible', function () { act.removeLink(maps.targetOf.get(p.id)); });
      if (maps && maps.hunterOf.get(p.id)) add('Retirer le lien vers son killer', function () { act.removeLink(maps.hunterOf.get(p.id)); });
      add(p.is_ally ? 'Retirer de l\'alliance' : 'Membre de l\'alliance', function () { store.update('players', p.id, { is_ally: !p.is_ally }); });
      add('Modifier la fiche', function () { act.editPlayer(p.id); });
      if (p.photo_path) add('Retirer la photo', function () { store.removePhoto(p.id); });
      body.appendChild(A);
    }
  };

  act.editPlayer = function (playerId) {
    var p = playerId ? store.player(playerId) : {}, s = store.state.settings;
    ui.dialog({
      title: playerId ? 'Modifier la fiche' : 'Ajouter un joueur',
      render: function (body, api) {
        var typeTouched = false;
        var f = {
          name: h('input', { type: 'text', value: p.name || '', placeholder: 'NOM Prénom', required: true }),
          year: ui.select([{ value: '', label: '—' }].concat((s.years || []).map(function (y) { return y.name; })), p.year || ''),
          dept: ui.select([{ value: '', label: '—' }].concat(s.depts || []), p.dept || ''),
          td: h('input', { type: 'text', value: p.td || '', placeholder: 'TD1' }), tp: h('input', { type: 'text', value: p.tp || '', placeholder: 'TP1' }),
          option: h('input', { type: 'text', value: p.option || '' }), lang_group: h('input', { type: 'text', value: p.lang_group || '', placeholder: 'G2' }),
          weapons: h('input', { type: 'text', value: p.weapons || '', placeholder: 'Banane, Arrosoir' }),
          points: h('input', { type: 'number', min: '0', inputmode: 'numeric', value: String(p.points || 0) }),
          address: h('input', { type: 'text', value: p.address || '', placeholder: 'ex. 12 rue Moyenne, Bourges', autocomplete: 'off',
            oninput: function () { if (!typeTouched && !p.address) f.address_type.value = L.guessAddressType(f.address.value); } }),
          address_type: ui.select(L.ADDRESS_TYPES.slice().reverse().map(function (t) { return { value: t.id, label: t.label }; }), L.addressType(p.address_type), { onchange: function () { typeTouched = true; } }),
          notes: h('textarea', { rows: '3', value: p.notes || '', placeholder: 'Habitudes sur le campus, clubs, qui peut le sauver…' })
        };
        body.appendChild(h('div', { class: 'stack' },
          ui.field('Nom', f.name),
          h('div', { class: 'grid-2' }, ui.field('Année', f.year), ui.field('Département', f.dept)),
          h('div', { class: 'grid-2' }, ui.field('TD', f.td), ui.field('TP', f.tp)),
          h('div', { class: 'grid-2' }, ui.field('Option', f.option), ui.field('Groupe de langue', f.lang_group)),
          h('div', { class: 'grid-2' }, ui.field('Armes en main', f.weapons, 'Séparées par des virgules'), ui.field('Points', f.points)),
          ui.field('Adresse', f.address, 'Avec la ville, pour que le point tombe au bon endroit sur la carte.'),
          ui.field('Type de logement', f.address_type, 'Décide de l\'icône et du calque sur la carte.'), ui.field('Notes', f.notes)));
        var actions = h('div', { class: 'actions' });
        if (playerId) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () {
          ui.confirm({ title: 'Supprimer ' + p.name + ' ?', text: 'Sa fiche, sa photo, ses liens et son kill éventuel sont effacés.', action: 'Supprimer', danger: true })
            .then(function (ok) { if (ok) { store.removePhoto(playerId).then(function () { store.remove('players', playerId); }); api.close(); } });
        } }, 'Supprimer'));
        actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'));
        actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var row = {}; Object.keys(f).forEach(function (k) { row[k] = f[k].value.trim(); });
          if (!row.name) { f.name.focus(); return ui.toast('Il faut au moins un nom.', 'error'); }
          row.points = Math.max(0, parseInt(row.points, 10) || 0);
          var moved = (p.address || '') !== row.address;
          if (moved) { row.lat = null; row.lng = null; }
          var saved = playerId ? store.update('players', playerId, row).then(function () { return playerId; })
            : store.insert('players', Object.assign({ is_ally: false, photo_path: null, lat: null, lng: null }, row)).then(function (r) { return r.id; });
          if (moved && row.address) saved.then(function (id) { return K.geo.locatePlayer(id); }).then(function (hit) {
            if (!hit) ui.toast('Adresse introuvable : tu peux placer le point à la main depuis l\'onglet Map.', 'error');
          });
          api.close(); ui.toast(playerId ? 'Fiche enregistrée.' : row.name + ' ajouté.');
        } }, playerId ? 'Enregistrer' : 'Ajouter le joueur'));
        body.appendChild(actions);
      }
    });
  };

  /* ------------------------------------------------------------ import */
  act.importDialog = function () {
    ui.dialog({
      title: 'Importer des joueurs', wide: true,
      render: function (body, api) {
        var area = h('textarea', { rows: '8', placeholder: 'Nom\tAnnée\tDépartement\tTD\tTP\nDUPONT Léa\t3A\tSTI\tTD1\tTP2', oninput: preview });
        var out = h('p', { class: 'muted' }), go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: run }, 'Importer');
        var parsed = { rows: [] };
        body.appendChild(h('p', { class: 'prose' }, 'Sélectionne les lignes dans Excel, en-têtes compris, copie, puis colle ici. Colonnes reconnues : Nom, Année, Département, TD, TP, Option, Groupe langue, Adresse, Type (normale, coloc, immeuble, résidence), Notes, Armes, Points.'));
        body.appendChild(h('p', { class: 'prose' }, 'S\'il y a une colonne « Joue au Killer ? », seules les lignes à OUI sont importées : la base ne contient que des inscrits.'));
        body.appendChild(area); body.appendChild(out);
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'), go));
        function fresh() {
          var known = new Set(store.state.players.map(function (p) { return L.norm(p.name); }));
          return parsed.rows.filter(function (r) { var n = L.norm(r.name); if (known.has(n)) return false; known.add(n); return true; });
        }
        function preview() {
          parsed = L.parseImport(area.value);
          var rows = fresh();
          out.textContent = parsed.rows.length ? rows.length + ' à importer, ' + (parsed.rows.length - rows.length) + ' déjà dans la base, ' + parsed.skipped + ' ignorés (non inscrits ou sans nom).' : 'Aucune ligne reconnue pour l\'instant.';
          go.disabled = !rows.length;
        }
        function run() {
          var rows = fresh().map(function (r) { return Object.assign({ year: '', dept: '', td: '', tp: '', option: '', lang_group: '', address: '', address_type: 'normale', lat: null, lng: null, notes: '', weapons: '', points: 0, is_ally: false, photo_path: null }, r); });
          store.insertMany('players', rows); store.log(rows.length + ' joueurs importés');
          var toPlace = rows.filter(L.hasAddress).length;
          api.close(); ui.toast(rows.length + ' joueurs importés.' + (toPlace ? ' Ouvre l\'onglet Map pour localiser les ' + toPlace + ' adresses.' : ''));
        }
      }
    });
  };
})();
