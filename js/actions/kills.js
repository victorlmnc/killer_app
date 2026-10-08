/* Kills: the kill form, recording and undoing, the killer named later, weapons of unknown difficulty, the scoring. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions, _ = act._;
  function ensureRound() { return _.ensureRound.apply(null, arguments); }
  function localIso() { return _.localIso.apply(null, arguments); }
  function name() { return _.name.apply(null, arguments); }
  function parisInput() { return _.parisInput.apply(null, arguments); }

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
    if (act.isDead(k.victimId)) { ui.toast(t('{name} is already dead: a teammate recorded it.', { name: name(k.victimId) }), 'error'); return Promise.resolve(false); }
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
        // the kill first: if the server refuses it (a teammate recorded this death a moment ago), nothing else is written
        return store.insert('kills', { id: killId, round_id: roundId, killer_id: killerId || null, victim_id: k.victimId, admin_reason: adminReason, weapon: weapon, weapon_level: level, bonus: parts ? parts.bonus : null, first_blood: parts ? !!parts.firstBlood : null, mates: parts ? parts.mates : null, points: points, note: k.note || '', killer_weapons: inherits ? killer.weapons || '' : null, happened_at: k.when || new Date().toISOString() }).then(function () {
          var jobs = [];
          if (killer) {
            if (points) jobs.push(store.addPoints(killer.id, points));
            if (inherits) jobs.push(store.update('players', killer.id, { weapons: victim.weapons }));
          }
          var text = adminReason ? t('Administrative elimination of {name}: {reason}', { name: victim.name, reason: t(adminReason === 'cheating' ? 'Cheating' : 'Other') })
            : killer ? t('{a} eliminated {b}', { a: killer.name, b: victim.name }) + (weapon ? ' (' + weapon + ')' : '') : t('{name} is dead', { name: victim.name });
          store.log(text, { type: 'kill', kill_id: killId, killer_id: killerId || null, victim_id: k.victimId, admin_reason: adminReason, killer: killer ? killer.name : '', victim: victim.name, weapon: weapon, weapon_level: level, points: points, note: k.note || '' });
          // the weapon goes to the catalogue; a difficulty chosen here that differs from the catalogue's becomes the
          // catalogue's: the kills made with it while unknown are settled, the others recomputed if the person agrees
          if (weapon && level && !cat) jobs.push(store.insert('weapons', { name: weapon, difficulty: level }));
          else if (cat && level && level !== 'inconnue' && level !== cat.difficulty) jobs.push(Promise.all(jobs).then(function () { return act.setWeaponDifficulty(weapon, level); }));
          return Promise.all(jobs);
        });
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
        return store.remove('kills', kill.id).then(function () {   // then the points and weapons, once the kill is gone
          var jobs = [];
          if (pts) jobs.push(store.addPoints(killer.id, -pts));
          if (restore) jobs.push(store.update('players', killer.id, { weapons: kill.killer_weapons }));
          return Promise.all(jobs);
        }).then(function () { store.log(t('Kill undone: {name} is alive again', { name: name(playerId) })); });
      });
  };

  /* The killer of a kill is set or changed: the points of the kill move from the former killer to the new one, and
     in the current loop the victim's weapons pass to the new killer (the former one gets theirs back). */
  act.editKill = function (kill) {
    ui.pickPlayer({ title: t('Who killed {name}?', { name: name(kill.victim_id) }), filter: function (p) { return p.id !== kill.victim_id; }, extra: [{ label: t('Unknown killer'), value: null }] })
      .then(function (v) {
        if (v === undefined || (v === kill.killer_id && !kill.admin_reason)) return;
        var pts = kill.admin_reason ? 0 : kill.points || 0, victim = store.player(kill.victim_id), current = kill.round_id === act.currentRoundId();
        var old = kill.killer_id && store.player(kill.killer_id), neu = v && store.player(v), patches = new Map(), gains = new Map(), killPatch = { killer_id: v, admin_reason: null };
        function add(p, x) { patches.set(p.id, Object.assign(patches.get(p.id) || {}, x)); }
        var same = function (a, b) { return L.weaponList(a).map(L.norm).sort().join() === L.weaponList(b).map(L.norm).sort().join(); };
        if (old) {
          if (pts) gains.set(old.id, -pts);
          if (kill.killer_weapons != null && victim && same(old.weapons, victim.weapons)) add(old, { weapons: kill.killer_weapons });   // gets theirs back
          killPatch.killer_weapons = null;
        }
        if (neu) {
          if (pts) gains.set(neu.id, (gains.get(neu.id) || 0) + pts);
          if (current && victim && L.weaponList(victim.weapons).length) { killPatch.killer_weapons = neu.weapons || ''; add(neu, { weapons: victim.weapons }); }
        }
        var jobs = [store.update('kills', kill.id, killPatch).then(function () {   // the kill first, then who gets what
          var more = [];
          gains.forEach(function (d, id) { more.push(store.addPoints(id, d)); });
          patches.forEach(function (x, id) { more.push(store.update('players', id, x)); });
          return Promise.all(more);
        })];
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
    gain.forEach(function (d, id) { jobs.push(store.addPoints(id, d)); });
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
      gain.forEach(function (d, id) { if (d) jobs.push(store.addPoints(id, d)); });
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

  Object.assign(_, { applySettle: applySettle, killParts: killParts, killPointsText: killPointsText });
})();
