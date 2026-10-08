(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;
  var SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) { var el = document.createElementNS(SVG, tag); Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); }); return el; }

  /* One dot per living player, a red arc where the link is known, an arrowhead pointing from killer to target
     (clockwise). Gaps are what is left to find. */
  function ring(st, round) {
    var f = L.fragments(st, round.id, 'current');
    var frags = f.fragments.slice().sort(function (a, b) { return b.ids.length - a.ids.length; });
    var n = f.nodeCount, R = 130, C = 160, slot = 0;
    var svg = s('svg', { viewBox: '0 0 320 320', class: 'ring', role: 'img', 'aria-label': t('Current loop: {a} players alive, {b} known fragments', { a: n, b: frags.length }) });
    svg.appendChild(s('circle', { cx: C, cy: C, r: R, class: 'ring-track' }));
    if (!n) return svg;
    var step = 2 * Math.PI / n, dotR = Math.max(2.2, Math.min(7, (2 * Math.PI * R / n) * 0.3));
    function pt(i) { var a = i * step - Math.PI / 2; return [C + R * Math.cos(a), C + R * Math.sin(a)]; }
    var gap = 2 * Math.PI * R / n, fits = Math.min(6, (gap - 2 * dotR - 1) / 1.7), spaced = fits >= 2.4, head = spaced ? fits : 4.5, arrows = [];   // the head fits between two dots, or the dots are packed
    function arc(i, j, conf) {
      var a = pt(i), b = pt(j); svg.appendChild(s('path', { d: 'M' + a[0] + ' ' + a[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + b[0] + ' ' + b[1], class: 'ring-link ring-' + conf }));
      arrows.push({ at: (i + j) / 2, conf: conf });
    }
    /* an arrowhead on the circle at slot position `at`, pointing clockwise (towards the target) */
    function arrow(at, conf) {
      var ang = at * step - Math.PI / 2, x = C + R * Math.cos(ang), y = C + R * Math.sin(ang);
      var tx = -Math.sin(ang), ty = Math.cos(ang), nx = Math.cos(ang), ny = Math.sin(ang);   // along the circle, and outwards
      var tip = [x + tx * head, y + ty * head], l = [x - tx * head * 0.7 + nx * head * 0.8, y - ty * head * 0.7 + ny * head * 0.8], r = [x - tx * head * 0.7 - nx * head * 0.8, y - ty * head * 0.7 - ny * head * 0.8];
      svg.appendChild(s('path', { d: 'M' + tip.join(' ') + 'L' + l.join(' ') + 'L' + r.join(' ') + 'Z', class: 'ring-arrow ring-arrow-' + conf }));
    }
    var dots = [];
    frags.forEach(function (fr) {
      var start = slot;
      fr.ids.forEach(function (id, i) { dots.push({ id: id, i: slot }); if (i < fr.edges.length && i < fr.ids.length - 1) arc(slot, slot + 1, fr.edges[i].confidence); slot++; });
      if (fr.closed && fr.ids.length === n && n > 1) arc(slot - 1, start + n, fr.edges[fr.edges.length - 1].confidence);
    });
    f.unplaced.forEach(function (id) { dots.push({ id: id, i: slot++, loose: true }); });
    // one arrowhead per link while there is room between two dots; when they are packed, one in the middle of each run
    if (spaced) arrows.forEach(function (a) { arrow(a.at, a.conf); });
    else { var runs = [], cur = null; arrows.forEach(function (a) { if (cur && a.at === cur.last + 1) { cur.list.push(a); cur.last = a.at; } else runs.push(cur = { list: [a], last: a.at }); });
      runs.forEach(function (r) { var mid = r.list[Math.floor(r.list.length / 2)]; arrow(mid.at, mid.conf); }); }
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
  function personRow(p, right) { return h('button', { type: 'button', class: 'row row-btn', onclick: function () { K.actions.openPlayer(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name), right ? h('span', { class: 'row-aside' }, right) : null); }   // the aside wraps instead of overflowing

  /* What we know about the players outside the alliance: one bar per piece of information, then addresses by year. */
  function meter(label, value, total, color) {
    var share = total ? value / total : 0;
    return h('div', { class: 'bar bar-wide', style: { '--year': color } },
      h('span', { class: 'bar-label' }, label),
      h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-total' }, h('span', { class: 'bar-value', style: { width: (share * 100).toFixed(1) + '%' } }))),
      h('span', { class: 'bar-num' }, value + ' / ' + total + ' · ' + ui.pct(share)));
  }
  function collectedBlock(c, years, yc) {
    var box = h('div', { class: 'collected' }, h('h3', {}, t('Information gathered')));
    if (!c.total) { box.appendChild(h('p', { class: 'empty' }, t('No player outside the alliance.'))); return box; }
    box.appendChild(h('p', { class: 'muted small' }, t('On the {n} players outside the alliance, dead or alive.', { n: c.total })));
    var ink = 'var(--ink)';
    box.appendChild(h('div', { class: 'stack-tight' },
      meter(t('Address'), c.address, c.total, ink), meter(t('Located on the map'), c.located, c.total, ink),
      meter(t('Photo'), c.photo, c.total, ink), meter(t('Class (year and TD)'), c.cls, c.total, ink), meter(t('Weapons'), c.weapons, c.total, ink)));
    box.appendChild(h('h3', {}, t('Addresses by year')));
    box.appendChild(h('div', { class: 'stack-tight' }, years.filter(function (y) { return c.byYear[y]; }).map(function (y) {
      return meter(y === '?' ? t('Not set') : y, c.byYear[y].address, c.byYear[y].total, yc(y));
    })));
    var housing = L.ADDRESS_TYPES.filter(function (x) { return c.housing[x.id]; }).map(function (x) { return t(x.plural) + ' ' + c.housing[x.id]; });
    if (housing.length) box.appendChild(h('p', { class: 'muted small' }, t('Known addresses: {list}', { list: housing.join(' · ') })));
    return box;
  }

  // One page-scroll listener for the dashboard carousel: scrolling up lets a tall track shrink to its current block.
  var fitPage = null, pageTick = false;
  window.addEventListener('scroll', function () {
    if (!fitPage || pageTick) return; pageTick = true;
    requestAnimationFrame(function () { pageTick = false; if (fitPage) fitPage(); });
  }, { passive: true });

  /* The signed-in player's own situation, when their account is linked to a sheet (profile > My sheet). */
  function meBar(st, round) {
    var me = store.me(), p = store.myPlayer();
    if (!p) {
      if (!me || !store.canEdit()) return null;
      return h('p', { class: 'me-hint muted small' }, t('Link your account to your player sheet to see your target and act quickly.'), ' ',
        h('button', { type: 'button', class: 'linkish', onclick: K.actions.profileDialog }, t('Choose my sheet')));
    }
    var dead = L.deadSet(st).has(p.id), open = K.actions.openPlayer;
    function who(label, res) {
      var other = res && res.id && store.player(res.id);
      return h('div', { class: 'me-rel' }, h('span', { class: 'relation-label' }, label),
        other ? h('button', { type: 'button', class: 'row row-btn', onclick: function () { open(other.id); } }, ui.avatar(other, 'sm'),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, other.name), h('span', { class: 'row-sub' }, ui.confLabel(res.confidence)), ui.bonusTags(other, true)), ui.statusTag(other, true))
          : h('p', { class: 'muted small' }, label === t('My target') ? t('Unknown target') : t('Unknown killer')));
    }
    var target = round && !dead ? L.resolveTarget(st, round.id, p.id) : null, hunter = round && !dead ? L.resolveHunter(st, round.id, p.id) : null;
    var targetPlayer = target && target.id && store.player(target.id);
    return h('section', { class: 'panel me' },
      h('div', { class: 'me-head' }, ui.avatar(p), h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, dead ? t('Dead') : ui.pointsText(p))),
        h('div', { class: 'me-actions' },
          h('button', { type: 'button', class: 'btn', onclick: function () { open(p.id); } }, t('My sheet')),
          !dead && store.canEdit() ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { K.actions.killDialog(p.id); } }, t('I am dead')) : null)),
      dead ? null : h('div', { class: 'me-rels' }, who(t('My target'), target), who(t('My hunter'), hunter)),
      targetPlayer && !targetPlayer.is_ally ? h('div', { class: 'me-sched' },   // tanking an ally: no need to know where they are
 h('div', { class: 'row me-sched-head' }, h('span', { class: 'relation-label row-main' }, t('Where is my target')),
        store.calendarsFor(targetPlayer).length ? h('span', { class: 'me-sched-links' },
          h('button', { type: 'button', class: 'linkish small', onclick: function () { ui.openWeek(targetPlayer); } }, t('See the week')),
          h('button', { type: 'button', class: 'linkish small', onclick: function () { K.actions.catchDialog(targetPlayer.id); } }, t('When to catch them'))) : null), ui.schedule(targetPlayer, true) || h('p', { class: 'muted small' }, t('No timetable applies to this player yet.'))) : null);
  }

  /* The latest intel on living players, every sheet together (nothing when there is none). */
  function intelPanel(st) {
    var dead = L.deadSet(st), list = (st.intel || []).filter(function (x) { return !dead.has(x.player_id) && store.player(x.player_id); })
      .sort(function (a, b) { return Date.parse(b.seen_at) - Date.parse(a.seen_at); }).slice(0, 6);
    if (!list.length) return null;
    return h('section', { class: 'panel intel-panel' }, h('h2', {}, t('Latest intel')),
      list.map(function (x) {
        var p = store.player(x.player_id);
        return h('button', { type: 'button', class: 'row row-btn', onclick: function () { K.actions.openPlayer(p.id); } }, ui.avatar(p, 'sm'),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name), h('span', { class: 'row-sub' }, x.text),
            h('span', { class: 'row-sub muted' }, [x.place, ui.ago(x.seen_at), x.author].filter(Boolean).join(' · '))));
      }));
  }
  /* What threatens the alliance right now (K.logic.dangerAlerts), most serious first; nothing when all is calm. */
  function alertsPanel(st) {
    var list = L.dangerAlerts(st);
    if (!list.length) return null;
    function who(id) { var p = store.player(id); return h('button', { type: 'button', class: 'linkish', onclick: function () { K.actions.openPlayer(id); } }, p ? p.name : '?'); }
    function when(b) { return K.logic.bonusStatus(b) === 'active' ? t('until {date}', { date: ui.whenShort(b.ends_at) }) : t('from {date}', { date: ui.whenShort(b.starts_at) }); }
    var ICON = { high: '!', warn: '!', info: 'i' }, groups = [];
    var cutthroats = (st.settings.shop || []).filter(function (i) { return /coupe/i.test(i.name); }).sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
    function pts(id) { var p = store.player(id); return p ? K.logic.pointsRange(st, p).max : 0; }   // at most: a kill with a weapon of unknown difficulty may count more
    function priced(i) { return t('a {bonus} ({price} pts)', { bonus: i.name, price: i.price || 0 }); }
    function afford(points) {   // "can afford a Super Coupe-Gorge (8 pts) or a Coupe-Gorge (6 pts)", or what is missing for the cheapest
      var can = cutthroats.filter(function (i) { return points >= (i.price || 0); });
      if (can.length) return h('strong', { class: 'alert-afford' }, t('can afford {list}', { list: can.map(priced).join(' ' + t('or') + ' ') }));
      var cheapest = cutthroats[cutthroats.length - 1];
      return h('span', { class: 'muted' }, t('{n} pts missing for {bonus}', { n: (cheapest.price || 0) - points, bonus: priced(cheapest) }));
    }
    // one block per hunter and ally (or per ally and their immune target), every reason listed in it
    list.forEach(function (a) {
      if (/^unknown-/.test(a.kind)) return groups.push({ key: 'unknown|' + a.bonus.id, level: a.level, kind: a.kind, reasons: [a] });   // a bonus whose buyer nobody knows
      var key = (a.kind === 'immune' ? 'target|' : 'hunter|') + a.allyId + '|' + a.otherId, g = groups.find(function (x) { return x.key === key; });
      if (!g) groups.push(g = { key: key, level: a.level, kind: a.kind === 'immune' ? 'immune' : 'hunter', allyId: a.allyId, otherId: a.otherId, reasons: [] });
      g.reasons.push(a);   // the list is sorted by gravity: the first one gives the colour
    });
    return h('section', { class: 'panel alerts', role: 'status' }, h('h2', {}, t('Alerts'), h('small', { class: 'muted' }, ' ' + groups.length)),
      groups.map(function (g) {
        if (/^unknown-/.test(g.kind)) {
          var b = g.reasons[0].bonus, cut = g.kind === 'unknown-cutthroat';
          return h('div', { class: 'alert alert-' + g.level }, h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, ICON[g.level]),
            h('div', { class: 'alert-body' }, h('p', {}, (cut ? t('Someone unknown has a {bonus}', { bonus: b.name }) : t('Someone unknown is immune ({bonus})', { bonus: b.name })) + ' ', h('span', { class: 'muted' }, when(b))),
              h('ul', { class: 'alert-reasons' }, h('li', {}, cut ? t('Any of us may be the target. Say who bought it from the Shop once you know.') : t('It may be one of our targets. Say who bought it from the Shop once you know.')))));
        }
        var head = g.kind === 'immune' ? [t('The target of') + ' ', who(g.allyId), ', ', who(g.otherId), ', ' + t('is immune') + ' ', h('span', { class: 'muted' }, when(g.reasons[0].bonus))]
          : [who(g.otherId), ' ', h('span', { class: 'muted' }, '(' + ui.pointsText(store.player(g.otherId) || {}) + ')'), ' ' + t('hunts') + ' ', who(g.allyId)];
        var lines = g.kind === 'immune' ? [] : g.reasons.filter(function (a) { return a.kind !== 'rich'; }).map(function (a) {
          return h('li', {}, a.kind === 'cutthroat' ? [t('has a {bonus}', { bonus: a.bonus.name }) + ' ', h('span', { class: 'muted' }, when(a.bonus))] : t('is marked dangerous'));
        });
        var other = store.player(g.otherId);
        if (g.kind === 'hunter' && other && other.is_mystery) lines.push(h('li', {}, h('span', { class: 'muted' }, t('Not identified yet: their points are unknown.'))));
        else if (g.kind === 'hunter' && cutthroats.length) lines.push(h('li', {}, afford(pts(g.otherId))));   // always: what their points can buy
        return h('div', { class: 'alert alert-' + g.level }, h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, ICON[g.level]),
          h('div', { class: 'alert-body' }, h('p', {}, head), lines.length ? h('ul', { class: 'alert-reasons' }, lines) : null));
      }));
  }

  K.views = K.views || {};
  K.views.dashboard = {
    title: t('Dashboard'),
    render: function (root) {
      var showAll = false, showAllIncomplete = false, showAllBoard = false, leaderboardMode = 'kills', slide = 0;
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
          if (!swiping) fit();
        }
        /* The track takes the height of the current block, not the tallest one, and follows it when its content changes.
           It never shrinks by more than the page can lose without moving (arriving on a short block must not throw the
           page back to the top); the rest goes as the reader scrolls up. No resize mid-swipe: it breaks the snapping. */
        var ro = window.ResizeObserver ? new ResizeObserver(function () { fit(); }) : null, swiping = false, settle = null;
        function fit() {
          if (!track.isConnected) { if (ro) ro.disconnect(); if (fitPage === fit) fitPage = null; return; }   // replaced by a re-render
          var cs = getComputedStyle(track), c = slides[slide].el;
          var want = c.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), now = track.offsetHeight;
          if (want < now) { var slack = document.documentElement.scrollHeight - window.innerHeight - window.scrollY; want = Math.max(want, now - Math.max(0, slack)); }
          if (Math.abs(want - now) > 1) track.style.height = want + 'px';
        }
        if (ro) slides.forEach(function (sl) { ro.observe(sl.el); });
        fitPage = fit;
        var ticking = false;
        track.addEventListener('scroll', function () {   // swiping: the slide nearest to the centre becomes current
          swiping = true; clearTimeout(settle);
          settle = setTimeout(function () { swiping = false; fit(); }, 160);   // scroll (and snap) has come to rest
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
        var alerts = alertsPanel(st);
        if (alerts) root.appendChild(alerts);
        var news = intelPanel(st);
        if (news) root.appendChild(news);
        var mine = meBar(st, round);
        if (mine) root.appendChild(mine);
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

        /* Where the players we are after are right now: the alliance's targets, then priority targets. */
        var wanted = [];
        function want(p, why) { if (p && !dead.has(p.id) && !p.is_ally && !wanted.some(function (w) { return w.p.id === p.id; })) wanted.push({ p: p, why: why }); }
        allies.forEach(function (a) { var tg = round && !dead.has(a.id) ? L.resolveTarget(st, round.id, a.id) : null; if (tg && tg.id) want(store.player(tg.id), t('target of {name}', { name: a.name })); });
        st.players.filter(function (p) { return p.status === 'priority'; }).forEach(function (p) { want(p, t('Priority target')); });
        var where = h('section', { class: 'panel' }, h('h2', {}, t('Where are the targets')));
        if (!(set.calendars || []).length) where.appendChild(h('p', { class: 'empty' }, t('Add the timetable links in Settings to see where the targets are.')));
        else if (!wanted.length) where.appendChild(h('p', { class: 'empty' }, t('No known target yet for the alliance.')));
        else wanted.forEach(function (w) {
          where.appendChild(h('div', { class: 'ally' }, personRow(w.p, ui.statusTag(w.p, true)),
            h('div', { class: 'ally-lines' }, h('p', { class: 'muted small' }, w.why), ui.bonusTags(w.p, true), ui.schedule(w.p, true) || h('p', { class: 'muted small' }, t('No timetable applies to this player yet.')))));
        });
        grid.appendChild(where);

        var board = L.leaderboard(st), visibleBoard = board.slice(0, showAllBoard ? board.length : 10), adminRow = board.find(function (r) { return r.admin; });
        if (adminRow && visibleBoard.indexOf(adminRow) < 0) visibleBoard.push(adminRow);
        var boardTitle = h('h2', {}, t('Ranking'));
        var boardMode = h('div', { class: 'segmented', role: 'group', 'aria-label': t('Choose ranking') }, [['kills', t('Kills')], ['general', t('General')]].map(function (m) {
          return h('button', { type: 'button', class: leaderboardMode === m[0] ? 'is-on' : '', 'aria-pressed': String(leaderboardMode === m[0]), onclick: function () { leaderboardMode = m[0]; showAllBoard = false; refresh(); } }, m[1]);
        }));
        var lb = h('section', { class: 'panel board' }, h('div', { class: 'panel-head' }, boardTitle, boardMode));
        /* One line of the ranking: rank (podium in gold, silver, bronze), photo, name and points, score on the right */
        function boardRow(rank, who, sub, score, onclick) {
          return h('button', { type: 'button', class: 'row row-btn board-row' + (rank && rank <= 3 ? ' is-podium rank-' + rank : ''), onclick: onclick },
            h('span', { class: 'board-rank' }, rank ? String(rank) : '–'), who, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, sub[0]), sub[1] ? h('span', { class: 'row-sub' }, sub[1]) : null), score);
        }
        function scoreOf(n) { return h('span', { class: 'board-score' }, h('strong', {}, String(n)), h('small', {}, n === 1 ? t('kill') : t('kills'))); }
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
            if (r.admin) { var adminLine = boardRow(null, h('span', { class: 'leader-admin-mark', 'aria-hidden': 'true' }, K.icon('settings')), [t('Admin'), t('Administrative eliminations')], scoreOf(r.kills), showAdminEliminations); adminLine.classList.add('leaderboard-admin'); return lb.appendChild(adminLine); }
            var p = store.player(r.id); if (!p) return;
            lb.appendChild(boardRow(r.rank, ui.avatar(p, 'sm'), [p.name, ui.pointsText(p) + (dead.has(p.id) ? ' · ' + t('dead') : '')], scoreOf(r.kills), function () { K.actions.openPlayer(p.id); }));
          });
          var killers = board.filter(function (r) { return !r.admin; }).length;
          if (killers > 10) lb.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAllBoard = !showAllBoard; refresh(); } }, showAllBoard ? t('Show less') : t('Show all ({n})', { n: killers })));
          lb.appendChild(h('p', { class: 'muted small' }, stats.unattributed ? t('{n} deaths without an identified killer: open their sheet to set one.', { n: stats.unattributed }) : t('Every death has an identified killer.')));
        } else {
          var general = L.generalRanking(st);
          general.slice(0, showAllBoard ? general.length : 10).forEach(function (r) {
            var p = store.player(r.id);
            if (!p) return;
            lb.appendChild(boardRow(r.alive ? null : r.rank, ui.avatar(p, 'sm'), [p.name, ui.pointsText(p)],
              r.alive ? h('span', { class: 'tag tag-alive' }, t('Still in the game')) : null, function () { K.actions.openPlayer(p.id); }));
          });
          if (!general.length) lb.appendChild(h('p', { class: 'empty' }, t('No players yet')));
          if (general.length > 10) lb.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { showAllBoard = !showAllBoard; refresh(); } }, showAllBoard ? t('Show less') : t('Show all ({n})', { n: general.length })));
        }
        grid.appendChild(lb);

        var years = Object.keys(stats.byYear).sort(), yc = function (y) { return ui.yearColor(y) === 'var(--muted)' ? '#8A93A0' : ui.yearColor(y); };
        var adminKills = st.kills.filter(function (k) { return !k.killer_id && k.admin_reason; }).length, unknownKills = st.kills.filter(function (k) { return !k.killer_id && !k.admin_reason; }).length;
        var killItems = years.map(function (y) { return { label: y === '?' ? t('Not set') : y, value: stats.killsByYear[y] || 0, color: yc(y) }; })
          .concat([{ label: t('Admin'), value: adminKills, color: '#ff3b4b' }, { label: t('Unknown killer'), value: unknownKills, color: '#55555c' }]);
        var stat = h('section', { class: 'panel' }, h('h2', {}, t('Statistics')), h('div', { class: 'pies' },
          h('div', { class: 'pie-block' }, h('h3', {}, t('Alive players by year')), K.charts.pie3d(years.map(function (y) { return { label: y === '?' ? t('Not set') : y, value: stats.byYear[y].alive, color: yc(y) }; }), { label: t('Alive players by year'), caption: t('Total: {n}', { n: stats.alive }) })),
          h('div', { class: 'pie-block' }, h('h3', {}, t('Kills by year')), K.charts.pie3d(killItems, { label: t('Kills by year') })),
          h('div', { class: 'pie-block' }, h('h3', {}, t('Registered players by year')), K.charts.pie3d(years.map(function (y) { return { label: y === '?' ? t('Not set') : y, value: stats.byYear[y].total, color: yc(y) }; }), { label: t('Registered players by year') }))),
          h('p', { class: 'muted small' }, t('Hover a slice for the detail; click a legend entry to hide it.')));
        stat.appendChild(collectedBlock(stats.collected, years, yc));
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
