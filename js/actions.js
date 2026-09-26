/* Game actions: links, kills, rerolls, the player sheet, import/export and the account profile. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions = {};

  function name(id) { var p = store.player(id); return p ? p.name : t('unknown player'); }
  act.currentRoundId = function () { var r = L.currentRound(store.state); return r ? r.id : null; };
  act.isDead = function (id) { return L.deadSet(store.state).has(id); };

  function ensureRound() {
    var r = L.currentRound(store.state);
    if (r) return Promise.resolve(r.id);
    return store.insert('rounds', { name: t('Initial loop'), position: 0 }).then(function (row) { return row.id; });
  }
  function applyPlan(plan) {
    return Promise.all(plan.remove.map(function (l) { return store.remove('links', l.id); }))
      .then(function () { return Promise.all(plan.add.map(function (l) { return store.insert('links', l); })); });
  }
  function linkDetails(hunterId, targetId, confidence, source) {
    return { type: 'link', hunter_id: hunterId, target_id: targetId, hunter: name(hunterId), target: name(targetId), confidence: confidence || 'sur', source: source || '' };
  }

  /* "hunter targets target". Asks before contradicting existing links unless o.noConfirm. */
  act.setTarget = function (hunterId, targetId, o) {
    o = o || {};
    if (!store.canEdit()) return Promise.resolve(false);
    return (o.roundId ? Promise.resolve(o.roundId) : ensureRound()).then(function (roundId) {
      var plan = L.planSetTarget(store.state, roundId, hunterId, targetId, o.confidence, o.source, { raw: o.raw });
      if (plan.error) { ui.toast(t('A player cannot be their own target.'), 'error'); return false; }
      if (plan.noop) { if (!o.silent) ui.toast(t('This link is already known.')); return true; }
      var ask = plan.remove.length && !o.silent && !o.noConfirm
        ? ui.confirm({ title: t('Replace what we knew?'), text: [t('This link contradicts:')].concat(plan.remove.map(function (l) { return t('{a} hunts {b}', { a: name(l.hunter_id), b: name(l.target_id) }); })), action: t('Replace') })
        : Promise.resolve(true);
      return ask.then(function (ok) {
        if (!ok) return false;
        return applyPlan(plan).then(function () {
          if (!o.silent) {
            store.log(t('Link added: {a} hunts {b}', { a: name(hunterId), b: name(targetId) }), linkDetails(hunterId, targetId, o.confidence, o.source));
            ui.toast(plan.viaDead ? t('Link added, attached behind {name} (dead).', { name: name(plan.anchorId) }) : t('Link added.'));
          }
          return true;
        });
      });
    });
  };

  /* ---------------------------------------------- link confidence and source */
  var CONF_OPTIONS = function () { return ['sur', 'probable', 'rumeur'].map(function (c) { return { value: c, label: ui.confLabel(c) }; }); };
  act.edgeTitle = function (links, confidence) {
    var src = (links || []).map(function (l) { return l.source; }).filter(Boolean);
    return ui.confLabel(confidence || 'sur') + '. ' + (src.length ? t('Source: {s}', { s: src.join(' ; ') }) : t('No source given')) + (store.canEdit() ? '. ' + t('Click to edit.') : '');
  };
  act.editEdge = function (links) {
    links = (links || []).filter(function (l) { return store.state.links.some(function (x) { return x.id === l.id; }); });
    if (!links.length || !store.canEdit()) return;
    ui.dialog({
      title: t('Link reliability'),
      render: function (body, api) {
        if (links.length > 1) body.appendChild(h('p', { class: 'prose muted small' }, t('Dead players sit between these two: the arrow shows the weakest of these {n} links.', { n: links.length })));
        var rows = links.map(function (l) {
          var conf = ui.select(CONF_OPTIONS(), l.confidence || 'sur', { 'aria-label': t('Reliability') });
          var src = h('input', { type: 'text', value: l.source || '', placeholder: t('e.g. seen on their phone, told by Emma') });
          body.appendChild(h('div', { class: 'edge-edit' },
            h('p', { class: 'link-preview' }, h('strong', {}, name(l.hunter_id)), h('span', { class: 'thread-arrow' }, ' ' + t('hunts') + ' '), h('strong', {}, name(l.target_id)), act.isDead(l.target_id) ? ' (' + t('dead') + ')' : ''),
            h('div', { class: 'grid-2' }, ui.field(t('Reliability'), conf), ui.field(t('Where the information comes from'), src)),
            h('button', { type: 'button', class: 'linkish danger small', onclick: function () {
              ui.confirm({ title: t('Delete this link?'), text: t('{a} will no longer hunt {b}: the chain is cut there.', { a: name(l.hunter_id), b: name(l.target_id) }), action: t('Delete link'), danger: true })
                .then(function (ok) { if (ok) { api.close(); store.remove('links', l.id); store.log(t('Link removed: {a} no longer hunts {b}', { a: name(l.hunter_id), b: name(l.target_id) })); } });
            } }, t('Delete this link'))));
          return { link: l, conf: conf, src: src };
        });
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            rows.forEach(function (r) {
              var patch = { confidence: r.conf.value, source: r.src.value.trim() };
              if (patch.confidence !== (r.link.confidence || 'sur') || patch.source !== (r.link.source || '')) {
                store.update('links', r.link.id, patch);
                store.log(t('Link updated: {a} hunts {b} ({c})', { a: name(r.link.hunter_id), b: name(r.link.target_id), c: ui.confLabel(patch.confidence).toLowerCase() }), linkDetails(r.link.hunter_id, r.link.target_id, patch.confidence, patch.source));
              }
            });
            api.close();
          } }, t('Save'))));
      }
    });
  };

  /* ------------------------------------------------ drag and drop in the chain */
  act.applyMove = function (roundId, mode, seg, dest) {
    if (!store.canEdit()) return Promise.resolve(false);
    return (roundId ? Promise.resolve(roundId) : ensureRound()).then(function (rid) {
      var plan = L.planMove(store.state, rid, mode, seg, dest);
      if (plan.error || plan.noop || (!plan.remove.length && !plan.add.length)) return false;
      return applyPlan(plan).then(function () {
        var who = seg.length === 1 ? name(seg[0]) : t('{name} and {n} others', { name: name(seg[0]), n: seg.length - 1 });
        var where = dest.tray ? t('taken out of the chain') : dest.after && dest.before ? t('placed between {a} and {b}', { a: name(dest.after), b: name(dest.before) })
          : dest.after ? t('placed after {a}', { a: name(dest.after) }) : t('placed before {b}', { b: name(dest.before) });
        store.log(t('Chain: {who} {where}', { who: who, where: where }), { type: 'move', players: seg.map(name), after: dest.after ? name(dest.after) : '', before: dest.before ? name(dest.before) : '',
          added: plan.add.map(function (l) { return t('{a} hunts {b}', { a: name(l.hunter_id), b: name(l.target_id) }); }), removed: plan.remove.map(function (l) { return t('{a} hunts {b}', { a: name(l.hunter_id), b: name(l.target_id) }); }) });
        return true;
      });
    });
  };

  /* ------------------------------------------------------------- kills */
  act.killDialog = function (victimId) {
    if (!store.canEdit()) return;
    var st = store.state, roundId = act.currentRoundId();
    var guess = roundId ? L.resolveHunter(st, roundId, victimId).id : null;
    var killerId = guess, victim = store.player(victimId);
    ui.dialog({
      title: t('{name} is dead', { name: victim.name }),
      render: function (body, api) {
        var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w.difficulty]; }));
        var killerBtn = h('button', { type: 'button', class: 'btn btn-block', onclick: pickKiller });
        var weapon = h('input', { type: 'text', list: 'kill-weapons', placeholder: t('Weapon used'), oninput: onWeapon });
        var options = h('datalist', { id: 'kill-weapons' });
        var diff = ui.select([{ value: 'facile', label: t('Easy (1 pt)') }, { value: 'difficile', label: t('Hard (3 pts)') }], 'facile', { onchange: total });
        var bonus = ui.select([{ value: '0', label: t('None') }, { value: '1', label: t('Video +1') }, { value: '2', label: t('Video or witnessed +2') }, { value: '3', label: t('Video or witnessed +3') }, { value: '4', label: t('Witnessed +4') }], '0', { onchange: total });
        var fb = h('input', { type: 'checkbox', checked: false, onchange: total });
        var mates = h('input', { type: 'number', min: '0', max: '20', value: '0', inputmode: 'numeric', oninput: total });
        var when = h('input', { type: 'datetime-local', value: localIso(new Date()) });
        var note = h('textarea', { rows: '2', placeholder: t('Place, circumstances, who was there…') });
        var sum = h('strong', {});
        var scoring = h('div', { class: 'stack' },
          ui.field(t('Weapon'), weapon), options,
          h('div', { class: 'grid-2' }, ui.field(t('Difficulty'), diff), ui.field(t('Bonus'), bonus)),
          h('div', { class: 'grid-2' }, ui.field(t('Teammates (multi-kill)'), mates), h('label', { class: 'check' }, fb, t('First blood (+5)'))),
          h('p', { class: 'muted' }, t('Points earned: '), sum));
        function refreshKiller() {
          ui.clear(killerBtn);
          var k = killerId && store.player(killerId);
          killerBtn.appendChild(k ? h('span', { class: 'row-inline' }, ui.avatar(k, 'sm'), k.name) : document.createTextNode(t('Killer unknown for now')));
          scoring.hidden = !k;
          ui.clear(options);
          L.weaponList(k && k.weapons).forEach(function (w) { options.appendChild(h('option', { value: w })); });
        }
        function pickKiller() {
          ui.pickPlayer({ title: t('Who killed them?'), filter: function (p) { return p.id !== victimId && !act.isDead(p.id); }, extra: [{ label: t('Killer unknown for now'), value: null }] })
            .then(function (v) { if (v !== undefined) { killerId = v; refreshKiller(); } });
        }
        function onWeapon() { var d = catalog.get(L.norm(weapon.value)); if (d) diff.value = d; total(); }
        function total() { sum.textContent = String(L.killPoints({ difficulty: diff.value, bonus: bonus.value, firstBlood: fb.checked, mates: mates.value })); }
        body.appendChild(ui.field(t('Killed by'), killerBtn, guess ? t('Suggested from the chain. Tap to change.') : null));
        body.appendChild(scoring);
        body.appendChild(h('div', { class: 'grid-2' }, ui.field(t('When'), when)));
        body.appendChild(ui.field(t('Note'), note));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            api.close();
            act.recordKill({ victimId: victimId, killerId: killerId, weapon: weapon.value.trim(), note: note.value.trim(), when: when.value ? new Date(when.value).toISOString() : null,
              points: killerId ? L.killPoints({ difficulty: diff.value, bonus: bonus.value, firstBlood: fb.checked, mates: mates.value }) : 0 });
          } }, t('Record the kill'))));
        refreshKiller(); total();
      }
    });
  };
  function localIso(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  act.recordKill = function (k) {
    return ensureRound().then(function (roundId) {
      var pre = Promise.resolve(true);
      // A kill proves the killer was hunting the victim: complete the chain if we did not know.
      if (k.killerId && L.resolveTarget(store.state, roundId, k.killerId).id !== k.victimId) {
        pre = act.setTarget(k.killerId, k.victimId, { roundId: roundId, confidence: 'sur', source: t('kill'), silent: true });
      }
      return pre.then(function () {
        var victim = store.player(k.victimId), killer = k.killerId && store.player(k.killerId);
        var killId = store.uuid();
        var jobs = [store.insert('kills', { id: killId, round_id: roundId, killer_id: k.killerId || null, victim_id: k.victimId, weapon: k.weapon || '', points: k.points || 0, note: k.note || '', happened_at: k.when || new Date().toISOString() })];
        if (killer) {
          var patch = { points: (killer.points || 0) + (k.points || 0) };
          if (victim.weapons) patch.weapons = victim.weapons;   // the victim's contract always passes to the killer
          jobs.push(store.update('players', killer.id, patch));
        }
        store.log(killer ? t('{a} eliminated {b}', { a: killer.name, b: victim.name }) + (k.weapon ? ' (' + k.weapon + ')' : '') : t('{name} is dead', { name: victim.name }),
          { type: 'kill', kill_id: killId, killer_id: k.killerId || null, victim_id: k.victimId, killer: killer ? killer.name : '', victim: victim.name, weapon: k.weapon || '', points: k.points || 0, note: k.note || '' });
        return Promise.all(jobs);
      }).then(function () {
        var next = k.killerId ? L.resolveTarget(store.state, roundId, k.killerId) : null;
        ui.toast(next && next.id ? t('Kill recorded. New target for {a}: {b}.', { a: name(k.killerId), b: name(next.id) }) : t('Kill recorded.'));
      });
    });
  };

  act.revive = function (playerId) {
    var kill = store.state.kills.find(function (k) { return k.victim_id === playerId; });
    if (!kill) return Promise.resolve();
    return ui.confirm({ title: t('Undo this kill?'), text: t('{name} is alive again. The killer\'s points are not removed automatically.', { name: name(playerId) }), action: t('Undo the kill'), danger: true })
      .then(function (ok) { if (ok) return store.remove('kills', kill.id).then(function () { store.log(t('Kill undone: {name} is alive again', { name: name(playerId) })); }); });
  };
  act.editKill = function (kill) {
    ui.pickPlayer({ title: t('Who killed {name}?', { name: name(kill.victim_id) }), filter: function (p) { return p.id !== kill.victim_id; }, extra: [{ label: t('Unknown killer'), value: null }] })
      .then(function (v) { if (v !== undefined) store.update('kills', kill.id, { killer_id: v }); });
  };
  act.killSummary = function (k) {
    return [k.weapon ? t('Weapon: {w}', { w: k.weapon }) : null, K.n(k.points || 0, '{n} pt', '{n} pts'), k.note ? t('Note: {n}', { n: k.note }) : t('No note'), ui.ago(k.happened_at)].filter(Boolean).join('. ') + '.';
  };
  act.killDetails = function (killId) {
    var k = store.state.kills.find(function (x) { return x.id === killId; });
    if (!k) return ui.toast(t('This kill has since been undone.'), 'error');
    ui.dialog({
      title: t('Kill details'),
      render: function (body, api) {
        var killer = k.killer_id && store.player(k.killer_id), victim = store.player(k.victim_id), round = store.state.rounds.find(function (r) { return r.id === k.round_id; });
        var weapon = h('input', { type: 'text', value: k.weapon || '' }), note = h('textarea', { rows: '3', value: k.note || '', placeholder: t('Place, circumstances, who was there…') });
        function who(label, p) { return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label), p ? h('button', { type: 'button', class: 'row row-btn', onclick: function () { api.close(); act.openPlayer(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name)) : h('p', { class: 'muted' }, t('Unknown'))); }
        body.appendChild(h('div', { class: 'relations' }, who(t('Killer'), killer), who(t('Victim'), victim)));
        body.appendChild(h('dl', { class: 'facts' },
          h('div', {}, h('dt', {}, t('When')), h('dd', {}, ui.when(k.happened_at))),
          h('div', {}, h('dt', {}, t('Round')), h('dd', {}, round ? round.name : t('Unknown'))),
          h('div', {}, h('dt', {}, t('Points')), h('dd', {}, String(k.points || 0)))));
        if (store.canEdit()) {
          body.appendChild(h('div', { class: 'stack' }, ui.field(t('Weapon'), weapon), ui.field(t('Note'), note)));
          body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Close')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { store.update('kills', k.id, { weapon: weapon.value.trim(), note: note.value.trim() }); api.close(); ui.toast(t('Kill updated.')); } }, t('Save'))));
        } else {
          body.appendChild(h('dl', { class: 'facts facts-wide' }, h('div', {}, h('dt', {}, t('Weapon')), h('dd', {}, k.weapon || '—')), h('div', {}, h('dt', {}, t('Note')), h('dd', {}, k.note || '—'))));
        }
      }
    });
  };

  /* ----------------------------------------- activity log entries */
  act.eventSummary = function (e) {
    var d = e.details || {};
    if (d.type === 'kill') return [d.weapon ? t('Weapon: {w}', { w: d.weapon }) : null, K.n(d.points || 0, '{n} pt', '{n} pts'), d.note ? t('Note: {n}', { n: d.note }) : t('No note')].filter(Boolean).join('. ') + '.';
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

  /* ------------------------------------------------------------- rounds */
  act.newRound = function () {
    if (!store.canEdit()) return;
    var rounds = L.sortedRounds(store.state), n = rounds.length;
    var input = h('input', { type: 'text', value: n === 0 ? t('Initial loop') : t('Reroll {n}', { n: n }) });
    ui.dialog({
      title: n === 0 ? t('Start the loop') : t('New reroll'),
      render: function (body, api) {
        if (n) body.appendChild(h('p', { class: 'prose' }, t('"{name}" is archived as it is and stays available. The new loop starts empty with the {n} players still alive.', { name: rounds[n - 1].name, n: L.stats(store.state).alive })));
        body.appendChild(ui.field(t('Round name'), input));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var label = input.value.trim() || t('Reroll {n}', { n: n });
            store.insert('rounds', { name: label, position: n ? rounds[n - 1].position + 1 : 0 });
            store.log(t('New round: {name}', { name: label }));
            api.close(); ui.toast(t('Round "{name}" created.', { name: label }));
          } }, n === 0 ? t('Start') : t('Create the reroll'))));
      }
    });
  };

  /* ------------------------------------------------------- player sheet */
  act.openPlayer = function (playerId, ctx) {
    ctx = ctx || {};
    var off = null;
    var dlg = ui.dialog({ title: '', onClose: function () { if (off) off(); }, render: function (body, api) { draw(body, api); } });
    off = store.on(function () { if (dlg.el.open) draw(dlg.body, dlg); });

    function draw(body, api) {
      var p = store.player(playerId);
      if (!p) { api.close(); return; }
      var st = store.state, roundId = ctx.roundId || act.currentRoundId(), edit = store.canEdit();
      var isCurrent = roundId === act.currentRoundId();
      var deadNow = L.deadSet(st), dead = deadNow.has(p.id);
      var kill = st.kills.find(function (k) { return k.victim_id === p.id; });
      var target = roundId && !dead ? L.resolveTarget(st, roundId, p.id) : null;
      var hunter = roundId && !dead ? L.resolveHunter(st, roundId, p.id) : null;
      var maps = roundId ? L.linkMaps(st, roundId) : null;
      var catalog = new Map(st.weapons.map(function (w) { return [L.norm(w.name), w.difficulty]; }));
      api.setTitle(p.name);
      ui.clear(body);

      /* dir 'target': who p hunts; dir 'hunter': who hunts p. The menu only lists players still free on that side. */
      function person(label, res, dir) {
        var other = res && res.id && store.player(res.id);
        var free = st.players.filter(function (x) {
          if (x.id === p.id || deadNow.has(x.id)) return false;
          if (other && x.id === other.id) return true;
          return dir === 'target' ? !maps.hunterOf.has(x.id) : !L.resolveTarget(st, roundId, x.id, maps, deadNow).id;
        }).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); });
        var select = ui.select([{ value: '', label: dir === 'target' ? t('Unknown target') : t('Unknown killer') }].concat(free.map(function (x) { return { value: x.id, label: x.name }; })), other ? other.id : '', {
          'aria-label': label, disabled: !isCurrent || !edit, onchange: function (e) {
            var id = e.target.value;
            if (!id) { var cut = dir === 'target' ? (other && maps.hunterOf.get(other.id)) : maps.hunterOf.get(p.id); if (cut) store.remove('links', cut.id); return; }
            if (dir === 'target') act.setTarget(p.id, id, { roundId: roundId, confidence: 'sur', noConfirm: true });
            else act.setTarget(id, p.id, { roundId: roundId, confidence: 'sur', noConfirm: true });
          } });
        return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label),
          h('div', { class: 'relation-pick' }, other ? ui.avatar(other, 'sm') : h('span', { class: 'avatar avatar-sm avatar-empty', 'aria-hidden': 'true' }, '?'), select),
          other ? h('div', { class: 'relation-meta' },
            h('button', { type: 'button', class: 'tag tag-conf tag-' + res.confidence, title: act.edgeTitle(res.links, res.confidence), onclick: function () { act.editEdge(res.links); } }, ui.confLabel(res.confidence)),
            h('button', { type: 'button', class: 'linkish small', onclick: function () { api.close(); act.openPlayer(other.id, ctx); } }, t('Open sheet')))
            : res && res.via.length ? h('p', { class: 'muted small' }, t('Trail lost after {name} (dead).', { name: name(res.via[res.via.length - 1]) })) : null);
      }

      var file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function () { if (file.files[0]) store.setPhoto(p.id, file.files[0]); } });
      function showPhoto() {
        var offPhoto = null;
        ui.dialog({ title: p.name, onClose: function () { if (offPhoto) offPhoto(); }, render: function (photoBody) {
          function drawPhoto() {
            var current = store.player(playerId);
            if (!current) return;
            ui.clear(photoBody);
            var url = store.photoUrl(current.photo_path);
            photoBody.appendChild(url ? h('img', { class: 'photo-viewer-image', src: url, alt: current.name }) : ui.avatar(current, 'xl'));
            if (!edit) return;
            var picker = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function () { if (picker.files[0]) store.setPhoto(current.id, picker.files[0]); } });
            photoBody.appendChild(picker);
            var actions = h('div', { class: 'photo-viewer-actions' },
              h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { picker.click(); } }, t('Change photo')));
            if (current.photo_path) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { store.removePhoto(current.id); } }, t('Remove photo')));
            photoBody.appendChild(actions);
          }
          offPhoto = store.on(drawPhoto);
          drawPhoto();
        } });
      }
      body.appendChild(h('div', { class: 'profile' },
        p.photo_path || edit ? h('button', { type: 'button', class: 'profile-photo', 'aria-label': p.photo_path ? t('View photo') : t('Change photo'), onclick: function () { if (p.photo_path) showPhoto(); else file.click(); } }, ui.avatar(p, 'xl')) : ui.avatar(p, 'xl'), file,
        h('div', { class: 'profile-meta' },
          h('div', { class: 'tags' }, ui.yearTag(p), p.tp ? h('span', { class: 'tag' }, p.tp) : null, p.lang_group ? h('span', { class: 'tag' }, p.lang_group) : null, p.option ? h('span', { class: 'tag' }, p.option) : null),
          h('div', { class: 'tags' }, h('span', { class: 'tag ' + (dead ? 'tag-dead' : 'tag-alive') }, dead ? t('Dead') : t('Alive')),
            p.is_ally ? h('span', { class: 'tag tag-ally' }, t('Alliance')) : null, h('span', { class: 'tag tag-points' }, K.n(p.points || 0, '{n} pt', '{n} pts'))))));

      if (dead && kill) {
        body.appendChild(h('button', { type: 'button', class: 'death', title: act.killSummary(kill), onclick: function () { act.killDetails(kill.id); } }, h('span', { class: 'stamp', 'aria-hidden': 'true' }, t('Eliminated')),
          h('span', {}, (kill.killer_id ? t('Killed by {name}', { name: name(kill.killer_id) }) : t('Killed by an unknown player')) + (kill.weapon ? ' ' + t('with "{w}"', { w: kill.weapon }) : '') + ', ' + ui.ago(kill.happened_at) + '.')));
      } else {
        body.appendChild(roundId ? h('div', { class: 'relations' }, person(t('Killer'), hunter, 'hunter'), person(t('Target'), target, 'target'))
          : h('p', { class: 'muted' }, t('Start the loop from the Chain tab to record targets and killers.')));
      }

      var weapons = L.weaponList(p.weapons);
      if (weapons.length) body.appendChild(h('div', { class: 'tags' }, weapons.map(function (w) {
        var d = catalog.get(L.norm(w));
        return h('span', { class: 'tag tag-weapon' }, K.icon('weapons', 'ic-sm'), w + (d ? ' (' + (d === 'difficile' ? t('hard') : t('easy')) + ')' : ''));
      })));
      if (p.address) body.appendChild(h('p', { class: 'prose' }, h('span', { class: 'muted' }, t('Address: ')), p.address,
        L.addressType(p.address_type) !== 'normale' ? ' (' + t(L.ADDRESS_TYPES.find(function (x) { return x.id === L.addressType(p.address_type); }).label).toLowerCase() + ')' : '',
        L.hasCoords(p) ? [' ', h('a', { class: 'linkish', href: '#/map?player=' + p.id, onclick: function () { api.close(); } }, t('Show on map'))] : null));
      if (p.notes) body.appendChild(h('p', { class: 'prose notes' }, p.notes));

      var mine = st.kills.filter(function (k) { return k.killer_id === p.id; });
      if (mine.length) body.appendChild(h('div', { class: 'victims' }, h('span', { class: 'muted' }, K.n(mine.length, '{n} kill', '{n} kills')),
        mine.map(function (k) { return h('button', { type: 'button', class: 'tag tag-victim', title: act.killSummary(k), onclick: function () { act.killDetails(k.id); } }, name(k.victim_id), k.note ? h('span', { class: 'has-note', 'aria-label': t('with a note') }, '✎') : null); })));

      if (!edit) return;
      var A = h('div', { class: 'action-grid' });
      function add(label, fn, cls) { A.appendChild(h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: fn }, label)); }
      if (!dead && isCurrent) add(t('Mark as dead'), function () { api.close(); act.killDialog(p.id); }, 'btn-danger');
      if (dead && kill) { add(kill.killer_id ? t('Change killer') : t('Set killer'), function () { act.editKill(kill); }); add(t('Undo the kill'), function () { act.revive(p.id); }); }
      add(t('Edit sheet'), function () { act.editPlayer(p.id); });
      body.appendChild(A);
    }
  };

  act.editPlayer = function (playerId) {
    if (!store.canEdit()) return;
    var p = playerId ? store.player(playerId) : {}, s = store.state.settings;
    ui.dialog({
      title: playerId ? t('Edit sheet') : t('Add a player'),
      render: function (body, api) {
        var typeTouched = false;
        var f = {
          name: h('input', { type: 'text', value: p.name || '', placeholder: t('LASTNAME Firstname'), required: true }),
          year: ui.select([{ value: '', label: '—' }].concat((s.years || []).map(function (y) { return y.name; })), p.year || ''),
          dept: ui.select([{ value: '', label: '—' }].concat(s.depts || []), p.dept || ''),
          td: h('input', { type: 'text', value: p.td || '', placeholder: 'TD1' }), tp: h('input', { type: 'text', value: p.tp || '', placeholder: 'TP1' }),
          option: h('input', { type: 'text', value: p.option || '' }), lang_group: h('input', { type: 'text', value: p.lang_group || '', placeholder: 'G2' }),
          weapons: h('input', { type: 'text', value: p.weapons || '', placeholder: t('Banana, Watering can') }),
          points: h('input', { type: 'number', min: '0', inputmode: 'numeric', value: String(p.points || 0) }),
          is_ally: h('input', { type: 'checkbox', checked: !!p.is_ally }),
          address: h('input', { type: 'text', value: p.address || '', placeholder: t('e.g. 12 High Street, Town'), autocomplete: 'off', oninput: function () { if (!typeTouched && !p.address) f.address_type.value = L.guessAddressType(f.address.value); } }),
          address_type: ui.select(L.ADDRESS_TYPES.slice().reverse().map(function (x) { return { value: x.id, label: t(x.label) }; }), L.addressType(p.address_type), { onchange: function () { typeTouched = true; } }),
          notes: h('textarea', { rows: '3', value: p.notes || '', placeholder: t('Habits on campus, clubs, who could save them…') })
        };
        body.appendChild(h('div', { class: 'stack' },
          ui.field(t('Name'), f.name),
          h('div', { class: 'grid-2' }, ui.field(t('Year'), f.year), ui.field(t('Department'), f.dept)),
          h('div', { class: 'grid-2' }, ui.field('TD', f.td), ui.field('TP', f.tp)),
          h('div', { class: 'grid-2' }, ui.field(t('Option'), f.option), ui.field(t('Language group'), f.lang_group)),
          h('div', { class: 'grid-2' }, ui.field(t('Weapons in hand'), f.weapons, t('Comma-separated')), ui.field(t('Points'), f.points)),
          h('label', { class: 'check' }, f.is_ally, t('Alliance member')),
          ui.field(t('Address'), f.address, t('Include the town so the marker lands in the right place.')),
          ui.field(t('Housing type'), f.address_type, t('Sets the icon and the layer on the map.')), ui.field(t('Notes'), f.notes)));
        var actions = h('div', { class: 'actions' });
        if (playerId) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () {
          ui.confirm({ title: t('Delete {name}?', { name: p.name }), text: t('Their sheet, photo, links and kill (if any) are erased.'), action: t('Delete'), danger: true })
            .then(function (ok) { if (ok) { store.removePhoto(playerId).then(function () { store.remove('players', playerId); }); api.close(); } });
        } }, t('Delete')));
        actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')));
        actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var row = {}; Object.keys(f).forEach(function (k) { row[k] = f[k].value.trim(); });
          if (!row.name) { f.name.focus(); return ui.toast(t('A name is required.'), 'error'); }
          row.points = Math.max(0, parseInt(row.points, 10) || 0);
          row.is_ally = f.is_ally.checked;
          var moved = (p.address || '') !== row.address;
          if (moved) { row.lat = null; row.lng = null; }
          var saved = playerId ? store.update('players', playerId, row).then(function () { return playerId; })
            : store.insert('players', Object.assign({ is_ally: false, photo_path: null, lat: null, lng: null }, row)).then(function (r) { return r.id; });
          if (moved && row.address) saved.then(function (id) { return K.geo.locatePlayer(id); }).then(function (hit) { if (!hit) ui.toast(t('Address not found: you can place the marker by hand from the Map tab.'), 'error'); });
          api.close(); ui.toast(playerId ? t('Sheet saved.') : t('{name} added.', { name: row.name }));
        } }, playerId ? t('Save') : t('Add the player')));
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
  function playerRows() {
    var st = store.state, dead = L.deadSet(st), round = L.currentRound(st), maps = round && L.linkMaps(st, round.id);
    return st.players.slice().sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); }).map(function (p) {
      var d = dead.has(p.id), tg = round && !d ? L.resolveTarget(st, round.id, p.id, maps, dead) : null, hu = round && !d ? L.resolveHunter(st, round.id, p.id, maps, dead) : null;
      return { p: p, dead: d, target: tg && tg.id ? name(tg.id) : '', hunter: hu && hu.id ? name(hu.id) : '', targetConf: tg && tg.id ? ui.confLabel(tg.confidence) : '' };
    });
  }
  act.exportCsv = function () {
    var header = [t('Name'), t('Status'), t('Year'), t('Department'), 'TD', 'TP', t('Option'), t('Language group'), t('Points'), t('Weapons'), t('Target'), t('Reliability'), t('Killer'), t('Alliance'), t('Address'), t('Housing type'), t('Notes')];
    var rows = playerRows().map(function (r) { var p = r.p; return [p.name, r.dead ? t('Dead') : t('Alive'), p.year, p.dept, p.td, p.tp, p.option, p.lang_group, p.points || 0, p.weapons, r.target, r.targetConf, r.hunter, p.is_ally ? t('yes') : '', p.address, p.address ? t(L.ADDRESS_TYPES.find(function (x) { return x.id === L.addressType(p.address_type); }).label) : '', p.notes]; });
    ui.download('players-' + new Date().toISOString().slice(0, 10) + '.csv', '\ufeff' + L.toCsv(header, rows), 'text/csv;charset=utf-8');
  };
  act.exportJson = function () {
    var copy = JSON.parse(JSON.stringify(store.state));
    copy.players.forEach(function (p) { if (p.photo_path && p.photo_path.indexOf('data:') === 0) p.photo_path = null; });
    delete copy.members;
    ui.download('killer-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(copy, null, 2), 'application/json');
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
    body.appendChild(hh('button', { onclick: 'window.print()' }, [t('Print / Save as PDF')]));
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
      kt.appendChild(hh('tr', {}, [ui.when(k.happened_at), k.killer_id ? name(k.killer_id) : '?', name(k.victim_id), k.weapon || '', String(k.points || 0), k.note || ''].map(function (x) { return hh('td', {}, [x]); })));
    });
    body.appendChild(kt);
    w.focus();
  };

  /* ---------------------------------------------------------- my profile */
  act.profileDialog = function () {
    var me = store.me();
    ui.dialog({
      title: t('My profile'),
      render: function (body, api) {
        var email = store.user ? store.user.email : '';
        var nameIn = h('input', { type: 'text', value: (me && me.name) || '', maxlength: '40', placeholder: email.split('@')[0] });
        var file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function () { if (file.files[0]) store.setAvatar(file.files[0]).then(function () { ui.toast(t('Photo saved.')); }); } });
        var pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', placeholder: t('8 characters minimum') });
        var lang = ui.select([{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }], K.i18n.lang);
        var roleLabel = { admin: t('Administrator'), member: t('Alliance member'), observer: t('Observer') }[store.role] || '';
        body.appendChild(h('div', { class: 'profile' },
          h('button', { type: 'button', class: 'profile-photo', 'aria-label': t('Change photo'), onclick: function () { file.click(); } }, ui.avatar({ name: store.displayName(), avatar_path: me && me.avatar_path }, 'xl')), file,
          h('div', { class: 'profile-meta' }, h('strong', {}, store.displayName()), h('span', { class: 'muted small' }, email), h('span', { class: 'tag' }, roleLabel))));
        body.appendChild(h('div', { class: 'stack' },
          ui.field(t('Display name'), nameIn, t('Shown in the activity log next to what you record.')),
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
})();
