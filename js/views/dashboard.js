(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) { var el = document.createElementNS(SVG, tag); Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); }); return el; }

  /* One dot per living player, a red arc where the link is known. Gaps are what is left to find. */
  function ring(st, round) {
    var f = L.fragments(st, round.id, 'current');
    var frags = f.fragments.slice().sort(function (a, b) { return b.ids.length - a.ids.length; });
    var n = f.nodeCount, R = 130, C = 160, slot = 0;
    var svg = s('svg', { viewBox: '0 0 320 320', class: 'ring', role: 'img', 'aria-label': t('Current loop: {a} players alive, {b} known fragments', { a: n, b: frags.length }) });
    svg.appendChild(s('circle', { cx: C, cy: C, r: R, class: 'ring-track' }));
    if (!n) return svg;
    var step = 2 * Math.PI / n, dotR = Math.max(2.2, Math.min(7, (2 * Math.PI * R / n) * 0.3));
    function pt(i) { var a = i * step - Math.PI / 2; return [C + R * Math.cos(a), C + R * Math.sin(a)]; }
    function arc(i, j, conf) { var a = pt(i), b = pt(j); svg.appendChild(s('path', { d: 'M' + a[0] + ' ' + a[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + b[0] + ' ' + b[1], class: 'ring-link ring-' + conf })); }
    var dots = [];
    frags.forEach(function (fr) {
      var start = slot;
      fr.ids.forEach(function (id, i) { dots.push({ id: id, i: slot }); if (i < fr.edges.length && i < fr.ids.length - 1) arc(slot, slot + 1, fr.edges[i].confidence); slot++; });
      if (fr.closed && fr.ids.length === n && n > 1) arc(slot - 1, start + n, fr.edges[fr.edges.length - 1].confidence);
    });
    f.unplaced.forEach(function (id) { dots.push({ id: id, i: slot++, loose: true }); });
    dots.forEach(function (d) {
      var p = store.player(d.id), xy = pt(d.i);
      var c = s('circle', { cx: xy[0], cy: xy[1], r: p.is_ally ? dotR + 1.5 : dotR, class: 'ring-dot' + (d.loose ? ' ring-loose' : '') + (p.is_ally ? ' ring-ally' : ''), tabindex: '0' });
      c.style.setProperty('--year', ui.yearColor(p.year));
      c.appendChild(s('title')).textContent = p.name;
      c.addEventListener('click', function () { K.actions.openPlayer(p.id); });
      c.addEventListener('keydown', function (e) { if (e.key === 'Enter') K.actions.openPlayer(p.id); });
      svg.appendChild(c);
    });
    return svg;
  }
  function personRow(p, right) { return h('button', { type: 'button', class: 'row row-btn', onclick: function () { K.actions.openPlayer(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name), right); }

  K.views = K.views || {};
  K.views.dashboard = {
    title: t('Dashboard'),
    render: function (root) {
      var showAll = false, showAllIncomplete = false;
      function refresh() {
        var st = store.state, set = st.settings, stats = L.stats(st), round = L.currentRound(st), edit = store.canEdit();
        ui.clear(root);
        if (!st.players.length) {
          root.appendChild(h('section', { class: 'panel panel-empty' }, h('h2', {}, t('No players yet')),
            h('p', { class: 'prose' }, t('Import the list of registered players from a spreadsheet or add them one by one.')),
            edit ? h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: K.actions.importDialog }, t('Import players')),
              h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.editPlayer(null); } }, t('Add a player'))) : null));
          return;
        }
        var official = Number(set.official_players) || 0, school = Number(set.school_total) || 0;
        root.appendChild(h('section', { class: 'panel hero' },
          h('div', { class: 'hero-ring' }, round ? ring(st, round) : null,
            h('div', { class: 'hero-center' }, h('span', { class: 'hero-figure' }, ui.pct(stats.coverage)), h('span', { class: 'hero-caption' }, t('of the loop known')))),
          h('div', { class: 'hero-side' },
            h('h2', {}, round ? round.name : t('No round')),
            h('p', { class: 'prose' }, t('{a} known targets among {b} living players. Every gap in the ring is a contract still to find.', { a: stats.knownTargets, b: stats.alive })),
            h('dl', { class: 'figures' },
              h('div', {}, h('dt', {}, t('Alive')), h('dd', {}, stats.alive, h('small', {}, ' ' + ui.pct(stats.total ? stats.alive / stats.total : 0)))),
              h('div', {}, h('dt', {}, t('Dead')), h('dd', {}, stats.dead)),
              h('div', {}, h('dt', {}, t('In the database')), h('dd', {}, stats.total, official ? h('small', {}, ' / ' + official + ' ' + t('registered')) : null)),
              school ? h('div', {}, h('dt', {}, t('Participation')), h('dd', {}, ui.pct((official || stats.total) / school), h('small', {}, ' ' + t('of the school')))) : null),
            h('a', { class: 'btn btn-primary', href: '#/chain' }, t('Open the chain')))));

        var grid = root.appendChild(h('div', { class: 'dash-grid' }));
        var allies = st.players.filter(function (p) { return p.is_ally; }).sort(function (a, b) { return a.name.localeCompare(b.name, K.i18n.lang); });
        var dead = L.deadSet(st);
        var box = h('section', { class: 'panel' }, h('h2', {}, t('The alliance')));
        if (!allies.length) box.appendChild(h('p', { class: 'empty' }, t('Open the sheet of each of your own players and tap "Alliance member": their killers and targets will show here.')));
        allies.forEach(function (p) {
          var isDead = dead.has(p.id), tg = round && !isDead ? L.resolveTarget(st, round.id, p.id) : null, k = round && !isDead ? L.resolveHunter(st, round.id, p.id) : null;
          var killer = k && k.id && store.player(k.id), target = tg && tg.id && store.player(tg.id);
          box.appendChild(h('div', { class: 'ally' + (isDead ? ' is-dead' : '') },
            personRow(p, h('span', { class: 'tag ' + (isDead ? 'tag-dead' : 'tag-alive') }, isDead ? t('Dead') : t('Alive'))),
            isDead ? null : h('div', { class: 'ally-lines' },
              h('p', {}, h('span', { class: 'muted' }, t('Hunted by') + ' '), killer ? h('button', { type: 'button', class: 'linkish threat', onclick: function () { K.actions.openPlayer(killer.id); } }, killer.name + (killer.points >= 6 ? ' (' + killer.points + ' pts)' : '')) : t('unknown')),
              h('p', {}, h('span', { class: 'muted' }, t('Hunts') + ' '), target ? h('button', { type: 'button', class: 'linkish', onclick: function () { K.actions.openPlayer(target.id); } }, target.name) : t('unknown')))));
        });
        grid.appendChild(box);

        var board = L.leaderboard(st), lb = h('section', { class: 'panel' }, h('h2', {}, t('Kill leaderboard')));
        if (!board.length) lb.appendChild(h('p', { class: 'empty' }, t('No kill attributed yet.')));
        board.slice(0, 12).forEach(function (r) { var p = store.player(r.id); if (p) lb.appendChild(personRow(p, [h('span', { class: 'rank' }, '#' + r.rank), h('strong', { class: 'count' }, r.kills)])); });
        lb.appendChild(h('p', { class: 'muted small' }, stats.unattributed ? t('{n} deaths without an identified killer: open their sheet to set one.', { n: stats.unattributed }) : t('Every death has an identified killer.')));
        grid.appendChild(lb);

        var yr = h('section', { class: 'panel' }, h('h2', {}, t('By year')));
        var max = Math.max.apply(null, Object.keys(stats.byYear).map(function (y) { return stats.byYear[y].total; }).concat([1]));
        Object.keys(stats.byYear).sort().forEach(function (y) {
          var b = stats.byYear[y];
          yr.appendChild(h('div', { class: 'bar', style: { '--year': ui.yearColor(y) } }, h('span', { class: 'bar-label' }, y),
            h('span', { class: 'bar-track' }, h('span', { class: 'bar-total', style: { width: (b.total / max * 100) + '%' } }, h('span', { class: 'bar-alive', style: { width: (b.total ? b.alive / b.total * 100 : 0) + '%' } }))),
            h('span', { class: 'bar-num' }, b.alive + ' / ' + b.total)));
        });
        yr.appendChild(h('p', { class: 'muted small' }, t('Alive out of registered.')));
        grid.appendChild(yr);

        var inc = h('section', { class: 'panel' }, h('h2', {}, t('Sheets to complete')));
        if (!stats.incomplete.length) inc.appendChild(h('p', { class: 'empty' }, t('Every living player has a class, a photo, and an address.')));
        stats.incomplete.slice(0, showAllIncomplete ? stats.incomplete.length : 8).forEach(function (p) {
          var miss = [!p.year || !p.td ? t('class') : null, !p.photo_path ? t('photo') : null, !p.address ? t('address') : null].filter(Boolean).join(', ');
          inc.appendChild(personRow(p, h('span', { class: 'muted small' }, t('missing: {x}', { x: miss }))));
        });
        if (stats.incomplete.length > 8) inc.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAllIncomplete = !showAllIncomplete; refresh(); } }, showAllIncomplete ? t('Show less') : t('Show all')));
        grid.appendChild(inc);

        var feed = h('section', { class: 'panel' }, h('h2', {}, t('Latest activity')));
        if (!st.events.length) feed.appendChild(h('p', { class: 'empty' }, t('Kills, links and rerolls recorded by the team will show here.')));
        st.events.slice(0, showAll ? 60 : 8).forEach(function (e) {
          var d = e.details || {}, has = (d.type === 'kill' && d.note) || (d.type === 'link' && d.source);
          feed.appendChild(h('button', { type: 'button', class: 'event event-' + (d.type || 'other'), title: K.actions.eventSummary(e), onclick: function () { K.actions.eventDetails(e); } },
            h('span', { class: 'event-text' }, e.text, has ? h('span', { class: 'has-note', 'aria-label': t('with a note') }, '✎') : null),
            h('span', { class: 'muted small' }, [e.actor, ui.ago(e.created_at)].filter(Boolean).join(', '))));
        });
        if (st.events.length > 8) feed.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAll = !showAll; refresh(); } }, showAll ? t('Show less') : t('Show {n} earlier entries', { n: Math.min(st.events.length, 60) - 8 })));
        grid.appendChild(feed);

        var links = (set.links || []).filter(function (l) { return ui.safeUrl(l.url); });
        if (links.length) grid.appendChild(h('section', { class: 'panel' }, h('h2', {}, t('Useful links')),
          links.map(function (l) { return h('a', { class: 'row row-btn', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'row-main' }, l.label || l.url)); })));
      }
      refresh();
      return refresh;
    }
  };
})();
