/* The player sheet: when to catch them, the sheet, its weapons and edit form, intel, mystery players, sharing. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions, _ = act._;
  function homePatch() { return _.homePatch.apply(null, arguments); }
  function localIso() { return _.localIso.apply(null, arguments); }
  function name() { return _.name.apply(null, arguments); }
  function parisInput() { return _.parisInput.apply(null, arguments); }

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

  /* ------------------------------------------------------- player sheet */
  act.openPlayer = function (playerId, ctx) {
    if (store.isObserver()) return;   // observers see the lists, not the sheets
    ctx = ctx || {};
    var off = null, intelAll = false, buysOpen = false;
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
            if (!id) {
              var cut = dir === 'target' ? (other && maps.hunterOf.get(other.id)) : maps.hunterOf.get(p.id);
              if (!cut) return;
              e.target.value = other ? other.id : '';   // unchanged until confirmed
              ui.confirm({ title: t('Delete this link?'), text: t('{a} will no longer hunt {b}: the chain is cut there.', { a: name(cut.hunter_id), b: name(cut.target_id) }), action: t('Delete link'), danger: true })
                .then(function (ok) { if (ok) { store.remove('links', cut.id); store.log(t('Link removed: {a} no longer hunts {b}', { a: name(cut.hunter_id), b: name(cut.target_id) })); } });
              return;
            }
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
      /* every purchase of the player, finished ones too, and what they cost: helps guess what they have left */
      var buys = (st.bonuses || []).filter(function (b) { return b.player_id === p.id; }).sort(function (a, b) { return Date.parse(b.bought_at) - Date.parse(a.bought_at); });
      if (buys.length) {
        var spent = buys.reduce(function (n, b) { return n + (b.price || 0); }, 0);
        body.appendChild(h('details', { class: 'bonus-history sheet-buys', open: buysOpen, ontoggle: function (e) { buysOpen = e.target.open; } },
          h('summary', {}, K.icon('chevron', 'ic-sm'), K.n(buys.length, '{n} purchase', '{n} purchases') + ' · ' + t('{n} pts in purchases', { n: spent })),
          buys.map(function (b) {
            return h('div', { class: 'row buy-row' }, h('span', { class: 'row-main' }, h('span', {}, ui.bonusTag(b, true)),
              h('span', { class: 'row-sub' }, [t('bought {date}', { date: ui.whenShort(b.bought_at) }), K.n(b.price || 0, '{n} pt', '{n} pts'), b.note].filter(Boolean).join(' · '))),
              edit ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove this purchase'), onclick: function () { act.removeBonus(b); } }, K.icon('close')) : null);
          })));
      }
      if (dead && kill) {
        body.appendChild(h('button', { type: 'button', class: 'death', title: act.killSummary(kill), onclick: function () { act.killDetails(kill.id); } }, h('span', { class: 'stamp', 'aria-hidden': 'true' }, t('Eliminated')),
          h('span', {}, act.killAttribution(kill) + (kill.weapon ? ' ' + t('with "{w}"', { w: kill.weapon }) : '') + ', ' + ui.ago(kill.happened_at) + '.')));
      } else {
        body.appendChild(roundId ? h('div', { class: 'relations' }, person(t('Killer'), hunter, 'hunter'), person(t('Target'), target, 'target'))
          : h('p', { class: 'muted' }, t('Start the loop from the Chain tab to record targets and killers.')));
        body.appendChild(h('div', { class: 'sched-block' }, h('span', { class: 'relation-label' }, t('Timetable')), ui.schedule(p)));
      }

      var weapons = ui.weaponsInOrder(p.weapons);   // easy, then hard
      if (weapons.length || edit) body.appendChild(h('div', { class: 'tags sheet-weapons' }, weapons.map(function (w) { return ui.weaponTag(w); }),
        edit ? h('button', { type: 'button', class: 'btn btn-sm sheet-weapons-edit', onclick: function () { act.editWeapons(p.id); } }, K.icon(weapons.length ? 'edit' : 'plus', 'ic-sm'), weapons.length ? t('Change the weapons') : t('Add a weapon')) : null));
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

  /* The weapons of a sheet: the picker (catalogue first) and the difficulty of each one. It belongs to the catalogue:
     a weapon already there can be switched easy/hard (for everyone), an unknown one added or left as "don't know".
     A player holds at most one easy and one hard weapon. Used by the sheet form and the quick weapons dialog. */
  function weaponEditor(text, playerId) {
    var had = new Set(L.weaponList(text).map(L.norm));
    function inPlay(name) {   // a weapon is in play once per loop: held by another living player -> why it cannot be taken
      var other = L.weaponHolders(store.state, name, playerId)[0];
      return other ? t('Already in play: {name} holds it.', { name: other.name }) : null;
    }
    var levels = {}, levelsBox = h('div', { class: 'weapon-levels' });
    function levelOf(w) { var k = L.norm(w); return k in levels ? levels[k].value : ui.weaponDifficulty(w) || ''; }
    function holderOf(level, names, except) { return level ? names.find(function (n) { return L.norm(n) !== L.norm(except || '') && levelOf(n) === level; }) : null; }
    function weaponRule(name, names) {   // why this weapon cannot be added, or null
      if (names.length >= 2) return t('Two weapons at most: one easy and one hard.');
      if (inPlay(name)) return inPlay(name);
      var d = ui.weaponDifficulty(name), other = holderOf(d, names);
      return other ? t(d === 'difficile' ? 'Already a hard weapon: {w}' : 'Already an easy weapon: {w}', { w: other }) : null;
    }
    function levelsError(names) {
      if (names.length > 2) return t('Two weapons at most: one easy and one hard.');
      var taken = names.find(function (n) { return !had.has(L.norm(n)) && inPlay(n); });   // only the ones added now: an old duplicate does not block the sheet
      if (taken) return taken + ' ' + inPlay(taken);
      var e = names.filter(function (n) { return levelOf(n) === 'facile'; }).length, d = names.filter(function (n) { return levelOf(n) === 'difficile'; }).length;
      return e > 1 ? t('Only one easy weapon per player.') : d > 1 ? t('Only one hard weapon per player.') : null;
    }
    function drawLevels(focusLabel) {
      ui.clear(levelsBox);
      var names = picker.names();
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
    var picker = ui.weaponPicker(text || '', { onChange: function () { drawLevels(); }, check: weaponRule, max: 2 });
    drawLevels();
    return { picker: picker, levelsBox: levelsBox, draw: drawLevels, error: levelsError, save: saveLevels };
  }

  /* Quick weapons dialog from a sheet: change or add a weapon without opening the whole form */
  act.editWeapons = function (playerId) {
    var p = store.player(playerId); if (!p || !store.canEdit()) return;
    ui.dialog({ title: t('Weapons of {name}', { name: p.name }), render: function (body, api) {
      var we = weaponEditor(p.weapons || '', p.id);
      body.appendChild(h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('Weapons in hand')), we.picker.el, h('span', { class: 'field-hint' }, t('Pick from the catalogue; a new weapon is added only if it is not there.'))),
        we.levelsBox));
      body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var names = L.weaponList(we.picker.value), err = we.error(names);
          if (err) return ui.toast(err, 'error');
          api.close(); we.save(names);
          var text = names.join(', ');
          if (L.weaponList(p.weapons).join(', ') !== text) {
            store.update('players', p.id, { weapons: text });
            store.log(t('Weapons of {name}: {w}', { name: p.name, w: text || t('none') }));
          }
          ui.toast(t('Weapons saved.'));
        } }, t('Save'))));
      setTimeout(function () { if (!we.picker.input.disabled) we.picker.input.focus(); }, 50);
    } });
  };
  act.editPlayer = function (playerId) {
    if (!store.canEdit()) return;
    var p = playerId ? store.player(playerId) : {}, s = store.state.settings;
    ui.dialog({
      title: playerId ? t('Edit sheet') : t('Add a player'),
      render: function (body, api) {
        var typeTouched = false;
        var we = weaponEditor(p.weapons || '', playerId), levelsBox = we.levelsBox, levelsError = we.error, saveLevels = we.save, drawLevels = we.draw;
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
          weapons: we.picker,
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
        // the server lets only an administrator delete a sheet (a member may delete a mystery sheet)
        if (playerId && (store.isAdmin() || p.is_mystery)) actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger btn-push', onclick: function () {
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
  /* Before merging: when the real sheet already has a target or a hunter that the mystery sheet's links contradict,
     the person says which to keep. Resolves to 'mystery', 'real' or null (cancelled). */
  function mergeChoice(m, r) {
    var plan = L.mysteryMerge(store.state, m, r, 'mystery'), intro = t('What we know about "{m}" (links, kills, bonuses, intel, clues) moves to the sheet of {name}, then the mystery sheet is deleted.', { m: m.name, name: r.name });
    if (!plan.conflicts.length) return ui.confirm({ title: t('It is {name}?', { name: r.name }), text: intro, action: t('Merge') }).then(function (ok) { return ok ? 'mystery' : null; });
    return new Promise(function (resolve) {
      var answer = null;
      ui.dialog({ title: t('It is {name}?', { name: r.name }), onClose: function () { resolve(answer); }, render: function (body, api) {
        body.appendChild(h('p', { class: 'prose' }, intro));
        body.appendChild(h('p', { class: 'prose' }, h('strong', {}, t('But it contradicts what we knew:'))));
        body.appendChild(h('ul', { class: 'prose' }, plan.conflicts.map(function (c) {
          return h('li', {}, c.hunter ? t('{a} already hunts {b}, the mystery sheet hunts {c}.', { a: r.name, b: name(c.existing.target_id), c: name(c.link.target_id) })
            : t('{a} is already hunted by {b}, the mystery sheet is hunted by {c}.', { a: r.name, b: name(c.existing.hunter_id), c: name(c.link.hunter_id) }));
        })));
        function pick(v) { return function () { answer = v; api.close(); }; }
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn', onclick: pick('real') }, t('Keep what we knew about {name}', { name: r.name })),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: pick('mystery') }, t("Keep the mystery sheet's links"))));
      } });
    });
  }
  /* opts.open === false: the real sheet is not opened afterwards. Resolves to true once merged. */
  act.mergeMystery = function (mysteryId, realId, opts) {
    var m = store.player(mysteryId), r = store.player(realId); if (!m || !r || !store.canEdit()) return Promise.resolve(false);
    return mergeChoice(m, r).then(function (prefer) {
      if (!prefer) return false;
      var plan = L.mysteryMerge(store.state, m, r, prefer), jobs = [];
      // the links in one transaction: moved, duplicates and contradicted ones removed (nothing half done on a conflict)
      var moved = plan.links.map(function (x) { return Object.assign({}, store.state.links.find(function (l) { return l.id === x.id; }), x.patch); });
      jobs.push(store.replaceLinks(plan.drop.concat(plan.replace, plan.links.map(function (x) { return x.id; })), moved));
      plan.kills.forEach(function (x) { jobs.push(store.update('kills', x.id, x.patch)); });
      plan.bonuses.forEach(function (x) { jobs.push(store.update('bonuses', x.id, x.patch)); });
      plan.intel.forEach(function (x) { jobs.push(store.update('intel', x.id, x.patch)); });
      if (Object.keys(plan.player).length) jobs.push(store.update('players', r.id, plan.player));
      return Promise.all(jobs).then(function () { return store.remove('players', m.id); }).then(function () {
        store.log(t('{m} identified: it is {name}', { m: m.name, name: r.name }));
        ui.toast(t('Merged into the sheet of {name}.', { name: r.name }));
        if (!opts || opts.open !== false) act.openPlayer(r.id);   // the mystery sheet, if open, closes itself now that it is gone
        return true;
      });
    });
  };

  /* A death is always announced with a name: a mystery sheet cannot die as such. Who was it? (the players matching
     its clues first), then its sheet is merged into theirs. Resolves to the real player's id, or null. */
  act.identifyMystery = function (mysteryId) {
    var m = store.player(mysteryId); if (!m || !store.canEdit()) return Promise.resolve(null);
    var likely = new Set(L.mysteryCandidates(store.state, m, act.currentRoundId()).map(function (p) { return p.id; }));
    return ui.pickPlayer({ title: t('{m} is dead: who was it?', { m: m.name }), filter: function (p) { return !p.is_mystery && p.id !== m.id && !act.isDead(p.id); },
      prefer: function (p) { return likely.has(p.id); }, otherLabel: t('Players not matching the clues') })
      .then(function (id) {
        if (!id) return null;
        return act.mergeMystery(m.id, id, { open: false }).then(function (ok) { return ok ? id : null; });
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

  Object.assign(_, { intelItem: intelItem, mergeChoice: mergeChoice, mysteryBox: mysteryBox, weaponEditor: weaponEditor });
})();
