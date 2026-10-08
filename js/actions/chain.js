/* The chain: links (target, killer, reliability, source), drag and drop, rounds and rerolls. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions, _ = act._;
  function applyPlan() { return _.applyPlan.apply(null, arguments); }
  function ensureRound() { return _.ensureRound.apply(null, arguments); }
  function linkDetails() { return _.linkDetails.apply(null, arguments); }
  function name() { return _.name.apply(null, arguments); }

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
  /* pair = { hunterId, targetId, anchorId } (player sheet): one form for "hunter hunts target" even when dead players sit
     between them; it applies to every link in between, and "delete" cuts the link touching anchorId (the sheet's player). */
  act.editEdge = function (links, pair) {
    links = (links || []).filter(function (l) { return store.state.links.some(function (x) { return x.id === l.id; }); });
    if (!links.length || !store.canEdit()) return;
    if (pair && links.length > 1) return editPair(links, pair);
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

  function editPair(links, pair) {
    var conf0 = links.reduce(function (c, l) { return L.weakest(c, l.confidence || 'sur'); }, 'sur');
    var src0 = links.map(function (l) { return l.source; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(' ; ');
    var dead = [];   // the dead players in between (links come in either order)
    links.forEach(function (l) { [l.hunter_id, l.target_id].forEach(function (id) { if (id !== pair.hunterId && id !== pair.targetId && dead.indexOf(id) < 0) dead.push(id); }); });
    dead = dead.map(name);
    var cut = links.find(function (l) { return l.hunter_id === pair.anchorId || l.target_id === pair.anchorId; }) || links[0];
    ui.dialog({
      title: t('Link reliability'),
      render: function (body, api) {
        var conf = ui.select(CONF_OPTIONS(), conf0, { 'aria-label': t('Reliability') });
        var src = h('input', { type: 'text', value: src0, placeholder: t('e.g. seen on their phone, told by Emma') });
        body.appendChild(h('div', { class: 'edge-edit' },
          h('p', { class: 'link-preview' }, h('strong', {}, name(pair.hunterId)), h('span', { class: 'thread-arrow' }, ' ' + t('hunts') + ' '), h('strong', {}, name(pair.targetId))),
          h('p', { class: 'prose muted small' }, t('Dead players in between ({names}): the reliability applies to the whole trail.', { names: dead.join(', ') })),
          h('div', { class: 'grid-2' }, ui.field(t('Reliability'), conf), ui.field(t('Where the information comes from'), src)),
          h('button', { type: 'button', class: 'linkish danger small', onclick: function () {
            ui.confirm({ title: t('Delete this link?'), text: t('{a} will no longer hunt {b}: the chain is cut there.', { a: name(cut.hunter_id), b: name(cut.target_id) }), action: t('Delete link'), danger: true })
              .then(function (ok) { if (ok) { api.close(); store.remove('links', cut.id); store.log(t('Link removed: {a} no longer hunts {b}', { a: name(cut.hunter_id), b: name(cut.target_id) })); } });
          } }, t('Delete this link'))));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var c = conf.value, sc = src.value.trim();
            if (c === conf0 && sc === src0) return api.close();
            links.forEach(function (l) { if (c !== (l.confidence || 'sur') || sc !== (l.source || '')) store.update('links', l.id, { confidence: c, source: sc }); });
            store.log(t('Link updated: {a} hunts {b} ({c})', { a: name(pair.hunterId), b: name(pair.targetId), c: ui.confLabel(c).toLowerCase() }), linkDetails(pair.hunterId, pair.targetId, c, sc));
            api.close();
          } }, t('Save'))));
      }
    });
  }

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

  /* ------------------------------------------------------------- rounds */
  act.newRound = function () {
    if (!store.canEdit()) return;
    var rounds = L.sortedRounds(store.state), n = rounds.length;
    var input = h('input', { type: 'text', value: n === 0 ? t('Initial loop') : t('Reroll {n}', { n: n }) });
    ui.dialog({
      title: n === 0 ? t('Start the loop') : t('New reroll'),
      render: function (body, api) {
        if (n) body.appendChild(h('p', { class: 'prose' }, t('"{name}" is archived as it is and stays available. The new loop starts empty with the {n} players still alive, without weapons: everything is mixed (each sheet keeps the weapons in its history).', { name: rounds[n - 1].name, n: L.stats(store.state).alive })));
        body.appendChild(ui.field(t('Round name'), input));
        var held = L.heldWeapons(store.state), holders = Object.keys(held).length;
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var label = input.value.trim() || t('Reroll {n}', { n: n });
            if (n && holders) {   // a reroll mixes everything: the weapons of the ending round are kept on it, the sheets start empty
              store.update('rounds', rounds[n - 1].id, { held_weapons: held });
              Object.keys(held).forEach(function (id) { store.update('players', id, { weapons: '' }); });
            }
            store.insert('rounds', { name: label, position: n ? rounds[n - 1].position + 1 : 0 });
            store.log(t('New round: {name}', { name: label }));
            api.close(); ui.toast(t('Round "{name}" created.', { name: label }));
          } }, n === 0 ? t('Start') : t('Create the reroll'))));
      }
    });
  };

  /* Delete the last round: back exactly where the game was before it (see L.undoRoundPlan). */
  act.deleteRound = function (roundId) {
    if (!store.canEdit()) return Promise.resolve(false);
    var plan = L.undoRoundPlan(store.state, roundId); if (!plan.round) return Promise.resolve(false);
    var dead = plan.kills.length, text = [K.n(plan.links, 'Its {n} link is erased.', 'Its {n} links are erased.')];
    if (dead) text.push(K.n(dead, 'Its {n} kill is undone: that player is alive again and the killer loses the points of the kill and gets back the weapons they had.', 'Its {n} kills are undone: those players are alive again and the killers lose the points of these kills and get back the weapons they had.'));
    if (plan.restoreHeld) text.push(t('Everyone gets back the weapons they held at the start of the reroll; "{name}" becomes the current loop again.', { name: plan.prev.name }));
    else if (plan.prev) text.push(t('"{name}" becomes the current loop again.', { name: plan.prev.name }));
    return ui.confirm({ title: t('Delete "{name}"?', { name: plan.round.name }), text: text, action: t('Delete'), danger: true }).then(function (ok) {
      if (!ok) return false;
      return Promise.all(plan.kills.map(function (k) { return store.remove('kills', k.id); })).then(function () {
        var jobs = [];
        plan.patches.forEach(function (x) {
          var p = store.player(x.id), rest = Object.assign({}, x.patch);
          if ('points' in rest) { if (p) jobs.push(store.addPoints(x.id, rest.points - (p.points || 0))); delete rest.points; }   // a difference: a teammate's points meanwhile still count
          if (Object.keys(rest).length) jobs.push(store.update('players', x.id, rest));
        });
        if (plan.restoreHeld) jobs.push(store.update('rounds', plan.prev.id, { held_weapons: null }));   // back in play: no longer history
        return Promise.all(jobs);
      }).then(function () { return store.remove('rounds', roundId); }).then(function () {
        store.log(t('Round deleted: {name}', { name: plan.round.name }) + (dead ? ' (' + K.n(dead, '{n} kill undone', '{n} kills undone') + ')' : ''));
        ui.toast(t('Round deleted: back to where the game was before it.'));
        return true;
      });
    });
  };

  Object.assign(_, { CONF_OPTIONS: CONF_OPTIONS, editPair: editPair });
})();
