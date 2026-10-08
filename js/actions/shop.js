/* Shop bonuses: purchases and refunds. */
(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var act = K.actions, _ = act._;
  function localIso() { return _.localIso.apply(null, arguments); }
  function parisInput() { return _.parisInput.apply(null, arguments); }

  /* ------------------------------------------------------------ shop bonuses */
  /* Record that a player bought a shop item: when it takes effect and until when (from the item's timing,
     adjustable), and optionally take the price off their points. */
  act.recordBonus = function (item, playerId) {
    if (!store.canEdit()) return;
    var chosen = playerId || null, unknown = false;   // unknown: "someone bought it", we do not know who
    ui.dialog({
      title: t('Record a purchase: {name}', { name: item.name }),
      render: function (body, api) {
        var who = h('button', { type: 'button', class: 'btn btn-block' });
        function drawWho() {
          var p = chosen && store.player(chosen); ui.clear(who);
          if (p) { who.appendChild(ui.avatar(p, 'sm')); who.appendChild(h('span', {}, p.name + ' (' + ui.pointsText(p) + ')')); }
          else who.appendChild(h('span', {}, unknown ? t('Someone (unknown)') : t('Choose the player')));
          if (payBox) payBox.hidden = !p;   // no points to take off nobody
        }
        who.addEventListener('click', function () {
          ui.pickPlayer({ title: t('Who bought "{name}"?', { name: item.name }), filter: function (p) { return !act.isDead(p.id); }, prefer: function (p) { return !p.is_ally; }, otherLabel: t('Alliance'),
            extra: [{ label: t("We don't know who"), value: null }] })
            .then(function (v) { if (v === undefined) return; chosen = v; unknown = v === null; drawWho(); });
        });
        var payBox = null;
        var tm = L.bonusTiming(item), now = new Date();
        var bought = h('input', { type: 'datetime-local', value: localIso(now), onchange: recompute });
        var starts = h('input', { type: 'datetime-local', value: localIso(L.bonusWindow(item, now).starts) });
        var hours = h('input', { type: 'number', min: '0', step: '0.5', inputmode: 'decimal', value: String(tm.hours) });
        var pay = h('input', { type: 'checkbox', checked: (item.price || 0) > 0 });
        var note = h('input', { type: 'text', placeholder: t('e.g. seen on the organisers\' group') });
        function recompute() { if (bought.value) starts.value = localIso(L.bonusWindow(item, parisInput(bought.value)).starts); }
        if (item.price) payBox = h('label', { class: 'check' }, pay, t('Take {n} points off this player', { n: item.price }));
        drawWho();
        body.appendChild(h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('Player')), who, h('span', { class: 'field-hint' }, t('Not known yet? Choose "We don\'t know who" and say it later from the Shop.'))),
          ui.field(t('Bought at'), bought, t('Paris time.')),
          h('div', { class: 'grid-2 grid-align-start' }, ui.field(t('In effect from'), starts, tm.start === 'next_day' ? t('00:10 the day after the purchase.') : t('As soon as it is bought.')),
            ui.field(t('Duration (hours)'), hours, t('0 for a one-off bonus.'))),
          payBox,
          ui.field(t('Note'), note)));
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var p = chosen && store.player(chosen); if (!p && !unknown) return ui.toast(t('Choose the player, or "We don\'t know who".'), 'error');
            var s = starts.value ? parisInput(starts.value) : new Date(), hrs = Math.max(0, parseFloat(hours.value) || 0);
            var row = { player_id: p ? p.id : null, name: item.name, price: item.price || 0, bought_at: (bought.value ? parisInput(bought.value) : new Date()).toISOString(),
              starts_at: s.toISOString(), ends_at: hrs ? L.addParisHours(s, hrs).toISOString() : null, note: note.value.trim() };   // whole days on Paris clocks
            var jobs = [store.insert('bonuses', row).then(function () { if (p && pay.checked && item.price) return store.addPoints(p.id, -item.price); })];
            store.log((p ? t('{name} bought {bonus}', { name: p.name, bonus: item.name }) : t('Someone (unknown) bought {bonus}', { bonus: item.name })) + (row.ends_at ? ' (' + ui.whenShort(row.starts_at) + ' → ' + ui.whenShort(row.ends_at) + ')' : ''), { type: 'bonus', player_id: row.player_id, bonus: item.name, starts_at: row.starts_at, ends_at: row.ends_at, note: row.note });
            Promise.all(jobs).then(function () { api.close(); ui.toast(t('Purchase recorded.')); });
          } }, t('Record'))));
      }
    });
  };
  /* "Someone bought a Coupe-Gorge": once we know who, the purchase goes on their sheet, and their points can be taken. */
  act.setBonusBuyer = function (b) {
    if (!store.canEdit()) return;
    ui.pickPlayer({ title: t('Who bought "{name}"?', { name: b.name }), filter: function (p) { return !act.isDead(p.id); }, prefer: function (p) { return !p.is_ally; }, otherLabel: t('Alliance') }).then(function (id) {
      var p = id && store.player(id); if (!p) return;
      ui.dialog({ title: t('{name} bought {bonus}', { name: p.name, bonus: b.name }), render: function (body, api) {
        var pay = h('input', { type: 'checkbox', checked: (b.price || 0) > 0 });
        if (b.price) body.appendChild(h('label', { class: 'check' }, pay, t('Take {n} points off this player', { n: b.price }) + ' (' + ui.pointsText(p) + ')'));
        body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            api.close();
            store.update('bonuses', b.id, { player_id: p.id }).then(function () {
              store.log(t('{name} is the one who bought {bonus}', { name: p.name, bonus: b.name }), { type: 'bonus', player_id: p.id, bonus: b.name, starts_at: b.starts_at, ends_at: b.ends_at, note: b.note || '' });
              if (pay.checked && b.price) return store.addPoints(p.id, -b.price);
            }).then(function () { ui.toast(t('Purchase put on the sheet of {name}.', { name: p.name })); });
          } }, t('Save'))));
      } });
    });
  };
  /* Remove a recorded purchase (a mistake), giving the points back if they were taken. */
  act.removeBonus = function (b) {
    if (!store.canEdit()) return;
    var p = store.player(b.player_id);
    ui.dialog({ title: t('Remove this purchase?'), render: function (body, api) {
      var refund = h('input', { type: 'checkbox', checked: !!b.price });
      body.appendChild(h('p', { class: 'prose' }, t('{bonus} bought by {name}.', { bonus: b.name, name: p ? p.name : t('someone unknown') })));
      if (b.price && p) body.appendChild(h('label', { class: 'check' }, refund, t('Give the {n} points back', { n: b.price })));
      body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          store.remove('bonuses', b.id).then(function () { if (refund.checked && b.price && p) return store.addPoints(p.id, b.price); });
          store.log(t('Purchase removed: {bonus} of {name}', { bonus: b.name, name: p ? p.name : t('someone unknown') }));
          api.close();
        } }, t('Remove'))));
    } });
  };
})();
