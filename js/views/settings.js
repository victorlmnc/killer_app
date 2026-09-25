(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  K.views = K.views || {};

  K.views.settings = {
    title: t('Settings'),
    render: function (root) {
      function refresh() {
        var st = store.state, s = st.settings;
        if (root.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; // do not interrupt typing
        ui.clear(root);
        if (!store.isAdmin()) { root.appendChild(h('p', { class: 'empty' }, t('Only the administrator can open the settings.'))); return; }

        function text(key, label, type, hint) {
          return ui.field(label, h('input', { type: type || 'text', value: s[key] == null ? '' : String(s[key]), min: type === 'number' ? '0' : null,
            onchange: function (e) { store.setSetting(key, type === 'number' ? Math.max(0, parseInt(e.target.value, 10) || 0) : e.target.value.trim()); } }), hint);
        }
        root.appendChild(h('section', { class: 'panel' }, h('h2', {}, t('Game')), h('div', { class: 'stack' },
          text('game_name', t('Game name')),
          h('div', { class: 'grid-2' }, text('official_players', t('Registered players (official count)'), 'number'), text('school_total', t('People in the school'), 'number', t('Used for the participation rate. Leave 0 to hide it.'))))));

        /* Map */
        var c = K.geo.center();
        var lat = h('input', { type: 'number', step: 'any', value: String(c.lat) }), lng = h('input', { type: 'number', step: 'any', value: String(c.lng) });
        var saveCenter = function () { var a = parseFloat(lat.value), b = parseFloat(lng.value); if (isFinite(a) && isFinite(b)) store.setSetting('map_center', { lat: a, lng: b }); };
        lat.onchange = saveCenter; lng.onchange = saveCenter;
        var city = h('input', { type: 'text', placeholder: t('Town name') });
        root.appendChild(h('section', { class: 'panel' }, h('h2', {}, t('Map')),
          h('div', { class: 'grid-2' }, ui.field(t('Centre latitude'), lat), ui.field(t('Centre longitude'), lng)),
          h('div', { class: 'row row-wrap' }, city, h('button', { type: 'button', class: 'btn', onclick: function () {
            K.geo.geocode(city.value).then(function (hit) { if (!hit) return ui.toast(t('Town not found.'), 'error'); store.setSetting('map_center', { lat: hit.lat, lng: hit.lng }); ui.toast(t('Map centred on {name}.', { name: hit.label })); });
          } }, t('Centre on a town'))),
          text('geocoder_url', t('Geocoder URL'), 'url', t('Leave empty for the French public geocoder. Any service returning GeoJSON features with a "score" works.'))));

        /* Rounds */
        var rounds = L.sortedRounds(st), rs = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, t('Rounds and rerolls')), h('button', { type: 'button', class: 'btn', onclick: K.actions.newRound }, rounds.length ? t('New reroll') : t('Start the loop'))));
        rounds.forEach(function (r, i) {
          var n = st.links.filter(function (l) { return l.round_id === r.id; }).length;
          rs.appendChild(h('div', { class: 'row' }, h('input', { type: 'text', value: r.name, 'aria-label': t('Round name'), onchange: function (e) { store.update('rounds', r.id, { name: e.target.value.trim() || r.name }); } }),
            h('span', { class: 'muted small' }, K.n(n, '{n} link', '{n} links')),
            i === rounds.length - 1 ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
              ui.confirm({ title: t('Delete "{name}"?', { name: r.name }), text: t('Its {n} links are erased. Kills are kept.', { n: n }), action: t('Delete'), danger: true }).then(function (ok) { if (ok) store.remove('rounds', r.id); });
            } }, t('Delete')) : null));
        });
        if (!rounds.length) rs.appendChild(h('p', { class: 'empty' }, t('The first round is created automatically with the first link.')));
        root.appendChild(rs);

        /* Years, departments */
        var ys = h('section', { class: 'panel' }, h('h2', {}, t('Years and colours')));
        (s.years || []).forEach(function (y, i) {
          ys.appendChild(h('div', { class: 'row' },
            h('input', { type: 'text', value: y.name, 'aria-label': t('Year'), onchange: function (e) { var a = s.years.slice(); a[i] = { name: e.target.value.trim(), color: y.color }; store.setSetting('years', a); } }),
            h('input', { type: 'color', value: y.color, 'aria-label': t('Colour of {y}', { y: y.name }), onchange: function (e) { var a = s.years.slice(); a[i] = { name: y.name, color: e.target.value }; store.setSetting('years', a); } }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove {y}', { y: y.name }), onclick: function () { store.setSetting('years', s.years.filter(function (_, j) { return j !== i; })); } }, K.icon('close'))));
        });
        ys.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { store.setSetting('years', (s.years || []).concat([{ name: t('New'), color: '#8A93A0' }])); } }, t('Add a year')));
        ys.appendChild(ui.field(t('Departments'), h('input', { type: 'text', value: (s.depts || []).join(', '), onchange: function (e) { store.setSetting('depts', e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)); } }), t('Comma-separated. Leave empty if your school has none.')));
        root.appendChild(ys);

        /* Scoring and links */
        var pr = h('section', { class: 'panel' }, h('h2', {}, t('Kill scoring')));
        (s.point_rules || []).forEach(function (r, i) {
          function save(patch) { var a = s.point_rules.slice(); a[i] = Object.assign({}, r, patch); store.setSetting('point_rules', a); }
          pr.appendChild(h('div', { class: 'row row-wrap' }, h('input', { type: 'text', value: t(r.label), 'aria-label': t('Rule'), onchange: function (e) { save({ label: e.target.value.trim() }); } }),
            h('input', { type: 'text', value: t(r.points), 'aria-label': t('Points'), style: { 'max-width': '10rem' }, onchange: function (e) { save({ points: e.target.value.trim() }); } }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove'), onclick: function () { store.setSetting('point_rules', s.point_rules.filter(function (_, j) { return j !== i; })); } }, K.icon('close'))));
        });
        pr.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { store.setSetting('point_rules', (s.point_rules || []).concat([{ label: '', points: '' }])); } }, t('Add a rule')));
        root.appendChild(pr);

        var ls = h('section', { class: 'panel' }, h('h2', {}, t('Useful links')));
        (s.links || []).forEach(function (l, i) {
          function save(patch) { var a = s.links.slice(); a[i] = Object.assign({}, l, patch); store.setSetting('links', a); }
          ls.appendChild(h('div', { class: 'row row-wrap' },
            h('input', { type: 'text', value: l.label, placeholder: t('Label'), 'aria-label': t('Link label'), onchange: function (e) { save({ label: e.target.value.trim() }); } }),
            h('input', { type: 'url', value: l.url, placeholder: 'https://…', 'aria-label': t('Link address'), onchange: function (e) { save({ url: e.target.value.trim() }); } }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('Remove link'), onclick: function () { store.setSetting('links', s.links.filter(function (_, j) { return j !== i; })); } }, K.icon('close'))));
        });
        ls.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { store.setSetting('links', (s.links || []).concat([{ label: '', url: '' }])); } }, t('Add a link')));
        root.appendChild(ls);

        /* Accounts */
        var me = String((store.user && store.user.email) || '').toLowerCase();
        var ROLE_LABEL = { admin: t('Administrator'), member: t('Alliance member'), observer: t('Observer') };
        var acc = h('section', { class: 'panel' }, h('h2', {}, t('Accounts')));
        acc.appendChild(h('p', { class: 'prose muted small' }, store.mode === 'supabase'
          ? t('Only these addresses can sign in. Members can edit everything except the settings; observers only read the tabs you allow.')
          : t('Demo mode: data stays in this browser. Once a database is configured, only the addresses listed here can sign in.')));
        st.members.forEach(function (m) { acc.appendChild(memberRow(m)); });
        var mail = h('input', { type: 'email', placeholder: 'name@example.org', 'aria-label': t('Email to allow') }), who = h('input', { type: 'text', placeholder: t('Display name'), 'aria-label': t('Display name'), maxlength: '40' });
        var role = ui.select(['member', 'observer'].map(function (r) { return { value: r, label: ROLE_LABEL[r] }; }), 'member', { 'aria-label': t('Role') });
        acc.appendChild(h('div', { class: 'row row-wrap' }, who, mail, role, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var email = mail.value.trim().toLowerCase();
          if (!/^\S+@\S+\.\S+$/.test(email)) return ui.toast(t('Invalid email address.'), 'error');
          if (st.members.some(function (x) { return x.email === email; })) return ui.toast(t('This address already has access.'), 'error');
          store.addMember(email, who.value, role.value, role.value === 'observer' ? ['dashboard', 'chain', 'players'] : null); ui.toast(t('Access added. The person can now create an account with this address.'));
        } }, t('Allow'))));
        root.appendChild(acc);

        function memberRow(m) {
          var mine = m.email === me;
          var row = h('div', { class: 'member' });
          row.appendChild(h('div', { class: 'row row-wrap' },
            ui.avatar({ name: m.name || m.email, avatar_path: m.avatar_path }, 'sm'),
            h('input', { type: 'text', value: m.name || '', placeholder: m.email.split('@')[0], 'aria-label': t('Display name of {email}', { email: m.email }), maxlength: '40', onchange: function (e) { store.updateMember(m.email, { name: e.target.value.trim() }); } }),
            h('span', { class: 'row-main muted small' }, m.email + (mine ? ' (' + t('you') + ')' : '')),
            mine ? h('span', { class: 'tag' }, ROLE_LABEL.admin) : ui.select(['admin', 'member', 'observer'].map(function (r) { return { value: r, label: ROLE_LABEL[r] }; }), m.role, { 'aria-label': t('Role'), onchange: function (e) {
              var r = e.target.value;
              if (r === 'admin') return ui.confirm({ title: t('Make {email} an administrator?', { email: m.email }), text: t('They will be able to change the settings, manage accounts and erase the game. There can be several administrators.'), action: t('Confirm') })
                .then(function (ok) { if (ok) store.updateMember(m.email, { role: 'admin', tabs: null }); else refresh(); });
              store.updateMember(m.email, { role: r, tabs: r === 'observer' ? (m.tabs || ['dashboard', 'chain', 'players']) : null });
            } }),
            mine ? null : h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
              ui.confirm({ title: t('Remove access?'), text: t('{email} will no longer be able to read or change anything.', { email: m.email }), action: t('Remove'), danger: true }).then(function (ok) { if (ok) store.removeMember(m.email); });
            } }, t('Remove'))));
          if (m.role === 'observer') {
            var tabs = m.tabs || [];
            row.appendChild(h('div', { class: 'tab-picks' }, h('span', { class: 'muted small' }, t('Tabs this observer can open:')), K.NAV.filter(function (n) { return n[0] !== 'settings'; }).map(function (n) {
              return h('label', { class: 'check check-sm' }, h('input', { type: 'checkbox', checked: tabs.indexOf(n[0]) >= 0, onchange: function (e) {
                var next = tabs.filter(function (x) { return x !== n[0]; }); if (e.target.checked) next.push(n[0]);
                store.updateMember(m.email, { tabs: next });
              } }), t(n[2]));
            })));
          }
          return row;
        }

        /* Data */
        root.appendChild(h('section', { class: 'panel' }, h('h2', {}, t('Data')),
          h('div', { class: 'actions actions-start' },
            h('button', { type: 'button', class: 'btn', onclick: K.actions.importDialog }, K.icon('upload'), t('Import players')),
            h('button', { type: 'button', class: 'btn', onclick: K.actions.exportCsv }, K.icon('download'), t('Players (CSV)')),
            h('button', { type: 'button', class: 'btn', onclick: K.actions.exportPdf }, K.icon('print'), t('Report (print / PDF)')),
            h('button', { type: 'button', class: 'btn', onclick: K.actions.exportJson }, K.icon('download'), t('Full backup (JSON)')),
            store.mode !== 'supabase' ? h('button', { type: 'button', class: 'btn', onclick: function () { store.resetDemo().then(function () { ui.toast(t('Demo game reloaded.')); }); } }, t('Reload the demo')) : null),
          h('h3', {}, t('Activity log')),
          h('p', { class: 'prose' }, t('Clears the "Latest activity" list on the dashboard ({n} entries). Kills, links and sheets are untouched.', { n: st.events.length })),
          h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn', disabled: !st.events.length, onclick: function () {
            ui.confirm({ title: t('Clear the log?'), text: t('The {n} latest entries disappear for the whole team. Nothing else is touched.', { n: st.events.length }), action: t('Clear log'), danger: true })
              .then(function (ok) { if (ok) store.clearEvents().then(function () { ui.toast(t('Log cleared.')); }); });
          } }, t('Clear log'))),
          h('h3', {}, t('End of game')),
          h('p', { class: 'prose' }, t('Erases sheets, photos, chains, kills and the log. The weapon catalogue, strategic spots, shop and settings stay for next year.')),
          h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            ui.confirm({ title: t('Erase everything?'), text: [t('The {n} sheets and their photos will be deleted for the whole team. This cannot be undone.', { n: st.players.length }), t('Download a backup first if you want to keep the statistics.')], action: t('Erase the game'), danger: true })
              .then(function (ok) { if (ok) store.purge().then(function () { ui.toast(t('Game erased.')); }); });
          } }, t('Erase the game')))));
      }
      refresh();
      return refresh;
    }
  };
})();
