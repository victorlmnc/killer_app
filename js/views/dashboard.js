(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store;
  var SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) { var el = document.createElementNS(SVG, tag); Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); }); return el; }

  /* L'anneau : un point par joueur vivant, un arc rouge là où on connaît le lien. Les trous sont ce qu'il reste à trouver. */
  function ring(st, round) {
    var f = L.fragments(st, round.id, 'current');
    var frags = f.fragments.slice().sort(function (a, b) { return b.ids.length - a.ids.length; });
    var n = f.nodeCount, R = 130, C = 160, slot = 0;
    var svg = s('svg', { viewBox: '0 0 320 320', class: 'ring', role: 'img', 'aria-label': 'Boucle actuelle : ' + n + ' joueurs vivants, ' + frags.length + ' fragments connus' });
    svg.appendChild(s('circle', { cx: C, cy: C, r: R, class: 'ring-track' }));
    if (!n) return svg;
    var step = 2 * Math.PI / n, dotR = Math.max(2.2, Math.min(7, (2 * Math.PI * R / n) * 0.3));
    function pt(i) { var a = i * step - Math.PI / 2; return [C + R * Math.cos(a), C + R * Math.sin(a)]; }
    function arc(i, j, conf) {
      var a = pt(i), b = pt(j);
      svg.appendChild(s('path', { d: 'M' + a[0] + ' ' + a[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + b[0] + ' ' + b[1], class: 'ring-link ring-' + conf }));
    }
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

  function personRow(p, right) {
    return h('button', { type: 'button', class: 'row row-btn', onclick: function () { K.actions.openPlayer(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name), right);
  }

  K.views = K.views || {};
  K.views.dashboard = {
    title: 'Dashboard',
    render: function (root) {
      function refresh() {
        var st = store.state, set = st.settings, stats = L.stats(st), round = L.currentRound(st);
        ui.clear(root);
        if (!st.players.length) {
          root.appendChild(h('section', { class: 'panel panel-empty' }, h('h2', {}, 'La base est vide'),
            h('p', { class: 'prose' }, 'Dès que la liste des inscrits est connue, importe-la depuis ton tableur ou ajoute les joueurs un par un.'),
            h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: K.actions.importDialog }, 'Importer des joueurs'),
              h('button', { type: 'button', class: 'btn', onclick: function () { K.actions.editPlayer(null); } }, 'Ajouter un joueur'))));
          return;
        }
        var official = Number(set.official_players) || 0, school = Number(set.school_total) || 0;

        var hero = h('section', { class: 'panel hero' },
          h('div', { class: 'hero-ring' }, round ? ring(st, round) : null,
            h('div', { class: 'hero-center' }, h('span', { class: 'hero-figure' }, ui.pct(stats.coverage)), h('span', { class: 'hero-caption' }, 'de la boucle reconstituée'))),
          h('div', { class: 'hero-side' },
            h('h2', {}, round ? round.name : 'Aucune boucle'),
            h('p', { class: 'prose' }, stats.knownTargets + ' cibles connues sur ' + stats.alive + ' joueurs vivants. Chaque trou dans l\'anneau est un contrat qu\'il reste à découvrir.'),
            h('dl', { class: 'figures' },
              h('div', {}, h('dt', {}, 'Vivants'), h('dd', {}, stats.alive, h('small', {}, ' ' + ui.pct(stats.total ? stats.alive / stats.total : 0)))),
              h('div', {}, h('dt', {}, 'Morts'), h('dd', {}, stats.dead)),
              h('div', {}, h('dt', {}, 'Dans la base'), h('dd', {}, stats.total, official ? h('small', {}, ' / ' + official + ' inscrits') : null)),
              school ? h('div', {}, h('dt', {}, 'Participation'), h('dd', {}, ui.pct((official || stats.total) / school), h('small', {}, ' de l\'école'))) : null),
            h('a', { class: 'btn btn-primary', href: '#/chaine' }, 'Ouvrir la chaîne')));
        root.appendChild(hero);

        var grid = root.appendChild(h('div', { class: 'dash-grid' }));

        /* Nos joueurs : qui nous chasse, qui on chasse */
        var allies = st.players.filter(function (p) { return p.is_ally; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); });
        var dead = L.deadSet(st);
        var box = h('section', { class: 'panel' }, h('h2', {}, 'L\'alliance'));
        if (!allies.length) box.appendChild(h('p', { class: 'empty' }, 'Ouvre la fiche de chacun d\'entre vous et touche « Membre de l\'alliance » : vos killers et vos cibles s\'afficheront ici.'));
        allies.forEach(function (p) {
          var isDead = dead.has(p.id), t = round && !isDead ? L.resolveTarget(st, round.id, p.id) : null, k = round && !isDead ? L.resolveHunter(st, round.id, p.id) : null;
          var killer = k && k.id && store.player(k.id), target = t && t.id && store.player(t.id);
          box.appendChild(h('div', { class: 'ally' + (isDead ? ' is-dead' : '') },
            personRow(p, h('span', { class: 'tag ' + (isDead ? 'tag-dead' : 'tag-alive') }, isDead ? 'Mort' : 'Vivant')),
            isDead ? null : h('div', { class: 'ally-lines' },
              h('p', {}, h('span', { class: 'muted' }, 'Chassé par '), killer ? h('button', { type: 'button', class: 'linkish threat', onclick: function () { K.actions.openPlayer(killer.id); } }, killer.name + (killer.points >= 6 ? ' (' + killer.points + ' pts)' : '')) : 'inconnu'),
              h('p', {}, h('span', { class: 'muted' }, 'Chasse '), target ? h('button', { type: 'button', class: 'linkish', onclick: function () { K.actions.openPlayer(target.id); } }, target.name) : 'inconnu'))));
        });
        grid.appendChild(box);

        /* Classement */
        var board = L.leaderboard(st), lb = h('section', { class: 'panel' }, h('h2', {}, 'Classement des kills'));
        if (!board.length) lb.appendChild(h('p', { class: 'empty' }, 'Aucun kill attribué pour l\'instant.'));
        board.slice(0, 12).forEach(function (r) { var p = store.player(r.id); if (p) lb.appendChild(personRow(p, [h('span', { class: 'rank' }, r.label), h('strong', { class: 'count' }, r.kills)])); });
        lb.appendChild(h('p', { class: 'muted small' }, stats.unattributed ? stats.unattributed + ' mort' + (stats.unattributed > 1 ? 's' : '') + ' sans killer identifié : ouvre leur fiche pour l\'indiquer.' : 'Tous les morts ont un killer identifié.'));
        grid.appendChild(lb);

        /* Par année */
        var yr = h('section', { class: 'panel' }, h('h2', {}, 'Par année'));
        var max = Math.max.apply(null, Object.keys(stats.byYear).map(function (y) { return stats.byYear[y].total; }).concat([1]));
        Object.keys(stats.byYear).sort().forEach(function (y) {
          var b = stats.byYear[y];
          yr.appendChild(h('div', { class: 'bar', style: { '--year': ui.yearColor(y) } }, h('span', { class: 'bar-label' }, y),
            h('span', { class: 'bar-track' }, h('span', { class: 'bar-total', style: { width: (b.total / max * 100) + '%' } }, h('span', { class: 'bar-alive', style: { width: (b.total ? b.alive / b.total * 100 : 0) + '%' } }))),
            h('span', { class: 'bar-num' }, b.alive + ' / ' + b.total)));
        });
        yr.appendChild(h('p', { class: 'muted small' }, 'Vivants sur inscrits.'));
        grid.appendChild(yr);

        /* Fiches incomplètes */
        var inc = h('section', { class: 'panel' }, h('h2', {}, 'Fiches à compléter'));
        if (!stats.incomplete.length) inc.appendChild(h('p', { class: 'empty' }, 'Tous les vivants ont une classe et une photo.'));
        stats.incomplete.slice(0, 8).forEach(function (p) {
          var miss = [!p.year || !p.td ? 'classe' : null, !p.photo_path ? 'photo' : null].filter(Boolean).join(', ');
          inc.appendChild(personRow(p, h('span', { class: 'muted small' }, 'manque : ' + miss)));
        });
        if (stats.incomplete.length > 8) inc.appendChild(h('p', { class: 'muted small' }, 'et ' + (stats.incomplete.length - 8) + ' autres.'));
        grid.appendChild(inc);

        /* Activité + liens */
        var feed = h('section', { class: 'panel' }, h('h2', {}, 'Dernières infos'));
        if (!st.events.length) feed.appendChild(h('p', { class: 'empty' }, 'Les kills, liens et rerolls saisis par l\'équipe apparaîtront ici.'));
        st.events.slice(0, 10).forEach(function (e) { feed.appendChild(h('p', { class: 'event' }, e.text, h('span', { class: 'muted small' }, ' ' + [e.actor, ui.ago(e.created_at)].filter(Boolean).join(', ')))); });
        grid.appendChild(feed);

        var links = (set.links || []).filter(function (l) { return ui.safeUrl(l.url); });
        if (links.length) grid.appendChild(h('section', { class: 'panel' }, h('h2', {}, 'Liens utiles'),
          links.map(function (l) { return h('a', { class: 'row row-btn', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'row-main' }, l.label || l.url)); })));
      }
      refresh();
      return refresh;
    }
  };
})();
