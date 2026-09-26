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
      var showAll = false, showAllIncomplete = false, showAllGeneral = false, leaderboardMode = 'kills', slide = 0;
      /* Blocks below the hero live in a swipeable carousel; the active slide survives re-renders. */
      function carousel(slides) {
        var track = h('div', { class: 'carousel-track', tabindex: '0', 'aria-label': t('Dashboard blocks') }), dots = h('div', { class: 'carousel-dots', role: 'tablist' });
        slides.forEach(function (sl, i) {
          sl.el.classList.add('slide'); sl.el.setAttribute('role', 'tabpanel'); track.appendChild(sl.el);
          dots.appendChild(h('button', { type: 'button', role: 'tab', class: 'carousel-dot' + (i === slide ? ' is-on' : ''), 'aria-selected': String(i === slide), 'aria-label': sl.title, onclick: function () { go(i, true); } }, h('span', {}, sl.title)));
        });
        /* Positions are measured against the track itself: offsetLeft would be relative to the page on wide layouts. */
        function leftOf(el) { return el.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft; }
        function go(i, smooth) {
          slide = Math.max(0, Math.min(slides.length - 1, i));
          var target = slides[slide].el;
          track.scrollTo({ left: leftOf(target) - (track.clientWidth - target.clientWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
          mark();
        }
        function mark() {
          Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('is-on', i === slide); d.setAttribute('aria-selected', String(i === slide)); });
          Array.prototype.forEach.call(track.children, function (c, i) { c.classList.toggle('is-current', i === slide); });
          prev.disabled = slide === 0; next.disabled = slide === slides.length - 1;
        }
        var ticking = false;
        track.addEventListener('scroll', function () {   // swiping: the slide nearest to the centre becomes current
          if (ticking) return; ticking = true;
          requestAnimationFrame(function () {
            ticking = false;
            var mid = track.scrollLeft + track.clientWidth / 2, best = 0, dist = Infinity;
            Array.prototype.forEach.call(track.children, function (c, i) { var d = Math.abs(leftOf(c) + c.clientWidth / 2 - mid); if (d < dist) { dist = d; best = i; } });
            if (best !== slide) { slide = best; mark(); }
          });
        });
        track.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') go(slide + 1, true); if (e.key === 'ArrowLeft') go(slide - 1, true); });
        var prev = h('button', { type: 'button', class: 'carousel-arrow', 'aria-label': t('Previous block'), onclick: function () { go(slide - 1, true); } }, K.icon('chevron', 'ic-left'));
        var next = h('button', { type: 'button', class: 'carousel-arrow', 'aria-label': t('Next block'), onclick: function () { go(slide + 1, true); } }, K.icon('chevron', 'ic-right'));
        var el = h('div', { class: 'carousel' }, h('div', { class: 'carousel-head' }, prev, dots, next), track);
        requestAnimationFrame(function () { go(slide, false); });
        return el;
      }
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

        var slides = [], grid = { appendChild: function (el) { slides.push({ title: el.querySelector('h2').textContent, el: el }); } };
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

        var board = L.leaderboard(st), visibleBoard = board.slice(0, 12), adminRow = board.find(function (r) { return r.admin; });
        if (adminRow && visibleBoard.indexOf(adminRow) < 0) visibleBoard.push(adminRow);
        var boardTitle = h('h2', {}, t('Ranking'));
        var boardMode = ui.select([{ value: 'kills', label: t('Kills') }, { value: 'general', label: t('General') }], leaderboardMode, {
          'aria-label': t('Choose ranking'), onchange: function (e) { leaderboardMode = e.target.value; showAllGeneral = false; refresh(); }
        });
        var lb = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, boardTitle, boardMode));
        function showAdminEliminations() {
          var adminKills = st.kills.filter(function (kill) { return !!kill.admin_reason; }).sort(function (a, b) { return b.happened_at.localeCompare(a.happened_at); });
          ui.dialog({ title: t('Admin eliminations'), render: function (body) {
            if (!adminKills.length) body.appendChild(h('p', { class: 'empty' }, t('No administrative eliminations yet.')));
            adminKills.forEach(function (kill) {
              var victim = store.player(kill.victim_id);
              if (!victim) return;
              var reason = t(kill.admin_reason === 'cheating' ? 'Cheating' : 'Other');
              body.appendChild(h('button', { type: 'button', class: 'row row-btn', onclick: function () { K.actions.openPlayer(victim.id); } },
                ui.avatar(victim, 'sm'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, victim.name), h('span', { class: 'row-sub' }, reason + (kill.note ? ' · ' + kill.note : ''))),
                h('span', { class: 'muted small' }, ui.when(kill.happened_at))));
            });
          } });
        }
        if (leaderboardMode === 'kills') {
          if (!board.length) lb.appendChild(h('p', { class: 'empty' }, t('No kill attributed yet.')));
          visibleBoard.forEach(function (r) {
            var rank = [h('span', { class: 'rank' }, '#' + r.rank), h('strong', { class: 'count' }, r.kills)];
            if (r.admin) lb.appendChild(h('button', { type: 'button', class: 'row row-btn leaderboard-admin', 'aria-label': t('Admin eliminations'), onclick: showAdminEliminations }, h('span', { class: 'leader-admin-mark', 'aria-hidden': 'true' }, K.icon('settings')), h('span', { class: 'row-main' }, t('Admin')), rank));
            else { var p = store.player(r.id); if (p) lb.appendChild(personRow(p, rank)); }
          });
          lb.appendChild(h('p', { class: 'muted small' }, stats.unattributed ? t('{n} deaths without an identified killer: open their sheet to set one.', { n: stats.unattributed }) : t('Every death has an identified killer.')));
        } else {
          var general = L.generalRanking(st);
          general.slice(0, showAllGeneral ? general.length : 12).forEach(function (r) {
            var p = store.player(r.id);
            if (!p) return;
            var place = r.alive ? h('span', { class: 'tag tag-alive' }, t('Still in the game')) : h('span', { class: 'rank' }, '#' + r.rank);
            lb.appendChild(personRow(p, place));
          });
          if (!general.length) lb.appendChild(h('p', { class: 'empty' }, t('No players yet')));
          if (general.length > 12) lb.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAllGeneral = !showAllGeneral; refresh(); } }, showAllGeneral ? t('Show less') : t('Show all')));
        }
        grid.appendChild(lb);

        var years = Object.keys(stats.byYear).sort(), yc = function (y) { return ui.yearColor(y) === 'var(--muted)' ? '#8A93A0' : ui.yearColor(y); };
        var adminKills = st.kills.filter(function (k) { return !k.killer_id && k.admin_reason; }).length, unknownKills = st.kills.filter(function (k) { return !k.killer_id && !k.admin_reason; }).length;
        var killItems = years.map(function (y) { return { label: y === '?' ? t('Not set') : t('Year') + ' ' + y, value: stats.killsByYear[y] || 0, color: yc(y) }; })
          .concat([{ label: t('Admin'), value: adminKills, color: '#ff3b4b' }, { label: t('Unknown killer'), value: unknownKills, color: '#55555c' }]);
        var stat = h('section', { class: 'panel' }, h('h2', {}, t('Statistics')), h('div', { class: 'pies' },
          h('div', { class: 'pie-block' }, h('h3', {}, t('Alive players by year')), K.charts.pie3d(years.map(function (y) { return { label: y === '?' ? t('Not set') : t('Year') + ' ' + y, value: stats.byYear[y].alive, color: yc(y) }; }), { label: t('Alive players by year'), caption: t('Total: {n}', { n: stats.alive }) })),
          h('div', { class: 'pie-block' }, h('h3', {}, t('Kills by year')), K.charts.pie3d(killItems, { label: t('Kills by year') })),
          h('div', { class: 'pie-block' }, h('h3', {}, t('Registered players by year')), K.charts.pie3d(years.map(function (y) { return { label: y === '?' ? t('Not set') : t('Year') + ' ' + y, value: stats.byYear[y].total, color: yc(y) }; }), { label: t('Registered players by year') }))),
          h('p', { class: 'muted small' }, t('Hover a slice for the detail; click a legend entry to hide it.')));
        grid.appendChild(stat);

        var inc = h('section', { class: 'panel' }, h('h2', {}, t('Sheets to complete')));
        if (!stats.incomplete.length) inc.appendChild(h('p', { class: 'empty' }, t('Every living player has a class, a photo, and an address.')));
        stats.incomplete.slice(0, showAllIncomplete ? stats.incomplete.length : 12).forEach(function (p) {
          var miss = [!p.year || !p.td ? t('class') : null, !p.photo_path ? t('photo') : null, !p.address ? t('address') : null].filter(Boolean).join(', ');
          inc.appendChild(personRow(p, h('span', { class: 'muted small' }, t('missing: {x}', { x: miss }))));
        });
        if (stats.incomplete.length > 12) inc.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAllIncomplete = !showAllIncomplete; refresh(); } }, showAllIncomplete ? t('Show less') : t('Show all')));
        grid.appendChild(inc);

        var feed = h('section', { class: 'panel' }, h('h2', {}, t('Latest activity')));
        if (!st.events.length) feed.appendChild(h('p', { class: 'empty' }, t('Kills, links and rerolls recorded by the team will show here.')));
        st.events.slice(0, showAll ? 80 : 15).forEach(function (e) {
          var d = e.details || {}, has = (d.type === 'kill' && d.note) || (d.type === 'link' && d.source);
          feed.appendChild(h('button', { type: 'button', class: 'event event-' + (d.type || 'other'), title: K.actions.eventSummary(e), onclick: function () { K.actions.eventDetails(e); } },
            h('span', { class: 'event-text' }, e.text, has ? h('span', { class: 'has-note', 'aria-label': t('with a note') }, '✎') : null),
            h('span', { class: 'muted small' }, [e.actor, ui.ago(e.created_at)].filter(Boolean).join(', '))));
        });
        if (st.events.length > 15) feed.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAll = !showAll; refresh(); } }, showAll ? t('Show less') : t('Show {n} earlier entries', { n: Math.min(st.events.length, 80) - 15 })));
        var links = (set.links || []).filter(function (l) { return ui.safeUrl(l.url); });
        if (links.length) feed.appendChild(h('div', { class: 'stack' }, h('h3', {}, t('Useful links')),
          links.map(function (l) { return h('a', { class: 'row row-btn', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'row-main' }, l.label || l.url)); })));
        grid.appendChild(feed);
        root.appendChild(carousel(slides));
      }
      refresh();
      return refresh;
    }
  };
})();
