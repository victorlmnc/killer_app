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
      var ask = plan.remove.length && !o.silent && !o.noConfirm
        ? ui.confirm({
          title: 'Remplacer ce qu\'on savait ?',
          text: ['Ce lien contredit :'].concat(plan.remove.map(function (l) { return name(l.hunter_id) + ' chasse ' + name(l.target_id); })),
          action: 'Remplacer'
        }) : Promise.resolve(true);
      return ask.then(function (ok) {
        if (!ok) return false;
        return applyPlan(plan).then(function () {
          if (!o.silent) {
            store.log('Lien ajouté : ' + name(hunterId) + ' chasse ' + name(targetId), { type: 'link', hunter_id: hunterId, target_id: targetId, hunter: name(hunterId), target: name(targetId), confidence: o.confidence || 'sur', source: o.source || '' });
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
        var fb = h('input', { type: 'checkbox', checked: false, onchange: total });
        var mates = h('input', { type: 'number', min: '0', max: '20', value: '0', inputmode: 'numeric', oninput: total });
        var note = h('textarea', { rows: '2', placeholder: 'Lieu, circonstances, qui était là…' });
        var sum = h('strong', {});
        var scoring = h('div', { class: 'stack' },
          ui.field('Arme', weapon), options,
          h('div', { class: 'grid-2' }, ui.field('Difficulté', diff), ui.field('Bonus', bonus)),
          h('div', { class: 'grid-2' }, ui.field('Coéquipiers (multi-kill)', mates), h('label', { class: 'check' }, fb, 'First blood (+5)')),
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
            act.recordKill({ victimId: victimId, killerId: killerId, weapon: weapon.value.trim(), note: note.value.trim(),
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
        var killId = store.uuid();
        var jobs = [store.insert('kills', { id: killId, round_id: roundId, killer_id: k.killerId || null, victim_id: k.victimId, weapon: k.weapon || '', points: k.points || 0, note: k.note || '', happened_at: new Date().toISOString() })];
        if (killer) {
          var patch = { points: (killer.points || 0) + (k.points || 0) };
          if (victim.weapons) patch.weapons = victim.weapons;   // le contrat de la victime passe toujours à son killer
          jobs.push(store.update('players', killer.id, patch));
        }
        store.log(killer ? killer.name + ' a éliminé ' + victim.name + (k.weapon ? ' (' + k.weapon + ')' : '') : victim.name + ' est mort',
          { type: 'kill', kill_id: killId, killer_id: k.killerId || null, victim_id: k.victimId, killer: killer ? killer.name : '', victim: victim.name, weapon: k.weapon || '', points: k.points || 0, note: k.note || '' });
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

  /* ---------------------------------------------- fiabilité et source d'un lien */
  var CONF_OPTIONS = [{ value: 'sur', label: 'Sûr' }, { value: 'probable', label: 'Probable' }, { value: 'rumeur', label: 'Rumeur' }];
  act.edgeTitle = function (links, confidence) {
    var src = (links || []).map(function (l) { return l.source; }).filter(Boolean);
    return ui.confLabel[confidence || 'sur'] + (src.length ? '. Source : ' + src.join(' ; ') : '. Source non renseignée') + '. Clique pour modifier.';
  };
  /* links : les liens bruts derrière une flèche (plusieurs quand des morts séparent les deux vivants) */
  act.editEdge = function (links) {
    links = (links || []).filter(function (l) { return store.state.links.some(function (x) { return x.id === l.id; }); });
    if (!links.length) return;
    ui.dialog({
      title: 'Fiabilité du lien',
      render: function (body, api) {
        var rows = links.map(function (l) {
          var conf = ui.select(CONF_OPTIONS, l.confidence || 'sur', { 'aria-label': 'Fiabilité' });
          var src = h('input', { type: 'text', value: l.source || '', placeholder: 'ex. vu sur son téléphone, dit par Emma' });
          body.appendChild(h('div', { class: 'edge-edit' },
            h('p', { class: 'link-preview' }, h('strong', {}, name(l.hunter_id)), h('span', { class: 'thread-arrow' }, ' chasse '), h('strong', {}, name(l.target_id)), act.isDead(l.target_id) ? ' (mort)' : ''),
            h('div', { class: 'grid-2' }, ui.field('Fiabilité', conf), ui.field('D\'où vient l\'info', src)),
            h('button', { type: 'button', class: 'linkish danger small', onclick: function () {
              ui.confirm({ title: 'Supprimer ce lien ?', text: name(l.hunter_id) + ' ne chassera plus ' + name(l.target_id) + ' : la chaîne est coupée à cet endroit.', action: 'Supprimer le lien', danger: true })
                .then(function (ok) { if (ok) { api.close(); store.remove('links', l.id); store.log('Lien supprimé : ' + name(l.hunter_id) + ' ne chasse plus ' + name(l.target_id)); } });
            } }, 'Supprimer ce lien')));
          return { link: l, conf: conf, src: src };
        });
        if (links.length > 1) body.insertBefore(h('p', { class: 'prose muted small' }, 'Des morts séparent ces deux joueurs : la flèche affiche la fiabilité la plus faible de ces ' + links.length + ' liens.'), body.firstChild);
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Annuler'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            rows.forEach(function (r) {
              var patch = { confidence: r.conf.value, source: r.src.value.trim() };
              if (patch.confidence !== (r.link.confidence || 'sur') || patch.source !== (r.link.source || '')) {
                store.update('links', r.link.id, patch);
                store.log('Lien mis à jour : ' + name(r.link.hunter_id) + ' chasse ' + name(r.link.target_id) + ' (' + ui.confLabel[patch.confidence].toLowerCase() + ')',
                  { type: 'link', hunter_id: r.link.hunter_id, target_id: r.link.target_id, hunter: name(r.link.hunter_id), target: name(r.link.target_id), confidence: patch.confidence, source: patch.source });
              }
            });
            api.close();
          } }, 'Enregistrer')));
      }
    });
  };

  /* ------------------------------------------------ déplacement dans la chaîne */
  act.applyMove = function (roundId, mode, seg, dest) {
    return (roundId ? Promise.resolve(roundId) : ensureRound()).then(function (rid) {
      var plan = L.planMove(store.state, rid, mode, seg, dest);
      if (plan.error) { ui.toast(plan.error, 'error'); return false; }
      if (plan.noop || (!plan.remove.length && !plan.add.length)) return false;
      return applyPlan(plan).then(function () {
        var who = seg.length === 1 ? name(seg[0]) : name(seg[0]) + ' et ' + (seg.length - 1) + ' autre' + (seg.length > 2 ? 's' : '');
        var where = dest.tray ? 'sorti de la chaîne' : dest.after && dest.before ? 'placé entre ' + name(dest.after) + ' et ' + name(dest.before)
          : dest.after ? 'placé après ' + name(dest.after) : 'placé avant ' + name(dest.before);
        store.log('Chaîne : ' + who + ' ' + where, { type: 'move', players: seg.map(name), after: dest.after ? name(dest.after) : '', before: dest.before ? name(dest.before) : '',
          added: plan.add.map(function (l) { return name(l.hunter_id) + ' chasse ' + name(l.target_id); }), removed: plan.remove.map(function (l) { return name(l.hunter_id) + ' chasse ' + name(l.target_id); }) });
        return true;
      });
    });
  };

  /* ------------------------------------------------------ détails d'un kill */
  act.killSummary = function (k) {
    return [k.weapon ? 'Arme : ' + k.weapon : null, (k.points || 0) + ' pt' + ((k.points || 0) > 1 ? 's' : ''), k.note ? 'Note : ' + k.note : 'Pas de note', ui.ago(k.happened_at)].filter(Boolean).join('. ') + '.';
  };
  act.killDetails = function (killId) {
    var k = store.state.kills.find(function (x) { return x.id === killId; });
    if (!k) return ui.toast('Ce kill a été annulé depuis.', 'error');
    ui.dialog({
      title: 'Détails du kill',
      render: function (body, api) {
        var killer = k.killer_id && store.player(k.killer_id), victim = store.player(k.victim_id), round = store.state.rounds.find(function (r) { return r.id === k.round_id; });
        var weapon = h('input', { type: 'text', value: k.weapon || '' }), note = h('textarea', { rows: '3', value: k.note || '', placeholder: 'Lieu, circonstances, qui était là…' });
        function who(label, p) { return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label), p ? h('button', { type: 'button', class: 'row row-btn', onclick: function () { api.close(); act.openPlayer(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name)) : h('p', { class: 'muted' }, 'Inconnu')); }
        body.appendChild(h('div', { class: 'relations' }, who('Killer', killer), who('Victime', victim)));
        body.appendChild(h('dl', { class: 'facts' },
          h('div', {}, h('dt', {}, 'Quand'), h('dd', {}, new Date(k.happened_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }))),
          h('div', {}, h('dt', {}, 'Boucle'), h('dd', {}, round ? round.name : 'Inconnue')),
          h('div', {}, h('dt', {}, 'Points'), h('dd', {}, String(k.points || 0)))));
        body.appendChild(h('div', { class: 'stack' }, ui.field('Arme', weapon), ui.field('Note', note)));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, 'Fermer'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { store.update('kills', k.id, { weapon: weapon.value.trim(), note: note.value.trim() }); api.close(); ui.toast('Kill mis à jour.'); } }, 'Enregistrer')));
      }
    });
  };

  /* ----------------------------------------- détails d'une ligne du journal */
  act.eventSummary = function (e) {
    var d = e.details || {};
    if (d.type === 'kill') return [d.weapon ? 'Arme : ' + d.weapon : null, (d.points || 0) + ' pts', d.note ? 'Note : ' + d.note : 'Pas de note'].filter(Boolean).join('. ') + '.';
    if (d.type === 'link') return ui.confLabel[d.confidence || 'sur'] + (d.source ? '. Source : ' + d.source : '. Source non renseignée') + '.';
    if (d.type === 'move') return (d.added || []).join(' ; ') || 'Aucun nouveau lien.';
    return e.text;
  };
  act.eventDetails = function (e) {
    var d = e.details || {};
    if (d.type === 'kill' && store.state.kills.some(function (k) { return k.id === d.kill_id; })) return act.killDetails(d.kill_id);
    ui.dialog({
      title: 'Détail de l\'info',
      render: function (body, api) {
        body.appendChild(h('p', { class: 'prose' }, h('strong', {}, e.text)));
        var facts = [['Par', e.actor || 'inconnu'], ['Quand', new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })]];
        if (d.type === 'link') facts.push(['Fiabilité', ui.confLabel[d.confidence || 'sur']], ['Source', d.source || 'Non renseignée']);
        if (d.type === 'kill') facts.push(['Arme', d.weapon || 'Non renseignée'], ['Points', String(d.points || 0)], ['Note', d.note || 'Aucune'], ['État', 'Ce kill a été annulé depuis']);
        if (d.type === 'move') facts.push(['Liens créés', (d.added || []).join(' ; ') || 'Aucun'], ['Liens retirés', (d.removed || []).join(' ; ') || 'Aucun']);
        body.appendChild(h('dl', { class: 'facts facts-wide' }, facts.map(function (f) { return h('div', {}, h('dt', {}, f[0]), h('dd', {}, f[1])); })));
        var actions = h('div', { class: 'actions' });
        if (d.type === 'link') {
          var live = store.state.links.filter(function (l) { return l.hunter_id === d.hunter_id && l.target_id === d.target_id; });
          if (live.length) actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); act.editEdge(live.slice(-1)); } }, 'Modifier ce lien'));
        }
        [d.hunter_id, d.target_id, d.killer_id, d.victim_id].filter(function (id) { return id && store.player(id); }).forEach(function (id) {
          actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); act.openPlayer(id); } }, 'Fiche de ' + name(id)));
        });
        actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onclick: api.close }, 'Fermer'));
        body.appendChild(actions);
      }
    });
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

      var deadNow = L.deadSet(st);
      /* dir 'target' : qui p chasse ; dir 'hunter' : qui chasse p. Le menu ne propose que les joueurs encore « libres » de ce côté. */
      function person(label, res, dir) {
        var other = res && res.id && store.player(res.id);
        var free = st.players.filter(function (x) {
          if (x.id === p.id || deadNow.has(x.id)) return false;
          if (other && x.id === other.id) return true;
          return dir === 'target' ? !maps.hunterOf.has(x.id) : !L.resolveTarget(st, roundId, x.id, maps, deadNow).id;
        }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var select = ui.select([{ value: '', label: dir === 'target' ? 'Cible inconnue' : 'Killer inconnu' }].concat(free.map(function (x) { return { value: x.id, label: x.name }; })), other ? other.id : '', {
          'aria-label': label, disabled: !isCurrent, onchange: function (e) {
            var id = e.target.value;
            if (!id) { var cut = dir === 'target' ? (other && maps.hunterOf.get(other.id)) : maps.hunterOf.get(p.id); if (cut) store.remove('links', cut.id); return; }
            if (dir === 'target') act.setTarget(p.id, id, { roundId: roundId, confidence: 'sur', noConfirm: true });
            else act.setTarget(id, p.id, { roundId: roundId, confidence: 'sur', noConfirm: true });
          } });
        return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label),
          h('div', { class: 'relation-pick' }, other ? ui.avatar(other, 'sm') : h('span', { class: 'avatar avatar-sm avatar-empty', 'aria-hidden': 'true' }, '?'), select),
          other ? h('div', { class: 'relation-meta' },
            h('button', { type: 'button', class: 'tag tag-conf tag-' + res.confidence, title: act.edgeTitle(res.links, res.confidence), onclick: function () { act.editEdge(res.links); } }, ui.confLabel[res.confidence]),
            h('button', { type: 'button', class: 'linkish small', onclick: function () { api.close(); act.openPlayer(other.id, ctx); } }, 'Voir sa fiche'))
            : res && res.via.length ? h('p', { class: 'muted small' }, 'Piste perdue après ' + name(res.via[res.via.length - 1]) + ' (mort).') : null);
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
        body.appendChild(h('button', { type: 'button', class: 'death', title: act.killSummary(kill), onclick: function () { act.killDetails(kill.id); } }, h('span', { class: 'stamp', 'aria-hidden': 'true' }, 'Éliminé'),
          h('span', {}, 'Tué ' + (kill.killer_id ? 'par ' + name(kill.killer_id) : 'par un killer inconnu') + (kill.weapon ? ' avec « ' + kill.weapon + ' »' : '') + ', ' + ui.ago(kill.happened_at) + '.')));
      } else {
        body.appendChild(roundId ? h('div', { class: 'relations' }, person('Sa cible', target, 'target'), person('Son killer', hunter, 'hunter'))
          : h('p', { class: 'muted' }, 'Démarre la boucle depuis l\'onglet Chaîne pour renseigner sa cible et son killer.'));
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
      if (mine.length) body.appendChild(h('div', { class: 'victims' }, h('span', { class: 'muted' }, mine.length + ' kill' + (mine.length > 1 ? 's' : '')),
        mine.map(function (k) { return h('button', { type: 'button', class: 'tag tag-victim', title: act.killSummary(k), onclick: function () { act.killDetails(k.id); } }, name(k.victim_id), k.note ? h('span', { class: 'has-note', 'aria-label': 'avec une note' }, '✎') : null); })));

      var A = h('div', { class: 'action-grid' });
      function add(label, fn, cls) { A.appendChild(h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: fn }, label)); }
      if (!dead && isCurrent) add('Il est mort', function () { api.close(); act.killDialog(p.id); }, 'btn-danger');
      if (dead && kill) { add(kill.killer_id ? 'Changer le killer' : 'Indiquer le killer', function () { act.editKill(kill); }); add('Annuler le kill', function () { act.revive(p.id); }); }
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
