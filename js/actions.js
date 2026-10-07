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
        var adminAllowed = store.isAdmin();
        var killerBtn = h('button', { type: 'button', class: 'btn btn-block', onclick: pickKiller });
        var adminKill = h('input', { type: 'checkbox', onchange: refreshKiller });
        var adminReason = ui.select([{ value: 'cheating', label: t('Cheating') }, { value: 'other', label: t('Other') }], 'cheating');
        var killerField = ui.field(t('Killed by'), killerBtn, guess ? t('Suggested from the chain. Tap to change.') : null);
        var adminReasonField = ui.field(t('Reason for administrative elimination'), adminReason);
        /* the weapon: a menu of what the killer holds, and below a search in the catalogue (or a new weapon) for
           anything else, e.g. when their sheet is wrong. Killer unknown or without weapons: the search only. */
        var held = ui.select([], '', { 'aria-label': t('Weapon used'), onchange: function () { showPicker(); onWeapon(); } });
        var picker = ui.weaponPicker('', { max: 1, onChange: onWeapon, levelOf: function () { return diff.value; } });   // the tag takes the colour of the chosen difficulty
        picker.input.addEventListener('input', function () { if (catalog.get(L.norm(picker.value.trim()))) onWeapon(); });   // a catalogue name typed in full sets the difficulty too
        var heldField = ui.field(t('Weapon'), held), pickerField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('Another weapon')), picker.el,
          h('span', { class: 'field-hint' }, t('Search the catalogue, or type a new weapon.')));
        var OTHER = '__other';
        function weaponValue() { return !heldField.hidden && held.value !== OTHER ? held.value : picker.value.trim(); }
        function showPicker() {
          pickerField.hidden = !heldField.hidden && held.value !== OTHER;
          pickerField.querySelector('.field-label').textContent = heldField.hidden ? t('Weapon') : t('Another weapon');
        }
        var sc = L.scoring(st);   // the scoring set in Settings
        var diff = ui.select(ui.levelOptions(true), 'facile', { onchange: function () { paintLevel(); total(); } });
        function levelWord(d) { return d === 'difficile' ? t('hard') : d === 'facile' ? t('easy') : t('unknown difficulty'); }
        /* the weapon shows the difficulty chosen below: its label and colour in the menu, its tag in the search */
        function paintLevel() {
          Array.prototype.forEach.call(held.options, function (o) {
            if (o.value === OTHER) return;
            var d = o.value === held.value ? diff.value : catalog.get(L.norm(o.value));
            o.textContent = o.value + ' (' + levelWord(d) + ')';
          });
          held.classList.remove('lvl-facile', 'lvl-difficile', 'lvl-inconnue');
          if (held.value !== OTHER) held.classList.add('lvl-' + diff.value);
          picker.redraw();
        }
        var bonus = ui.select(ui.bonusOptions(), '0', { onchange: total });
        var fb = h('input', { type: 'checkbox', checked: false, onchange: total });
        var mates = h('input', { type: 'number', min: '0', max: '20', value: '0', inputmode: 'numeric', oninput: total });
        var when = h('input', { type: 'datetime-local', value: localIso(new Date()) });
        var note = h('textarea', { rows: '2', placeholder: t('Place, circumstances, who was there…') });
        var sum = h('strong', {}), noKiller = h('p', { class: 'muted small' }, t('The killer gets these points once you say who it is (from the sheet of the victim).'));
        var scoring = h('div', { class: 'stack' },
          heldField, pickerField,
          h('div', { class: 'grid-2' }, ui.field(t('Difficulty'), diff), ui.field(t('Bonus'), bonus)),
          h('div', { class: 'grid-2' }, ui.field(t('Teammates (multi-kill)'), mates), h('label', { class: 'check' }, fb, t('First blood (+{n})', { n: sc.first_blood }))),
          h('p', { class: 'muted' }, t('Points earned: '), sum), noKiller);
        function refreshKiller() {
          ui.clear(killerBtn);
          var administrative = adminAllowed && adminKill.checked;
          var k = !administrative && killerId && store.player(killerId);
          killerBtn.appendChild(k ? h('span', { class: 'row-inline' }, ui.avatar(k, 'sm'), k.name) : document.createTextNode(t('Killer unknown for now')));
          killerField.hidden = administrative;
          adminReasonField.hidden = !administrative;
          scoring.hidden = administrative;   // known killer or not: the weapon and how the kill was made are recorded
          noKiller.hidden = !!k;
          var mine = L.weaponList(k && k.weapons), keep = held.value;
          ui.clear(held);
          mine.forEach(function (w) { held.appendChild(h('option', { value: w }, w)); });   // labels: paintLevel
          held.appendChild(h('option', { value: OTHER }, t('Another weapon (catalogue or new)…')));
          held.value = mine.indexOf(keep) >= 0 || keep === OTHER ? keep : mine.length ? mine[0] : OTHER;
          heldField.hidden = !mine.length;
          showPicker(); onWeapon();
        }
        function pickKiller() {
          ui.pickPlayer({ title: t('Who killed them?'), filter: function (p) { return p.id !== victimId && !act.isDead(p.id); }, extra: [{ label: t('Killer unknown for now'), value: null }] })
            .then(function (v) { if (v !== undefined) { killerId = v; refreshKiller(); } });
        }
        /* a weapon of the catalogue brings its difficulty; a weapon it does not know starts as "don't know" */
        function onWeapon() { var w = weaponValue(), d = catalog.get(L.norm(w)); if (d) diff.value = d; else if (w) diff.value = 'inconnue'; paintLevel(); total(); }
        function total() {
          var n = L.killPoints({ difficulty: diff.value, bonus: bonus.value, firstBlood: fb.checked, mates: mates.value }, sc);
          sum.textContent = diff.value === 'inconnue' ? t('{a} or {b}', { a: n, b: n + L.levelGap(sc) }) + ' (' + t('settled once the difficulty is known') + ')' : String(n);
        }
        body.appendChild(killerField);
        if (adminAllowed) body.appendChild(h('label', { class: 'check' }, adminKill, t('Administrative elimination')));
        body.appendChild(adminReasonField);
        body.appendChild(scoring);
        body.appendChild(h('div', { class: 'grid-2' }, ui.field(t('When'), when)));
        body.appendChild(ui.field(t('Note'), note));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            var reason = adminAllowed && adminKill.checked ? adminReason.value : null;
            if (reason === 'other' && !note.value.trim()) { note.focus(); return ui.toast(t('Specify the reason in the note.'), 'error'); }
            api.close();
            act.recordKill({ victimId: victimId, killerId: reason ? null : killerId, adminReason: reason, weapon: reason ? '' : weaponValue(), level: diff.value, note: note.value.trim(), when: when.value ? parisInput(when.value).toISOString() : null,
              parts: { bonus: parseInt(bonus.value, 10) || 0, firstBlood: fb.checked, mates: Math.max(0, parseInt(mates.value, 10) || 0) } });
          } }, t('Record the kill'))));
        refreshKiller(); total();
      }
    });
  };
  // The time of a kill is typed and shown in Paris time, wherever the phone is.
  function localIso(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }, x = L.parisParts(d); return x.y + '-' + p(x.m + 1) + '-' + p(x.d) + 'T' + p(x.hh) + ':' + p(x.mi); }
  function parisInput(v) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v); return m ? L.parisDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(v); }

  act.recordKill = function (k) {
    var adminReason = k.adminReason === 'cheating' || k.adminReason === 'other' ? k.adminReason : null;
    var killerId = adminReason ? null : k.killerId;
    var weapon = adminReason ? '' : k.weapon || '';
    var sc = L.scoring(store.state), parts = !adminReason && k.parts ? k.parts : null;   // kept even when the killer is unknown: they get the points later
    var points = adminReason ? 0 : k.points || 0;
    var level = !adminReason && (killerId || weapon || parts) && ['facile', 'difficile', 'inconnue'].indexOf(k.level) >= 0 ? k.level : null;
    var cat = weapon && store.state.weapons.find(function (x) { return L.norm(x.name) === L.norm(weapon); });
    if (level === 'inconnue' && cat && cat.difficulty !== 'inconnue') { level = cat.difficulty; if (level === 'difficile' && !parts) points += L.levelGap(sc); }   // the catalogue knows it
    if (parts) points = L.killPoints({ difficulty: level, bonus: parts.bonus, firstBlood: parts.firstBlood, mates: parts.mates }, sc);
    return ensureRound().then(function (roundId) {
      var pre = Promise.resolve(true);
      // A kill proves the killer was hunting the victim: complete the chain if we did not know.
      if (killerId && L.resolveTarget(store.state, roundId, killerId).id !== k.victimId) {
        pre = act.setTarget(killerId, k.victimId, { roundId: roundId, confidence: 'sur', source: t('kill'), silent: true });
      }
      return pre.then(function () {
        var victim = store.player(k.victimId), killer = killerId && store.player(killerId);
        var killId = store.uuid();
        var inherits = !!(killer && victim.weapons);   // the victim's contract always passes to the killer; theirs is kept on the kill for an undo
        var jobs = [store.insert('kills', { id: killId, round_id: roundId, killer_id: killerId || null, victim_id: k.victimId, admin_reason: adminReason, weapon: weapon, weapon_level: level, bonus: parts ? parts.bonus : null, first_blood: parts ? !!parts.firstBlood : null, mates: parts ? parts.mates : null, points: points, note: k.note || '', killer_weapons: inherits ? killer.weapons || '' : null, happened_at: k.when || new Date().toISOString() })];
        if (killer) {
          var patch = { points: (killer.points || 0) + points };
          if (inherits) patch.weapons = victim.weapons;
          jobs.push(store.update('players', killer.id, patch));
        }
        var text = adminReason ? t('Administrative elimination of {name}: {reason}', { name: victim.name, reason: t(adminReason === 'cheating' ? 'Cheating' : 'Other') })
          : killer ? t('{a} eliminated {b}', { a: killer.name, b: victim.name }) + (weapon ? ' (' + weapon + ')' : '') : t('{name} is dead', { name: victim.name });
        store.log(text, { type: 'kill', kill_id: killId, killer_id: killerId || null, victim_id: k.victimId, admin_reason: adminReason, killer: killer ? killer.name : '', victim: victim.name, weapon: weapon, weapon_level: level, points: points, note: k.note || '' });
        // the weapon goes to the catalogue; a difficulty learnt from this kill settles the other kills made with it
        if (weapon && level && !cat) jobs.push(store.insert('weapons', { name: weapon, difficulty: level }));
        else if (cat && cat.difficulty === 'inconnue' && level && level !== 'inconnue') jobs.push(Promise.all(jobs).then(function () { return act.setWeaponDifficulty(weapon, level); }));
        return Promise.all(jobs);
      }).then(function () {
        var next = killerId ? L.resolveTarget(store.state, roundId, killerId) : null;
        ui.toast(next && next.id ? t('Kill recorded. New target for {a}: {b}.', { a: name(k.killerId), b: name(next.id) }) : t('Kill recorded.'));
      });
    });
  };

  act.revive = function (playerId) {
    var kill = store.state.kills.find(function (k) { return k.victim_id === playerId; });
    if (!kill) return Promise.resolve();
    var killer = kill.killer_id && store.player(kill.killer_id), pts = killer ? kill.points || 0 : 0, victim = store.player(playerId);
    // The killer gets their former weapons back, unless they have changed since (another kill, a manual edit).
    var same = function (a, b) { return L.weaponList(a).map(L.norm).sort().join() === L.weaponList(b).map(L.norm).sort().join(); };
    var restore = killer && kill.killer_weapons != null && victim && same(killer.weapons, victim.weapons);
    var text = [pts ? t('{name} is alive again and {killer} loses the {n} points of this kill.', { name: name(playerId), killer: killer.name, n: pts }) : t('{name} is alive again.', { name: name(playerId) })];
    if (restore) text.push(kill.killer_weapons ? t('{killer} gets their weapons back: {w}.', { killer: killer.name, w: kill.killer_weapons }) : t('{killer} had no weapon before this kill: the inherited ones are removed.', { killer: killer.name }));
    else if (killer && kill.killer_weapons != null) text.push(t('The weapons of {killer} have changed since this kill: they are left as they are.', { killer: killer.name }));
    return ui.confirm({ title: t('Undo this kill?'), text: text, action: t('Undo the kill'), danger: true })
      .then(function (ok) {
        if (!ok) return;
        var jobs = [store.remove('kills', kill.id)], patch = {};
        if (pts) patch.points = Math.max(0, (killer.points || 0) - pts);
        if (restore) patch.weapons = kill.killer_weapons;
        if (Object.keys(patch).length) jobs.push(store.update('players', killer.id, patch));
        return Promise.all(jobs).then(function () { store.log(t('Kill undone: {name} is alive again', { name: name(playerId) })); });
      });
  };
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

  /* --------------------------------------------------- when to catch a target */
  /* The coming week's moments when the target comes out of a class or goes into one, while I am not in the middle
     of one (my timetable counts when my account is linked to my sheet). Same building as my class first. */
  act.catchDialog = function (targetId) {
    var target = store.player(targetId); if (!target) return;
    var me = store.myPlayer();
    ui.dialog({ title: t('When to catch {name}', { name: target.name }), render: function (body) {
      body.appendChild(h('p', { class: 'muted small' }, me && me.id !== target.id ? t('Moments when {name} comes out of a class or goes into one while you are not in the middle of one, over the next 7 days (Paris time).', { name: target.name })
        : t('Moments when {name} comes out of a class or goes into one, over the next 7 days (Paris time). Link your account to your sheet to take your own timetable into account.', { name: target.name })));
      var box = body.appendChild(h('div', { class: 'stack-tight' }, h('p', { class: 'muted small' }, t('Loading the timetable…'))));
      var mine = me && me.id !== target.id && store.calendarsFor(me).length ? store.playerEvents(me).then(function (r) { return r.events; }, function () { return []; }) : Promise.resolve([]);
      Promise.all([store.playerEvents(target), mine]).then(function (res) {
        var list = L.killWindows(res[0].events, res[1], new Date(), 7);
        ui.clear(box);
        if (!list.length) return box.appendChild(h('p', { class: 'empty' }, t('No moment found in the coming week.')));
        var day = '';
        list.forEach(function (w) {
          var key = L.parisDay(w.at);
          if (key !== day) { day = key; box.appendChild(h('h3', { class: 'week-day' }, ui.dayLabel(w.at))); }
          box.appendChild(h('div', { class: 'catch-row' + (w.near ? ' is-near' : '') },
            h('span', { class: 'week-time' }, ui.hm(w.at)),
            h('span', {}, h('strong', {}, w.kind === 'leaves' ? t('comes out of class') : t('goes to class')), w.where ? ' · ' + w.where : '',
              h('span', { class: 'muted small week-desc' }, w.event.subject || w.event.summary || '')),
            w.near ? h('span', { class: 'tag tag-near' }, t('near you')) : null));
        });
      }, function (err) { ui.clear(box).appendChild(h('p', { class: 'muted small' }, t('Timetable unavailable: {err}', { err: err.message || err }))); });
    } });
  };

  /* ------------------------------------------------------------ shop bonuses */
  /* Record that a player bought a shop item: when it takes effect and until when (from the item's timing,
     adjustable), and optionally take the price off their points. */
  act.recordBonus = function (item, playerId) {
    if (!store.canEdit()) return;
    var chosen = playerId || null;
    ui.dialog({
      title: t('Record a purchase: {name}', { name: item.name }),
      render: function (body, api) {
        var who = h('button', { type: 'button', class: 'btn btn-block' });
        function drawWho() { var p = chosen && store.player(chosen); ui.clear(who); if (p) { who.appendChild(ui.avatar(p, 'sm')); who.appendChild(h('span', {}, p.name + ' (' + ui.pointsText(p) + ')')); } else who.appendChild(h('span', {}, t('Choose the player'))); }
        who.addEventListener('click', function () {
          ui.pickPlayer({ title: t('Who bought "{name}"?', { name: item.name }), filter: function (p) { return !act.isDead(p.id); }, prefer: function (p) { return !p.is_ally; }, otherLabel: t('Alliance') })
            .then(function (v) { if (v) { chosen = v; drawWho(); } });
        });
        var tm = L.bonusTiming(item), now = new Date();
        var bought = h('input', { type: 'datetime-local', value: localIso(now), onchange: recompute });
        var starts = h('input', { type: 'datetime-local', value: localIso(L.bonusWindow(item, now).starts) });
        var hours = h('input', { type: 'number', min: '0', step: '0.5', inputmode: 'decimal', value: String(tm.hours) });
        var pay = h('input', { type: 'checkbox', checked: (item.price || 0) > 0 });
        var note = h('input', { type: 'text', placeholder: t('e.g. seen on the organisers\' group') });
        function recompute() { if (bought.value) starts.value = localIso(L.bonusWindow(item, parisInput(bought.value)).starts); }
        drawWho();
        body.appendChild(h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('Player')), who),
          ui.field(t('Bought at'), bought, t('Paris time.')),
          h('div', { class: 'grid-2 grid-align-start' }, ui.field(t('In effect from'), starts, tm.start === 'next_day' ? t('00:10 the day after the purchase.') : t('As soon as it is bought.')),
            ui.field(t('Duration (hours)'), hours, t('0 for a one-off bonus.'))),
          item.price ? h('label', { class: 'check' }, pay, t('Take {n} points off this player', { n: item.price })) : null,
          ui.field(t('Note'), note)));
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var p = chosen && store.player(chosen); if (!p) return ui.toast(t('Choose the player.'), 'error');
            var s = starts.value ? parisInput(starts.value) : new Date(), hrs = Math.max(0, parseFloat(hours.value) || 0);
            var row = { player_id: p.id, name: item.name, price: item.price || 0, bought_at: (bought.value ? parisInput(bought.value) : new Date()).toISOString(),
              starts_at: s.toISOString(), ends_at: hrs ? new Date(+s + hrs * 3600e3).toISOString() : null, note: note.value.trim() };
            var jobs = [store.insert('bonuses', row)];
            if (pay.checked && item.price) jobs.push(store.update('players', p.id, { points: Math.max(0, (p.points || 0) - item.price) }));
            store.log(t('{name} bought {bonus}', { name: p.name, bonus: item.name }) + (row.ends_at ? ' (' + ui.whenShort(row.starts_at) + ' → ' + ui.whenShort(row.ends_at) + ')' : ''), { type: 'bonus', player_id: p.id, bonus: item.name, starts_at: row.starts_at, ends_at: row.ends_at, note: row.note });
            Promise.all(jobs).then(function () { api.close(); ui.toast(t('Purchase recorded.')); });
          } }, t('Record'))));
      }
    });
  };
  /* Remove a recorded purchase (a mistake), giving the points back if they were taken. */
  act.removeBonus = function (b) {
    if (!store.canEdit()) return;
    var p = store.player(b.player_id);
    ui.dialog({ title: t('Remove this purchase?'), render: function (body, api) {
      var refund = h('input', { type: 'checkbox', checked: !!b.price });
      body.appendChild(h('p', { class: 'prose' }, t('{bonus} bought by {name}.', { bonus: b.name, name: p ? p.name : '?' })));
      if (b.price && p) body.appendChild(h('label', { class: 'check' }, refund, t('Give the {n} points back', { n: b.price })));
      body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          store.remove('bonuses', b.id);
          if (refund.checked && b.price && p) store.update('players', p.id, { points: (p.points || 0) + b.price });
          store.log(t('Purchase removed: {bonus} of {name}', { bonus: b.name, name: p ? p.name : '?' }));
          api.close();
        } }, t('Remove'))));
    } });
  };

  /* The killer of a kill is set or changed: the points of the kill move from the former killer to the new one, and
     in the current loop the victim's weapons pass to the new killer (the former one gets theirs back). */
  act.editKill = function (kill) {
    ui.pickPlayer({ title: t('Who killed {name}?', { name: name(kill.victim_id) }), filter: function (p) { return p.id !== kill.victim_id; }, extra: [{ label: t('Unknown killer'), value: null }] })
      .then(function (v) {
        if (v === undefined || (v === kill.killer_id && !kill.admin_reason)) return;
        var pts = kill.admin_reason ? 0 : kill.points || 0, victim = store.player(kill.victim_id), current = kill.round_id === act.currentRoundId();
        var old = kill.killer_id && store.player(kill.killer_id), neu = v && store.player(v), patches = new Map(), killPatch = { killer_id: v, admin_reason: null };
        function add(p, x) { patches.set(p.id, Object.assign(patches.get(p.id) || {}, x)); }
        var same = function (a, b) { return L.weaponList(a).map(L.norm).sort().join() === L.weaponList(b).map(L.norm).sort().join(); };
        if (old) {
          if (pts) add(old, { points: Math.max(0, (old.points || 0) - pts) });
          if (kill.killer_weapons != null && victim && same(old.weapons, victim.weapons)) add(old, { weapons: kill.killer_weapons });   // gets theirs back
          killPatch.killer_weapons = null;
        }
        if (neu) {
          if (pts) add(neu, { points: (neu.points || 0) + pts });
          if (current && victim && L.weaponList(victim.weapons).length) { killPatch.killer_weapons = neu.weapons || ''; add(neu, { weapons: victim.weapons }); }
        }
        var jobs = [store.update('kills', kill.id, killPatch)];
        patches.forEach(function (x, id) { jobs.push(store.update('players', id, x)); });
        // the chain: the kill proves the new killer was hunting the victim, so they take over the victim's target;
        // the former killer's link to the victim goes
        var roundId = kill.round_id || act.currentRoundId();
        if (old && roundId) store.state.links.filter(function (l) { return l.round_id === roundId && l.hunter_id === old.id && l.target_id === kill.victim_id; }).forEach(function (l) { jobs.push(store.remove('links', l.id)); });
        if (neu && roundId && !store.state.links.some(function (l) { return l.round_id === roundId && l.hunter_id === neu.id && l.target_id === kill.victim_id; }))
          jobs.push(Promise.all(jobs).then(function () { return act.setTarget(neu.id, kill.victim_id, { roundId: roundId, confidence: 'sur', source: t('kill'), silent: true }); }));
        store.log(neu ? t('{a} is the killer of {b}', { a: neu.name, b: name(kill.victim_id) }) + (pts ? ' (' + K.n(pts, '{n} pt', '{n} pts') + ')' : '') : t('Killer of {name} unknown again', { name: name(kill.victim_id) }));
        return Promise.all(jobs).then(function () { if (neu && pts) ui.toast(t('{name} gets the {n} points of this kill.', { name: neu.name, n: pts })); });
      });
  };
  act.killAttribution = function (kill) {
    if (kill.admin_reason) return t('Administrative elimination: {reason}', { reason: t(kill.admin_reason === 'cheating' ? 'Cheating' : 'Other') });
    return kill.killer_id ? t('Killed by {name}', { name: name(kill.killer_id) }) : t('Killed by an unknown player');
  };
  act.killSummary = function (k) {
    return [k.admin_reason ? t('Administrative elimination: {reason}', { reason: t(k.admin_reason === 'cheating' ? 'Cheating' : 'Other') }) : null,
      k.weapon ? t('Weapon: {w}', { w: k.weapon }) : null, killPointsText(k), k.note ? t('Note: {n}', { n: k.note }) : t('No note'), ui.ago(k.happened_at)].filter(Boolean).join('. ') + '.';
  };
  function killPointsText(k) {
    return k.weapon_level === 'inconnue' && k.killer_id ? t('{a} or {b} pts (difficulty unknown)', { a: k.points || 0, b: (k.points || 0) + L.levelGap(L.scoring(store.state)) }) : K.n(k.points || 0, '{n} pt', '{n} pts');
  }
  /* --------------------------------------------- weapons of unknown difficulty */
  /* The kills made with a weapon while its difficulty was unknown get their points: the hard ones give the gap to their killer. */
  function applySettle(list, what) {
    var jobs = [], gain = new Map();
    list.forEach(function (s) { jobs.push(store.update('kills', s.kill.id, s.patch)); if (s.delta) gain.set(s.killerId, (gain.get(s.killerId) || 0) + s.delta); });
    gain.forEach(function (d, id) { var p = store.player(id); if (p) jobs.push(store.update('players', id, { points: (p.points || 0) + d })); });
    if (list.length) {
      store.log(t('{what}: {n} kills settled', { what: what, n: list.length }), { type: 'settle', kills: list.map(function (s) { return s.kill.id; }) });
      gain.forEach(function (d, id) { ui.toast(t('{name} gets {n} more points.', { name: name(id), n: d })); });
    }
    return Promise.all(jobs).then(function () { return list.length; });
  }
  /* The difficulty of a weapon becomes known (or changes): catalogue, then the kills made with it while it was unknown. */
  act.setWeaponDifficulty = function (weapon, difficulty) {
    var key = L.norm(weapon), cat = store.state.weapons.find(function (x) { return L.norm(x.name) === key; });
    var first = cat ? (cat.difficulty !== difficulty ? store.update('weapons', cat.id, { difficulty: difficulty }) : Promise.resolve()) : store.insert('weapons', { name: weapon, difficulty: difficulty });
    return first.then(function () { return act.applyWeaponDifficulty(weapon, difficulty); });
  };
  /* After the catalogue: the kills made with the weapon while unknown get their points; those recorded with the other
     difficulty are recomputed if the person agrees (otherwise only the next kills use the new one). */
  act.applyWeaponDifficulty = function (weapon, difficulty) {
    return act.settleWeapon(weapon, difficulty).then(function () {
      var list = L.reclassWeapon(store.state, weapon, difficulty);
      if (!list.length) return 0;
      var killers = new Set(list.filter(function (x) { return x.delta; }).map(function (x) { return x.killerId; }));
      var level = difficulty === 'difficile' ? t('hard') : t('easy'), old = difficulty === 'difficile' ? t('easy') : t('hard');
      return ui.confirm({ title: t('Recompute the kills made with {w}?', { w: weapon }),
        text: [K.n(list.length, '{n} kill made with it was recorded as {old}: it becomes {level}.', '{n} kills made with it were recorded as {old}: they become {level}.').replace('{old}', old).replace('{level}', level),
          killers.size ? K.n(killers.size, 'The killer gains or loses the difference ({n} player).', 'Their killers gain or lose the difference ({n} players).') : t('No killer is known for them yet: nobody gains or loses points.')],
        action: t('Recompute them'), cancel: t('Only the next kills') }).then(function (ok) {
        return ok ? applySettle(list, t('{w} is {level}', { w: weapon, level: level })) : 0;
      });
    });
  };
  act.settleWeapon = function (weapon, difficulty) {
    var label = difficulty === 'difficile' ? t('hard') : t('easy');
    return applySettle(L.settleWeapon(store.state, weapon, difficulty), t('{w} is {level}', { w: weapon, level: label }));
  };
  /* A kill without a weapon name: its own difficulty only */
  act.settleKill = function (kill, difficulty) {
    if (kill.weapon) return act.setWeaponDifficulty(kill.weapon, difficulty);
    return applySettle(L.settleKills([kill], difficulty, L.scoring(store.state)), t('Kill of {name}', { name: name(kill.victim_id) }));
  };
  /* A new scoring from Settings: the kills recorded with their parts get their new points, and their killers the
     difference. Kills recorded before keep theirs. */
  act.saveScoring = function (sc) {
    if (!store.isAdmin()) return Promise.resolve(false);
    var plan = L.rescoreKills(store.state, sc), gain = new Map();
    plan.changes.forEach(function (c) { if (c.killerId) gain.set(c.killerId, (gain.get(c.killerId) || 0) + c.delta); });   // a kill without killer: its points wait for them
    var text = [plan.changes.length ? K.n(plan.changes.length, '{n} kill gets new points', '{n} kills get new points') + ', ' + K.n(gain.size, 'the points of {n} player change.', 'the points of {n} players change.') : t('No recorded kill changes points.')];
    if (plan.kept) text.push(K.n(plan.kept, '{n} kill recorded before the computed scoring keeps its points.', '{n} kills recorded before the computed scoring keep their points.'));
    return ui.confirm({ title: t('Apply the new scoring?'), text: text, action: t('Apply') }).then(function (ok) {
      if (!ok) return false;
      var jobs = [store.setSetting('scoring', sc)];
      plan.changes.forEach(function (c) { jobs.push(store.update('kills', c.kill.id, c.patch)); });
      gain.forEach(function (d, id) { var p = store.player(id); if (p && d) jobs.push(store.update('players', id, { points: Math.max(0, (p.points || 0) + d) })); });
      store.log(t('Scoring changed: {n} kills recomputed', { n: plan.changes.length }), { type: 'scoring', scoring: sc });
      return Promise.all(jobs).then(function () { ui.toast(t('Scoring saved.')); return true; });
    });
  };
  /* What a kill is made of: "Hard weapon · video +2 · first blood · 2 teammates" */
  function killParts(k) {
    if (k.admin_reason || !k.killer_id || k.first_blood == null) return null;
    return [k.weapon_level === 'difficile' ? t('Hard weapon') : k.weapon_level === 'inconnue' ? t('Weapon of unknown difficulty') : t('Easy weapon'),
      k.bonus ? t('bonus +{n}', { n: k.bonus }) : null, k.first_blood ? t('First blood') : null, k.mates ? K.n(k.mates, '{n} teammate', '{n} teammates') : null].filter(Boolean).join(' · ');
  }
  act.killDetails = function (killId) {
    var k = store.state.kills.find(function (x) { return x.id === killId; });
    if (!k) return ui.toast(t('This kill has since been undone.'), 'error');
    ui.dialog({
      title: t('Kill details'),
      render: function (body, api) {
        var killer = k.killer_id && store.player(k.killer_id), victim = store.player(k.victim_id), round = store.state.rounds.find(function (r) { return r.id === k.round_id; });
        var weapon = h('input', { type: 'text', value: k.weapon || '' }), note = h('textarea', { rows: '3', value: k.note || '', placeholder: t('Place, circumstances, who was there…') });
        function who(label, p, emptyLabel) { return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label), p ? h('button', { type: 'button', class: 'row row-btn', onclick: function () { api.close(); act.openPlayer(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name)) : h('p', { class: 'muted' }, emptyLabel || t('Unknown'))); }
        body.appendChild(h('div', { class: 'relations' }, who(t('Killer'), killer, k.admin_reason ? t('Administration') : null), who(t('Victim'), victim)));
        body.appendChild(h('dl', { class: 'facts' },
          h('div', {}, h('dt', {}, t('When')), h('dd', {}, ui.when(k.happened_at))),
          h('div', {}, h('dt', {}, t('Round')), h('dd', {}, round ? round.name : t('Unknown'))),
          k.admin_reason ? h('div', {}, h('dt', {}, t('Reason')), h('dd', {}, t(k.admin_reason === 'cheating' ? 'Cheating' : 'Other'))) : null,
          h('div', {}, h('dt', {}, t('Points')), h('dd', {}, killPointsText(k), killParts(k) ? h('span', { class: 'muted small kill-parts' }, killParts(k)) : null))));
        if (k.weapon_level === 'inconnue' && k.killer_id && store.canEdit()) {
          body.appendChild(h('div', { class: 'settle' }, h('p', { class: 'muted small' }, k.weapon ? t('Once you know the difficulty of {w}, every kill made with it gets its points.', { w: k.weapon }) : t('Once you know the difficulty of the weapon, the killer gets their points.')),
            h('div', { class: 'actions actions-start' }, [['facile', t('It was easy')], ['difficile', t('It was hard')]].map(function (o) {
              return h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); act.settleKill(k, o[0]); } }, o[1]);
            }))));
        }
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
        var held = L.heldWeapons(store.state), holders = Object.keys(held).length;
        var clear = h('input', { type: 'checkbox', checked: true });
        if (n && holders) body.appendChild(h('label', { class: 'check' }, clear, K.n(holders, 'Take the weapons off the {n} player who has some (everything is mixed); they stay in the history of the sheet.', 'Take the weapons off the {n} players who have some (everything is mixed); they stay in the history of each sheet.')));
        body.appendChild(h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var label = input.value.trim() || t('Reroll {n}', { n: n });
            if (n && holders && clear.checked) {   // the weapons of the ending round are kept on it, the sheets start empty
              store.update('rounds', rounds[n - 1].id, { held_weapons: held });
              Object.keys(held).forEach(function (id) { store.update('players', id, { weapons: '' }); });
            }
            store.insert('rounds', { name: label, position: n ? rounds[n - 1].position + 1 : 0 });
            store.log(t('New round: {name}', { name: label }) + (n && holders && clear.checked ? ' (' + K.n(holders, 'weapons taken off {n} player', 'weapons taken off {n} players') + ')' : ''));
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
      var jobs = plan.kills.map(function (k) { return store.remove('kills', k.id); });
      plan.patches.forEach(function (x) { jobs.push(store.update('players', x.id, x.patch)); });
      if (plan.restoreHeld) jobs.push(store.update('rounds', plan.prev.id, { held_weapons: null }));   // back in play: no longer history
      return Promise.all(jobs).then(function () { return store.remove('rounds', roundId); }).then(function () {
        store.log(t('Round deleted: {name}', { name: plan.round.name }) + (dead ? ' (' + K.n(dead, '{n} kill undone', '{n} kills undone') + ')' : ''));
        ui.toast(t('Round deleted: back to where the game was before it.'));
        return true;
      });
    });
  };

  /* ------------------------------------------------------- player sheet */
  act.openPlayer = function (playerId, ctx) {
    ctx = ctx || {};
    var off = null, intelAll = false;
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
        var mysteryOption = edit && isCurrent && !other ? [{ value: '__mystery', label: t('Someone unknown, with clues…') }] : [];
        var select = ui.select([{ value: '', label: dir === 'target' ? t('Unknown target') : t('Unknown killer') }].concat(mysteryOption, free.map(function (x) { return { value: x.id, label: x.name + (x.is_mystery ? ' (' + t('mystery') + ')' : '') }; })), other ? other.id : '', {
          'aria-label': label, disabled: !isCurrent || !edit, onchange: function (e) {
            var id = e.target.value;
            if (id === '__mystery') { e.target.value = ''; act.newMystery(p.id, dir, roundId); return; }
            if (!id) { var cut = dir === 'target' ? (other && maps.hunterOf.get(other.id)) : maps.hunterOf.get(p.id); if (cut) store.remove('links', cut.id); return; }
            if (dir === 'target') act.setTarget(p.id, id, { roundId: roundId, confidence: 'sur', noConfirm: true });
            else act.setTarget(id, p.id, { roundId: roundId, confidence: 'sur', noConfirm: true });
          } });
        return h('div', { class: 'relation' }, h('span', { class: 'relation-label' }, label),
          h('div', { class: 'relation-pick' }, other ? ui.avatar(other, 'sm') : h('span', { class: 'avatar avatar-sm avatar-empty', 'aria-hidden': 'true' }, '?'), select),
          other ? h('div', { class: 'relation-meta' },
            h('button', { type: 'button', class: 'tag tag-conf tag-' + res.confidence, title: act.edgeTitle(res.links, res.confidence), onclick: function () { act.editEdge(res.links, dir === 'target' ? { hunterId: p.id, targetId: other.id, anchorId: p.id } : { hunterId: other.id, targetId: p.id, anchorId: p.id }); } }, ui.confLabel(res.confidence)),
            h('button', { type: 'button', class: 'linkish small', onclick: function () { api.close(); act.openPlayer(other.id, ctx); } }, t('Open sheet')))
            : res && res.via.length ? h('p', { class: 'muted small' }, t('Trail lost after {name} (dead).', { name: name(res.via[res.via.length - 1]) })) : null);
      }

      var file = h('input', { type: 'file', accept: 'image/*,.gif', hidden: true, onchange: function () { var f = file.files[0]; file.value = ''; if (f) ui.pickPhoto(f).then(function (c) { if (c) store.setPhoto(p.id, c); }); } });
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
            var picker = h('input', { type: 'file', accept: 'image/*,.gif', hidden: true, onchange: function () { var f = picker.files[0]; picker.value = ''; if (f) ui.pickPhoto(f).then(function (c) { if (c) store.setPhoto(current.id, c); }); } });
            photoBody.appendChild(picker);
            var actions = h('div', { class: 'photo-viewer-actions' },
              h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { picker.click(); } }, t('Change photo')));
            var gif = /\.gif$|^data:image\/gif/i.test(current.photo_path || '');   // an animated GIF would stop moving
            if (url && !gif) actions.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { ui.cropImage(url).then(function (c) { if (c) store.setPhoto(current.id, c); }); } }, t('Crop')));
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
            p.is_mystery ? h('span', { class: 'tag tag-mystery' }, t('Mystery player')) : null,
            p.is_ally ? h('span', { class: 'tag tag-ally' }, t('Alliance')) : null, ui.statusTag(p), h('span', { class: 'tag tag-points', title: L.pendingKills(store.state, p.id).length ? t('Kills with a weapon of unknown difficulty: settled once it is known.') : null }, ui.pointsText(p))))));

      if (p.is_mystery) body.appendChild(mysteryBox(p, roundId, edit, api));
      var bonusTags = ui.bonusTags(p);
      if (bonusTags) body.appendChild(h('div', { class: 'sheet-bonuses' }, h('span', { class: 'relation-label' }, t('Bonuses')), bonusTags));
      if (dead && kill) {
        body.appendChild(h('button', { type: 'button', class: 'death', title: act.killSummary(kill), onclick: function () { act.killDetails(kill.id); } }, h('span', { class: 'stamp', 'aria-hidden': 'true' }, t('Eliminated')),
          h('span', {}, act.killAttribution(kill) + (kill.weapon ? ' ' + t('with "{w}"', { w: kill.weapon }) : '') + ', ' + ui.ago(kill.happened_at) + '.')));
      } else {
        body.appendChild(roundId ? h('div', { class: 'relations' }, person(t('Killer'), hunter, 'hunter'), person(t('Target'), target, 'target'))
          : h('p', { class: 'muted' }, t('Start the loop from the Chain tab to record targets and killers.')));
        body.appendChild(h('div', { class: 'sched-block' }, h('span', { class: 'relation-label' }, t('Timetable')), ui.schedule(p)));
      }

      var weapons = L.weaponList(p.weapons);
      if (weapons.length) body.appendChild(h('div', { class: 'tags' }, weapons.map(function (w) { return ui.weaponTag(w); })));
      var past = L.pastWeapons(st, p.id);   // what they held before a reroll emptied the sheet
      if (past.length) body.appendChild(h('div', { class: 'past-weapons' }, h('span', { class: 'relation-label' }, t('Weapons in previous loops')),
        past.map(function (x) { return h('p', { class: 'small' }, h('span', { class: 'muted' }, x.round.name + ' : '), h('span', { class: 'tags' }, x.weapons.map(function (w) { return ui.weaponTag(w, true); }))); })));
      if (p.address) body.appendChild(h('p', { class: 'prose' }, h('span', { class: 'muted' }, t('Address: ')), p.address,
        L.addressType(p.address_type) !== 'normale' ? ' (' + t(L.ADDRESS_TYPES.find(function (x) { return x.id === L.addressType(p.address_type); }).label).toLowerCase() + ')' : '',
        L.hasCoords(p) ? [' ', h('a', { class: 'linkish', href: '#/map?player=' + p.id, onclick: function () { api.close(); } }, t('Show on map'))] : null));
      var home = p.home_id && (st.homes || []).find(function (x) { return x.id === p.home_id; });
      if (home) {
        var hm = L.homeMembers(st, home.id), isRes = L.homeKind(home) === 'residence';
        body.appendChild(h('p', { class: 'prose' }, h('span', { class: 'muted' }, (isRes ? t('Residence:') : t('Shared flat:')) + ' '),
          h('button', { type: 'button', class: 'linkish', onclick: function () { act.editHome(home); } }, home.name), home.building ? ' (' + home.building + ')' : '',
          isRes && p.apartment ? ' · ' + t('apt. {n}', { n: p.apartment }) : '',
          h('span', { class: 'muted' }, ' · ' + t('{a}/{b} alive', { a: hm.alive.length, b: hm.members.length }))));
      }
      if (p.notes) body.appendChild(h('p', { class: 'prose notes' }, p.notes));

      /* intel feed: what was seen or heard, when, where, by whom */
      var intel = L.intelOf(st, p.id), feed = h('section', { class: 'intel' }, h('div', { class: 'intel-head' }, h('span', { class: 'relation-label' }, t('Intel feed')),
        edit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: function () { act.intelDialog(p.id); } }, K.icon('plus', 'ic-sm'), t('Add an info')) : null));
      if (!intel.length) feed.appendChild(h('p', { class: 'muted small' }, t('Nothing yet: note here what you see or hear about them, with the time and the place.')));
      intel.slice(0, intelAll ? intel.length : 4).forEach(function (x) { feed.appendChild(intelItem(x, edit, function () { api.close(); })); });
      if (intel.length > 4) feed.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { intelAll = !intelAll; draw(body, api); } }, intelAll ? t('Show less') : t('Show all ({n})', { n: intel.length })));
      body.appendChild(feed);

      var mine = st.kills.filter(function (k) { return k.killer_id === p.id; });
      if (mine.length) body.appendChild(h('div', { class: 'victims' }, h('span', { class: 'muted' }, K.n(mine.length, '{n} kill', '{n} kills')),
        mine.map(function (k) { return h('button', { type: 'button', class: 'tag tag-victim', title: act.killSummary(k), onclick: function () { act.killDetails(k.id); } }, name(k.victim_id), k.note ? h('span', { class: 'has-note', 'aria-label': t('with a note') }, '✎') : null); })));

      var A = h('div', { class: 'action-grid' });
      function add(label, fn, cls) { A.appendChild(h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: fn }, label)); }
      if (edit) {
        if (!dead && isCurrent) add(t('Mark as dead'), function () { api.close(); act.killDialog(p.id); }, 'btn-danger');
        if (dead && kill) { add(kill.killer_id ? t('Change killer') : t('Set killer'), function () { act.editKill(kill); }); add(t('Undo the kill'), function () { act.revive(p.id); }); }
        add(t('Edit sheet'), function () { act.editPlayer(p.id); });
      }
      add([K.icon('share'), t('Share')], function () { act.shareSheet(p.id); });
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
        /* Difficulty of each weapon typed in the sheet. It belongs to the catalogue: a weapon already there can be
           switched easy/hard (for everyone), an unknown one can be added or left as "don't know". */
        /* A player holds at most one easy and one hard weapon. */
        var levels = {}, levelsBox = h('div', { class: 'weapon-levels' });
        function levelOf(w) { var k = L.norm(w); return k in levels ? levels[k].value : ui.weaponDifficulty(w) || ''; }
        function holderOf(level, names, except) { return level ? names.find(function (n) { return L.norm(n) !== L.norm(except || '') && levelOf(n) === level; }) : null; }
        function weaponRule(name, names) {   // why this weapon cannot be added, or null
          if (names.length >= 2) return t('Two weapons at most: one easy and one hard.');
          var d = ui.weaponDifficulty(name), other = holderOf(d, names);
          return other ? t(d === 'difficile' ? 'Already a hard weapon: {w}' : 'Already an easy weapon: {w}', { w: other }) : null;
        }
        function levelsError(names) {
          if (names.length > 2) return t('Two weapons at most: one easy and one hard.');
          var e = names.filter(function (n) { return levelOf(n) === 'facile'; }).length, d = names.filter(function (n) { return levelOf(n) === 'difficile'; }).length;
          return e > 1 ? t('Only one easy weapon per player.') : d > 1 ? t('Only one hard weapon per player.') : null;
        }
        function drawLevels(focusLabel) {
          ui.clear(levelsBox);
          var names = f.weapons.names();
          if (!names.length) return;
          levelsBox.appendChild(h('span', { class: 'field-label' }, t('Difficulty of each weapon')));
          names.forEach(function (w) {
            var key = L.norm(w), known = ui.weaponDifficulty(w);
            if (!(key in levels)) levels[key] = { value: known || '' };
            var opts = ui.levelOptions(false).map(function (o) {
              var other = holderOf(o.value, names, w);   // a difficulty already taken by the other weapon cannot be picked
              return other ? { value: o.value, label: o.label + ' — ' + t('taken by {w}', { w: other }), disabled: levels[key].value !== o.value } : o;
            });
            if (!known) opts.push({ value: '', label: t("Don't know") });
            var label = t('Difficulty of {w}', { w: w });
            levelsBox.appendChild(h('div', { class: 'weapon-level' }, h('span', { class: 'tag tag-weapon tag-' + (levels[key].value || 'none') }, K.icon('weapons', 'ic-sm'), w),
              ui.select(opts, levels[key].value, { 'aria-label': label, onchange: function (e) { levels[key].value = e.target.value; drawLevels(label); } })));
          });
          var err = levelsError(names);
          if (err) levelsBox.appendChild(h('p', { class: 'field-hint danger', role: 'alert' }, err));
          if (names.some(function (w) { return ui.weaponDifficulty(w); })) levelsBox.appendChild(h('span', { class: 'field-hint' }, t('Weapons already in the catalogue: changing their difficulty changes it for everyone.')));
          if (focusLabel) Array.prototype.forEach.call(levelsBox.querySelectorAll('select'), function (el) { if (el.getAttribute('aria-label') === focusLabel) el.focus(); });
        }
        function saveLevels(names) {
          var done = {};
          names.forEach(function (w) {
            var key = L.norm(w), lv = levels[key]; if (!lv || done[key]) return; done[key] = true;
            var cat = store.state.weapons.find(function (x) { return L.norm(x.name) === key; });
            if (cat && lv.value && lv.value !== cat.difficulty) act.setWeaponDifficulty(cat.name, lv.value);
            else if (!cat) store.insert('weapons', { name: w, difficulty: lv.value || 'inconnue' });   // "don't know": in the catalogue all the same
          });
        }
        /* a shared flat or a residence to pick, following the housing type */
        function homeSelect(kind) {
          var list = (store.state.homes || []).filter(function (x) { return L.homeKind(x) === kind; }).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); });
          var mine = list.some(function (x) { return x.id === p.home_id; }) ? p.home_id : '';
          return ui.select([{ value: '', label: t('None') }].concat(list.map(function (x) { return { value: x.id, label: x.name + (x.address ? ' · ' + x.address : '') }; })), mine);
        }
        var homeSel = { coloc: homeSelect('coloc'), residence: homeSelect('residence') }, homeBox = {};
        function showHome() {
          var type = f.address_type.value;
          homeBox.coloc.hidden = type !== 'coloc'; homeBox.residence.hidden = type !== 'residence';
        }
        var f = {
          name: h('input', { type: 'text', value: p.name || '', placeholder: t('LASTNAME Firstname'), required: true }),
          year: ui.select([{ value: '', label: '—' }].concat((s.years || []).map(function (y) { return y.name; })), p.year || ''),
          dept: ui.select([{ value: '', label: '—' }].concat(s.depts || []), p.dept || ''),
          td: h('input', { type: 'text', value: p.td || '', placeholder: 'TD1' }), tp: h('input', { type: 'text', value: p.tp || '', placeholder: 'TP1' }),
          option: h('input', { type: 'text', value: p.option || '' }), lang_group: h('input', { type: 'text', value: p.lang_group || '', placeholder: 'G2' }),
          weapons: ui.weaponPicker(p.weapons || '', { onChange: function () { drawLevels(); }, check: weaponRule, max: 2 }),
          points: h('input', { type: 'number', min: '0', inputmode: 'numeric', value: String(p.points || 0) }),
          is_ally: h('input', { type: 'checkbox', checked: !!p.is_ally }),
          status: ui.select([{ value: '', label: t('None') }].concat(ui.STATUSES.map(function (x) { return { value: x.id, label: t(x.label) }; })), p.status || ''),
          address: h('input', { type: 'text', value: p.address || '', placeholder: t('e.g. 12 High Street, Town'), autocomplete: 'off', oninput: function () { if (!typeTouched && !p.address) { f.address_type.value = L.guessAddressType(f.address.value); showHome(); } } }),
          address_type: ui.select(L.ADDRESS_TYPES.slice().reverse().map(function (x) { return { value: x.id, label: t(x.label) }; }), L.addressType(p.address_type), { onchange: function () { typeTouched = true; showHome(); } }),
          apartment: h('input', { type: 'text', value: p.apartment || '', placeholder: t('e.g. 214'), autocomplete: 'off' }),
          notes: h('textarea', { rows: '3', value: p.notes || '', placeholder: t('Habits on campus, clubs, who could save them…') })
        };
        homeBox.coloc = h('div', { class: 'stack-tight' }, (store.state.homes || []).some(function (x) { return L.homeKind(x) === 'coloc'; })
          ? ui.field(t('Shared flat'), homeSel.coloc, t('The address of the flat replaces the one above.'))
          : h('p', { class: 'field-hint' }, t('Shared flats are created from the Map tab.')));
        homeBox.residence = h('div', { class: 'grid-2 grid-align-start' },
          (store.state.homes || []).some(function (x) { return L.homeKind(x) === 'residence'; })
            ? ui.field(t('Residence'), homeSel.residence, t('Its address replaces the one above.'))
            : h('p', { class: 'field-hint' }, t('Residences are created from the Map tab.')),
          ui.field(t('Apartment'), f.apartment, t('Optional')));
        body.appendChild(h('div', { class: 'stack' },
          ui.field(t('Name'), f.name),
          h('div', { class: 'grid-2' }, ui.field(t('Year'), f.year), ui.field(t('Department'), f.dept)),
          h('div', { class: 'grid-2' }, ui.field('TD', f.td), ui.field('TP', f.tp)),
          h('p', { class: 'field-hint' }, t('As on the timetable. Several groups: separate them with commas (e.g. TD 2, TD 1 MRI).')),
          h('div', { class: 'grid-2' }, ui.field(t('Option'), f.option), ui.field(t('Language group'), f.lang_group)),
          h('div', { class: 'grid-2 grid-align-start' },
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('Weapons in hand')), f.weapons.el, h('span', { class: 'field-hint' }, t('Pick from the catalogue; a new weapon is added only if it is not there.'))),   // not a <label>: it holds buttons
            ui.field(t('Points'), f.points)),
          levelsBox,
          h('div', { class: 'grid-2 grid-align-start' }, h('label', { class: 'check' }, f.is_ally, t('Alliance member')), ui.field(t('Special status'), f.status)),
          ui.field(t('Address'), f.address, t('Include the town so the marker lands in the right place.')),
          ui.field(t('Housing type'), f.address_type, t('Sets the icon and the layer on the map.')),
          homeBox.coloc, homeBox.residence, ui.field(t('Notes'), f.notes)));
        showHome();
        drawLevels();
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
          var pick = homeSel[row.address_type];   // only a flat when "shared flat", only a residence when "residence"
          row.home_id = (pick && pick.value) || null;
          if (row.address_type !== 'residence') row.apartment = '';
          var flat = row.home_id && store.state.homes.find(function (x) { return x.id === row.home_id; });
          if (flat) Object.assign(row, homePatch(flat));   // the flat's (or residence's) address, position and type
          var weaponError = levelsError(L.weaponList(row.weapons));
          if (weaponError) return ui.toast(weaponError, 'error');
          saveLevels(L.weaponList(row.weapons));
          var moved = !flat && (p.address || '') !== row.address;   // a flat brings its own position
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

  /* ------------------------------------------------------------ intel feed */
  function intelItem(x, edit, leave) {
    return h('div', { class: 'intel-item' }, h('p', { class: 'intel-text' }, x.text),
      h('p', { class: 'muted small intel-meta' }, [x.place ? t('at {place}', { place: x.place }) : null, ui.ago(x.seen_at), x.author ? t('by {name}', { name: x.author }) : null].filter(Boolean).join(' · '),
        L.hasCoords(x) ? [' · ', h('a', { class: 'linkish', href: '#/map?seen=' + x.id, onclick: leave }, t('On the map'))] : null,
        edit ? [' · ', h('button', { type: 'button', class: 'linkish', onclick: function () {
          ui.confirm({ title: t('Delete this info?'), text: x.text, action: t('Delete'), danger: true }).then(function (ok) { if (ok) store.remove('intel', x.id); });
        } }, t('Delete'))] : null));
  }
  act.intelDialog = function (playerId) {
    var p = store.player(playerId); if (!p || !store.canEdit()) return;
    var spots = store.state.spots.filter(L.hasCoords).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); });
    ui.dialog({ title: t('Info on {name}', { name: p.name }), render: function (body, api) {
      var text = h('textarea', { rows: '3', placeholder: t('e.g. seen at the library with a cushion, leaves the gym every Tuesday at 6 pm…') });
      var where = ui.select([{ value: '', label: t('No place on the map') }, { value: 'here', label: t('Where I am now') }].concat(spots.map(function (s) { return { value: 'spot:' + s.id, label: s.name }; })), '');
      var place = h('input', { type: 'text', placeholder: t('e.g. library, 2nd floor') });
      var when = h('input', { type: 'datetime-local', value: localIso(new Date()) });
      body.appendChild(h('div', { class: 'stack' }, ui.field(t('What you saw or heard'), text),
        h('div', { class: 'grid-2' }, ui.field(t('Location'), place), ui.field(t('On the map'), where, t('A strategic spot, or your position (asks for location).'))),
        h('div', { class: 'grid-2' }, ui.field(t('When'), when))));
      body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var row = { player_id: p.id, text: text.value.trim(), place: place.value.trim(), lat: null, lng: null, seen_at: when.value ? parisInput(when.value).toISOString() : new Date().toISOString(), author: store.displayName() || '' };
          if (!row.text) { text.focus(); return ui.toast(t('Write what you saw or heard.'), 'error'); }
          var spot = where.value.indexOf('spot:') === 0 && spots.find(function (s) { return 'spot:' + s.id === where.value; });
          var pos = Promise.resolve(null);
          if (spot) { row.lat = spot.lat; row.lng = spot.lng; if (!row.place) row.place = spot.name; }
          else if (where.value === 'here') pos = new Promise(function (ok) {
            if (!navigator.geolocation) return ok(null);
            navigator.geolocation.getCurrentPosition(function (g) { ok({ lat: g.coords.latitude, lng: g.coords.longitude }); }, function () { ok(null); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
          });
          api.close();
          pos.then(function (g) {
            if (g) { row.lat = g.lat; row.lng = g.lng; } else if (where.value === 'here') ui.toast(t('Position unavailable: the info is saved without it.'), 'error');
            return store.insert('intel', row);
          }).then(function () { store.log(t('Info on {name}: {text}', { name: p.name, text: row.text })); ui.toast(t('Info added.')); });
        } }, t('Add the info'))));
    } });
  };

  /* --------------------------------------------------------- mystery players */
  /* "Their killer is a 2A in MRI": a sheet with what we know, put in the chain at once. Once we know who it is,
     it is merged into the real sheet (links, kills, bonuses, intel and clues follow). */
  act.newMystery = function (playerId, dir, roundId) {
    var p = store.player(playerId); if (!p || !store.canEdit()) return;
    var st = store.state, s = st.settings, title = dir === 'hunter' ? t('Unknown killer of {name}', { name: p.name }) : t('Unknown target of {name}', { name: p.name });
    ui.dialog({ title: title, render: function (body, api) {
      var f = {
        year: ui.select([{ value: '', label: t('Unknown') }].concat((s.years || []).map(function (y) { return y.name; })), '', { onchange: count }),
        dept: ui.select([{ value: '', label: t('Unknown') }].concat(s.depts || []), '', { onchange: count }),
        td: h('input', { type: 'text', placeholder: 'TD1', oninput: count }), tp: h('input', { type: 'text', placeholder: 'TP1', oninput: count }),
        option: h('input', { type: 'text', oninput: count }), lang_group: h('input', { type: 'text', placeholder: 'G2', oninput: count }),
        notes: h('textarea', { rows: '2', placeholder: t('Where it comes from, anything else we know…') })
      };
      var matches = h('p', { class: 'muted small', role: 'status' });
      function clues() { var row = {}; L.MYSTERY_CLUES.forEach(function (k) { row[k] = f[k].value.trim(); }); return row; }
      function count() {   // as if the sheet were already in the chain
        var tmp = Object.assign({ id: '__new', name: title, is_mystery: true }, clues());
        var link = { id: '__link', round_id: roundId, hunter_id: dir === 'hunter' ? tmp.id : p.id, target_id: dir === 'hunter' ? p.id : tmp.id, confidence: 'sur', source: '', created_at: new Date().toISOString() };
        var n = L.mysteryCandidates(Object.assign({}, st, { players: st.players.concat([tmp]), links: st.links.concat(roundId ? [link] : []) }), tmp, roundId).length;
        matches.textContent = n ? K.n(n, '{n} player matches these clues.', '{n} players match these clues.') : t('Nobody matches these clues.');
      }
      body.appendChild(h('p', { class: 'muted small' }, t('Fill in what you know; leave the rest empty. The sheet takes its place in the chain, and you say who it is once you know.')));
      body.appendChild(h('div', { class: 'stack' },
        h('div', { class: 'grid-2' }, ui.field(t('Year'), f.year), ui.field(t('Department'), f.dept)),
        h('div', { class: 'grid-2' }, ui.field('TD', f.td), ui.field('TP', f.tp)),
        h('div', { class: 'grid-2' }, ui.field(t('Option'), f.option), ui.field(t('Language group'), f.lang_group)),
        ui.field(t('Note'), f.notes), matches));
      count();
      body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var row = Object.assign({ name: title, is_mystery: true, is_ally: false, photo_path: null, lat: null, lng: null, points: 0, notes: f.notes.value.trim() }, clues());
          api.close();
          store.insert('players', row).then(function (m) {
            return dir === 'hunter' ? act.setTarget(m.id, p.id, { roundId: roundId, confidence: 'sur', noConfirm: true, silent: true }) : act.setTarget(p.id, m.id, { roundId: roundId, confidence: 'sur', noConfirm: true, silent: true });
          }).then(function () { store.log(t('Mystery player added: {name}', { name: title })); ui.toast(t('Mystery player added to the chain.')); });
        } }, t('Add to the chain'))));
    } });
  };
  /* The block at the top of a mystery sheet: its clues and the players it may be */
  function mysteryBox(p, roundId, edit, api) {
    var clues = L.MYSTERY_CLUES.map(function (k) { return p[k]; }).filter(Boolean).join(' · ');
    var cands = L.mysteryCandidates(store.state, p, roundId), shown = cands.slice(0, 12);
    return h('section', { class: 'mystery-box' },
      h('p', {}, h('strong', {}, t('Who is it?')), ' ', h('span', { class: 'muted' }, clues ? t('Clues: {c}', { c: clues }) : t('No clue yet: edit the sheet to add some.'))),
      h('p', { class: 'muted small' }, cands.length ? K.n(cands.length, '{n} player matches.', '{n} players match.') : t('Nobody matches these clues.')),
      shown.length ? h('div', { class: 'stack-tight mystery-cands' }, shown.map(function (c) {
        return h('div', { class: 'row mystery-cand' }, ui.avatar(c, 'sm'),
          h('button', { type: 'button', class: 'row-main linkish', onclick: function () { api.close(); act.openPlayer(c.id); } }, h('span', { class: 'row-title' }, c.name), h('span', { class: 'row-sub' }, [c.year, c.dept, c.td, c.tp].filter(Boolean).join(' '))),
          edit ? h('button', { type: 'button', class: 'btn', onclick: function () { act.mergeMystery(p.id, c.id); } }, t('It is them')) : null);
      })) : null,
      cands.length > shown.length ? h('p', { class: 'muted small' }, t('…and {n} more: add clues to narrow it down.', { n: cands.length - shown.length })) : null,
      edit ? h('button', { type: 'button', class: 'linkish small', onclick: function () { ui.pickPlayer({ title: t('Who is it?'), filter: function (x) { return !x.is_mystery && x.id !== p.id; } }).then(function (id) { if (id) act.mergeMystery(p.id, id); }); } }, t('Someone else…')) : null);
  }
  act.mergeMystery = function (mysteryId, realId) {
    var m = store.player(mysteryId), r = store.player(realId); if (!m || !r || !store.canEdit()) return Promise.resolve();
    return ui.confirm({ title: t('It is {name}?', { name: r.name }), text: t('What we know about "{m}" (links, kills, bonuses, intel, clues) moves to the sheet of {name}, then the mystery sheet is deleted.', { m: m.name, name: r.name }), action: t('Merge') }).then(function (ok) {
      if (!ok) return;
      var plan = L.mysteryMerge(store.state, m, r), jobs = [];
      plan.links.forEach(function (x) { jobs.push(store.update('links', x.id, x.patch)); });
      plan.drop.forEach(function (id) { jobs.push(store.remove('links', id)); });
      plan.kills.forEach(function (x) { jobs.push(store.update('kills', x.id, x.patch)); });
      plan.bonuses.forEach(function (x) { jobs.push(store.update('bonuses', x.id, x.patch)); });
      plan.intel.forEach(function (x) { jobs.push(store.update('intel', x.id, x.patch)); });
      if (Object.keys(plan.player).length) jobs.push(store.update('players', r.id, plan.player));
      return Promise.all(jobs).then(function () { return store.remove('players', m.id); }).then(function () {
        store.log(t('{m} identified: it is {name}', { m: m.name, name: r.name }));
        ui.toast(t('Merged into the sheet of {name}.', { name: r.name }));
        act.openPlayer(r.id);   // the mystery sheet, if open, closes itself now that it is gone
      });
    });
  };

  /* ------------------------------------------------------------ share a sheet */
  /* A sheet as a text, with its photo, to send to allies on WhatsApp, Messenger…: you choose what goes in,
     since once sent it leaves the app. */
  act.shareSheet = function (playerId) {
    var p = store.player(playerId); if (!p) return;
    var st = store.state, roundId = act.currentRoundId(), dead = L.deadSet(st).has(p.id);
    var home = p.home_id && (st.homes || []).find(function (x) { return x.id === p.home_id; });
    var PARTS = [['class', t('Year and groups'), true], ['points', t('Points'), true], ['chain', t('Killer and target'), true], ['weapons', t('Weapons'), true],
      ['timetable', t('Timetable now'), true], ['address', t('Address'), false], ['notes', t('Notes'), false], ['photo', t('Photo (with "Share…")'), !!p.photo_path]];
    var sched = null, photo = null;
    ui.dialog({ title: t('Share {name}', { name: p.name }), render: function (body, api) {
      var boxes = {}, text = h('textarea', { rows: '9', class: 'share-text', 'aria-label': t('Text to send') });
      function on(id) { return boxes[id] && boxes[id].checked; }
      function build() {
        var lines = [p.name + (dead ? ' (' + t('dead') + ')' : '')];
        if (on('class')) { var c = [[p.year, p.dept, p.td].filter(Boolean).join(' '), p.tp, p.option, p.lang_group].filter(Boolean).join(' · '); if (c) lines.push(c); }   // as on the year tag
        if (on('points')) lines.push(ui.pointsText(p));
        if (on('chain') && roundId && !dead) {
          var hu = L.resolveHunter(st, roundId, p.id).id, tg = L.resolveTarget(st, roundId, p.id).id;
          if (hu) lines.push(t('Hunted by') + ' ' + name(hu));
          if (tg) lines.push(t('Hunts') + ' ' + name(tg));
        }
        if (on('weapons') && p.weapons) lines.push(t('Weapons') + ' : ' + L.weaponList(p.weapons).map(function (w) { var d = ui.weaponDifficulty(w); return w + (d ? ' (' + (d === 'difficile' ? t('hard') : t('easy')) + ')' : ''); }).join(', '));
        if (on('timetable') && sched) lines = lines.concat(sched);
        if (on('address') && (p.address || home)) lines.push(t('Address') + ' : ' + [home ? home.name : null, home && L.homeKind(home) === 'residence' && p.apartment ? t('apt. {n}', { n: p.apartment }) : null, p.address && (!home || p.address !== home.name) ? p.address : null].filter(Boolean).join(', '));
        if (on('notes') && p.notes) lines.push(p.notes);
        text.value = lines.join('\n');
      }
      var list = h('div', { class: 'share-parts' }, PARTS.map(function (x) {
        if (x[0] === 'photo' && !p.photo_path) return null;
        if (x[0] === 'timetable' && !store.calendarsFor(p).length) return null;
        boxes[x[0]] = h('input', { type: 'checkbox', checked: x[2], onchange: build });
        return h('label', { class: 'check' }, boxes[x[0]], x[1]);
      }));
      body.appendChild(h('p', { class: 'muted small' }, t('Choose what to send: once shared, it leaves the app.')));
      body.appendChild(list);
      body.appendChild(ui.field(t('Text to send'), text, t('You can still change it before sending.')));
      var canShare = !!navigator.share;
      body.appendChild(h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: function () {
          // the text only: pasted, a photo would win over it in most apps ("Share…" sends both)
          (navigator.clipboard ? navigator.clipboard.writeText(text.value) : Promise.reject()).then(function () { ui.toast(t('Copied: paste it in the conversation.')); }, function () { text.select(); ui.toast(t('Select the text and copy it.'), 'error'); });
        } }, t('Copy')),
        canShare ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var data = { title: p.name, text: text.value };
          if (on('photo') && photo && navigator.canShare && navigator.canShare({ files: [photo] })) data.files = [photo];
          navigator.share(data).then(function () { api.close(); }, function (err) { if (err && err.name !== 'AbortError') ui.toast(t('Sharing failed: {err}', { err: err.message || err }), 'error'); });
        } }, K.icon('share'), t('Share…')) : null));
      build();
      if (store.calendarsFor(p).length) store.playerEvents(p).then(function (res) { sched = ui.scheduleLines(res.events); build(); }, function () {});
      // the photo is fetched beforehand: sharing must follow the tap straight away
      var url = p.photo_path && store.photoUrl(p.photo_path);
      if (url && window.fetch && window.File) fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        photo = new File([b], L.norm(p.name).replace(/[^a-z0-9]+/g, '-') + '.' + ((b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')), { type: b.type || 'image/jpeg' });
      }).catch(function () {});
    } });
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
    return L.realPlayers(st).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); }).map(function (p) {
      var d = dead.has(p.id), tg = round && !d ? L.resolveTarget(st, round.id, p.id, maps, dead) : null, hu = round && !d ? L.resolveHunter(st, round.id, p.id, maps, dead) : null;
      return { p: p, dead: d, target: tg && tg.id ? name(tg.id) : '', hunter: hu && hu.id ? name(hu.id) : '', targetConf: tg && tg.id ? ui.confLabel(tg.confidence) : '' };
    });
  }
  act.exportCsv = function () {
    var header = [t('Name'), t('Status'), t('Year'), t('Department'), 'TD', 'TP', t('Option'), t('Language group'), t('Points'), t('Weapons'), t('Target'), t('Reliability'), t('Killer'), t('Alliance'), t('Address'), t('Housing type'), t('Notes')];
    var rows = playerRows().map(function (r) { var p = r.p; return [p.name, r.dead ? t('Dead') : t('Alive'), p.year, p.dept, p.td, p.tp, p.option, p.lang_group, p.points || 0, p.weapons, r.target, r.targetConf, r.hunter, p.is_ally ? t('yes') : '', p.address, p.address ? t(L.ADDRESS_TYPES.find(function (x) { return x.id === L.addressType(p.address_type); }).label) : '', p.notes]; });
    ui.download('players-' + new Date().toISOString().slice(0, 10) + '.csv', '\ufeff' + L.toCsv(header, rows), 'text/csv;charset=utf-8');
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
      kt.appendChild(hh('tr', {}, [ui.when(k.happened_at), k.admin_reason ? t('Administration') + ' (' + t(k.admin_reason === 'cheating' ? 'Cheating' : 'Other') + ')' : k.killer_id ? name(k.killer_id) : '?', name(k.victim_id), k.weapon || '', String(k.points || 0), k.note || ''].map(function (x) { return hh('td', {}, [x]); })));
    });
    body.appendChild(kt);
    w.focus();
  };

  /* ---------------------------------------------------------- my profile */
  act.profileDialog = function () {
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
})();
