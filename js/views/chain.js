(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store;

  K.views = K.views || {};
  K.views.chaine = {
    title: 'Chaîne',
    render: function (root) {
      var view = { roundId: null, mode: 'current', linking: false, from: null, q: '' };
      var bar = h('div', { class: 'toolbar' }), hint = h('p', { class: 'link-hint', hidden: true }), body = h('div', { class: 'chain' });
      root.appendChild(bar); root.appendChild(hint); root.appendChild(body);

      function names(ids) { return ids.map(function (id) { var p = store.player(id); return p ? p.name : '?'; }).join(', '); }

      function tap(p) {
        if (!view.linking) return K.actions.openPlayer(p.id, { roundId: view.roundId });
        if (!view.from) { view.from = p.id; return refresh(); }
        if (view.from === p.id) { view.from = null; return refresh(); }
        var from = view.from; view.from = null;
        K.actions.askLink(from, p.id, { roundId: view.roundId, raw: view.mode === 'complete' }).then(refresh);
      }

      function bubble(p, dead) {
        var q = L.norm(view.q), match = q && L.norm(p.name).indexOf(q) >= 0;
        return h('button', { type: 'button', class: 'bubble' + (dead ? ' is-dead' : '') + (p.is_ally ? ' is-ally' : '') + (view.from === p.id ? ' is-from' : '') + (match ? ' is-match' : '') + (q && !match ? ' is-dim' : ''),
          onclick: function () { tap(p); } }, ui.avatar(p, 'lg'), h('span', { class: 'bubble-name' }, p.name));
      }
      function arrow(edge) {
        var title = ui.confLabel[edge.confidence] + (edge.source ? ', ' + edge.source : '') + (edge.via && edge.via.length ? '. Morts entre les deux : ' + names(edge.via) : '');
        return h('span', { class: 'thread thread-' + edge.confidence, title: title, role: 'img', 'aria-label': 'chasse (' + title + ')' },
          edge.via && edge.via.length ? h('span', { class: 'thread-badge' }, '†' + edge.via.length) : null);
      }

      function refresh() {
        var st = store.state, rounds = L.sortedRounds(st), current = L.currentRound(st);
        var currentId = current ? current.id : null;
        // nouvelle boucle créée (par moi ou par un coéquipier) : on y bascule, l'ancienne devient une archive
        if (currentId !== view.knownCurrent) { view.roundId = currentId; view.knownCurrent = currentId; view.from = null; }
        if (!view.roundId || !rounds.some(function (r) { return r.id === view.roundId; })) view.roundId = currentId;
        var archived = current && view.roundId !== current.id;

        ui.clear(bar);
        if (rounds.length) bar.appendChild(ui.select(rounds.map(function (r) { return { value: r.id, label: r.name + (r.id === current.id ? ' (en cours)' : '') }; }), view.roundId,
          { class: 'tb-round', 'aria-label': 'Boucle affichée', onchange: function (e) { view.roundId = e.target.value; view.from = null; refresh(); } }));
        bar.appendChild(h('div', { class: 'segmented', role: 'group', 'aria-label': 'Affichage' },
          [['current', 'Actuelle'], ['complete', 'Complète']].map(function (m) {
            return h('button', { type: 'button', class: view.mode === m[0] ? 'is-on' : '', 'aria-pressed': String(view.mode === m[0]), onclick: function () { view.mode = m[0]; refresh(); } }, m[1]);
          })));
        bar.appendChild(h('button', { type: 'button', class: 'btn' + (view.linking ? ' btn-primary' : ''), 'aria-pressed': String(view.linking),
          onclick: function () { view.linking = !view.linking; view.from = null; refresh(); } }, view.linking ? 'Terminer' : 'Relier'));
        var search = h('input', { type: 'search', class: 'tb-search', placeholder: 'Repérer quelqu\'un', value: view.q, 'aria-label': 'Repérer un joueur dans la chaîne',
          oninput: function (e) { view.q = e.target.value; paint(); } });
        bar.appendChild(search);
        bar.appendChild(h('button', { type: 'button', class: 'btn btn-push tb-reroll', onclick: K.actions.newRound }, rounds.length ? 'Nouveau reroll' : 'Démarrer la boucle'));

        hint.hidden = !view.linking;
        hint.textContent = view.from ? 'Maintenant, touche la cible de ' + (store.player(view.from) || {}).name + '.' : 'Touche d\'abord le chasseur, puis sa cible.';
        paint();

        function paint() {
          ui.clear(body);
          if (!view.roundId) { body.appendChild(h('p', { class: 'empty' }, 'Aucune boucle pour l\'instant. Démarre-la quand les contrats tombent.')); return; }
          if (archived) body.appendChild(h('p', { class: 'banner' }, 'Archive : cette boucle a été remplacée par un reroll. Les vivants et les morts sont ceux de l\'époque.'));
          var f = L.fragments(st, view.roundId, view.mode), dead = L.deadSet(st, view.roundId);
          var frags = f.fragments.slice().sort(function (a, b) {
            var aa = a.ids.some(function (id) { return store.player(id).is_ally; }), bb = b.ids.some(function (id) { return store.player(id).is_ally; });
            return (bb - aa) || (b.ids.length - a.ids.length);
          });
          if (!frags.length) body.appendChild(h('p', { class: 'empty' }, 'Aucun lien connu dans cette boucle. Passe en mode « Relier », ou ouvre une fiche et définis sa cible.'));
          frags.forEach(function (fr) {
            var flow = h('div', { class: 'flow' });
            // la flèche voyage avec la bulle qu'elle désigne : à la ligne, on lit « → cible » et jamais une flèche orpheline
            fr.ids.forEach(function (id, i) {
              flow.appendChild(h('span', { class: 'step' }, i > 0 && fr.edges[i - 1] ? arrow(fr.edges[i - 1]) : null, bubble(store.player(id), dead.has(id))));
            });
            if (fr.closed) flow.appendChild(h('span', { class: 'step' }, arrow(fr.edges[fr.edges.length - 1]), h('span', { class: 'flow-end' }, 'revient à ' + store.player(fr.ids[0]).name)));
            else if (fr.tail) flow.appendChild(h('span', { class: 'flow-end flow-lost' }, 'piste perdue après ' + names(fr.tail.via.slice(-1)) + ' (mort)'));
            else flow.appendChild(h('span', { class: 'flow-end flow-lost' }, 'cible inconnue'));
            body.appendChild(h('section', { class: 'fragment' },
              h('h3', {}, fr.closed ? 'Boucle fermée de ' + fr.ids.length : fr.ids.length > 1 ? 'Fragment de ' + fr.ids.length : 'Isolé'), flow));
          });
          if (f.unplaced.length) {
            var tray = h('div', { class: 'flow flow-tray' });
            f.unplaced.map(store.player).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).forEach(function (p) { tray.appendChild(bubble(p, dead.has(p.id))); });
            body.appendChild(h('section', { class: 'fragment' }, h('h3', {}, f.unplaced.length + ' joueurs pas encore placés'), tray));
          }
        }
      }
      refresh();
      return refresh;
    }
  };
})();
