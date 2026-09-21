(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store;

  K.views = K.views || {};
  K.views.chaine = {
    title: 'Chaîne',
    render: function (root) {
      var view = { roundId: null, mode: 'current', scope: 'one', q: '' };
      var frags = [], trayIds = [], drag = null, pending = false, justDragged = false, gone = false;
      var bar = h('div', { class: 'toolbar' }), help = h('p', { class: 'chain-help muted small' }), body = h('div', { class: 'chain' });
      root.appendChild(bar); root.appendChild(help); root.appendChild(body);

      function names(ids) { return ids.map(function (id) { var p = store.player(id); return p ? p.name : '?'; }).join(', '); }

      function bubble(p, dead, fi, pos) {
        var q = L.norm(view.q), match = q && L.norm(p.name).indexOf(q) >= 0;
        var el = h('button', { type: 'button', class: 'bubble' + (dead ? ' is-dead' : '') + (p.is_ally ? ' is-ally' : '') + (match ? ' is-match' : '') + (q && !match ? ' is-dim' : ''),
          'data-drag': 'bubble', 'data-id': p.id, 'data-frag': String(fi), 'data-pos': String(pos), title: 'Glisser pour déplacer, cliquer pour ouvrir la fiche',
          onclick: function () { if (!justDragged) K.actions.openPlayer(p.id, { roundId: view.roundId }); } }, ui.avatar(p, 'lg'), h('span', { class: 'bubble-name' }, p.name));
        return el;
      }
      function arrow(edge) {
        var title = K.actions.edgeTitle(edge.links, edge.confidence) + (edge.via && edge.via.length ? ' Morts entre les deux : ' + names(edge.via) + '.' : '');
        return h('button', { type: 'button', class: 'thread thread-' + edge.confidence, title: title, 'aria-label': 'Lien, ' + title, onclick: function () { K.actions.editEdge(edge.links); } },
          h('span', { class: 'thread-line', 'aria-hidden': 'true' }), edge.via && edge.via.length ? h('span', { class: 'thread-badge' }, '†' + edge.via.length) : null);
      }

      /* ------------------------------------------------------------ glisser-déposer (souris, stylet, doigt) */
      function segmentFor(el, shift) {
        if (el.getAttribute('data-drag') === 'fragment') return frags[Number(el.getAttribute('data-frag'))].ids.slice();
        var fi = Number(el.getAttribute('data-frag')), pos = Number(el.getAttribute('data-pos')), id = el.getAttribute('data-id');
        if (fi < 0) return [id];
        return view.scope === 'tail' || shift ? frags[fi].ids.slice(pos) : [id];
      }
      function clearMarks() { Array.prototype.forEach.call(body.querySelectorAll('.drop-before, .drop-after, .drop-here'), function (el) { el.classList.remove('drop-before', 'drop-after', 'drop-here'); }); }
      function destAt(x, y) {
        var el = document.elementFromPoint(x, y); if (!el) return null;
        var b = el.closest ? el.closest('.bubble') : null, inSeg = function (id) { return drag.seg.indexOf(id) >= 0; };
        if (b && !inSeg(b.getAttribute('data-id'))) {
          var r = b.getBoundingClientRect(), before = x < r.left + r.width / 2, id = b.getAttribute('data-id'), fi = Number(b.getAttribute('data-frag')), i = Number(b.getAttribute('data-pos')), dest;
          if (fi < 0) dest = before ? { before: id } : { after: id };
          else {
            var f = frags[fi], n = f.ids.length;
            dest = before ? { after: i > 0 ? f.ids[i - 1] : (f.closed ? f.ids[n - 1] : null), before: id } : { after: id, before: i < n - 1 ? f.ids[i + 1] : (f.closed ? f.ids[0] : null) };
          }
          return { dest: dest, mark: b.parentNode, cls: before ? 'drop-before' : 'drop-after' };
        }
        var tray = el.closest ? el.closest('[data-tray]') : null;
        if (tray) return { dest: { tray: true }, mark: tray, cls: 'drop-here' };
        var sec = el.closest ? el.closest('.fragment[data-frag]') : null;
        if (sec && !b) { var fr = frags[Number(sec.getAttribute('data-frag'))]; if (fr && !fr.closed && !inSeg(fr.ids[fr.ids.length - 1])) return { dest: { after: fr.ids[fr.ids.length - 1] }, mark: sec, cls: 'drop-here' }; }
        return null;
      }
      function activate() {
        drag.active = true; drag.seg = segmentFor(drag.el, drag.shift);
        var first = store.player(drag.seg[0]);
        drag.ghost = document.body.appendChild(h('div', { class: 'drag-ghost' }, ui.avatar(first, 'sm'), h('span', {}, first.name), drag.seg.length > 1 ? h('b', {}, '+' + (drag.seg.length - 1)) : null));
        document.body.classList.add('is-dragging');
        drag.seg.forEach(function (id) { var el = body.querySelector('.bubble[data-id="' + id + '"]'); if (el) el.classList.add('is-moving'); });
        moveGhost(); scrollLoop();
      }
      function moveGhost() { if (drag && drag.ghost) drag.ghost.style.transform = 'translate(' + (drag.x + 14) + 'px,' + (drag.y + 14) + 'px)'; }
      function scrollLoop() {
        if (!drag || !drag.active) return;
        if (drag.y < 70) window.scrollBy(0, -14); else if (drag.y > window.innerHeight - 110) window.scrollBy(0, 14);
        requestAnimationFrame(scrollLoop);
      }
      function endDrag(commit) {
        if (!drag) return;
        clearTimeout(drag.timer);
        var d = drag; drag = null;
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel);
        if (d.ghost) d.ghost.remove();
        document.body.classList.remove('is-dragging'); clearMarks();
        Array.prototype.forEach.call(body.querySelectorAll('.is-moving'), function (el) { el.classList.remove('is-moving'); });
        if (d.active) { justDragged = true; setTimeout(function () { justDragged = false; }, 0); }
        if (commit && d.active && d.hit) K.actions.applyMove(view.roundId, view.mode, d.seg, d.hit.dest).then(function () { if (!gone) refresh(); });
        else if (pending && !gone) refresh();
      }
      function onDown(e) {
        var el = e.target.closest ? e.target.closest('[data-drag]') : null;
        if (!el || (e.pointerType === 'mouse' && e.button !== 0) || drag) return;
        drag = { el: el, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, touch: e.pointerType === 'touch', shift: e.shiftKey, active: false, hit: null };
        if (drag.touch) drag.timer = setTimeout(function () { if (drag && !drag.active) { activate(); if (navigator.vibrate) navigator.vibrate(12); } }, 320); // appui long : un simple glissé du doigt fait défiler la page
        window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
      }
      function onMove(e) {
        if (!drag) return;
        drag.x = e.clientX; drag.y = e.clientY;
        var dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
        if (!drag.active) { if (drag.touch) { if (dist > 10) endDrag(false); return; } if (dist < 6) return; activate(); }
        e.preventDefault(); moveGhost(); clearMarks();
        drag.hit = destAt(e.clientX, e.clientY);
        if (drag.hit) drag.hit.mark.classList.add(drag.hit.cls);
      }
      function onUp() { endDrag(true); }
      function onCancel() { endDrag(false); }
      function onTouchMove(e) { if (drag && drag.active && e.cancelable) e.preventDefault(); }
      body.addEventListener('pointerdown', onDown);
      body.addEventListener('touchmove', onTouchMove, { passive: false });
      body.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('[data-drag]')) e.preventDefault(); });
      body.addEventListener('dragstart', function (e) { e.preventDefault(); });

      /* ---------------------------------------------------------------------------------------- affichage */
      function refresh() {
        if (drag && drag.active) { pending = true; return; }   // une mise à jour d'un coéquipier attend la fin du geste
        pending = false;
        var st = store.state, rounds = L.sortedRounds(st), current = L.currentRound(st);
        var currentId = current ? current.id : null;
        // nouvelle boucle créée (par moi ou par un coéquipier) : on y bascule, l'ancienne devient une archive
        if (currentId !== view.knownCurrent) { view.roundId = currentId; view.knownCurrent = currentId; }
        if (!view.roundId || !rounds.some(function (r) { return r.id === view.roundId; })) view.roundId = currentId;
        var archived = current && view.roundId !== current.id;

        ui.clear(bar);
        if (rounds.length) bar.appendChild(ui.select(rounds.map(function (r) { return { value: r.id, label: r.name + (r.id === current.id ? ' (en cours)' : '') }; }), view.roundId,
          { class: 'tb-round', 'aria-label': 'Boucle affichée', onchange: function (e) { view.roundId = e.target.value; refresh(); } }));
        function seg(label, key, options) {
          return h('div', { class: 'segmented', role: 'group', 'aria-label': label }, options.map(function (m) {
            return h('button', { type: 'button', class: view[key] === m[0] ? 'is-on' : '', 'aria-pressed': String(view[key] === m[0]), title: m[2] || null, onclick: function () { view[key] = m[0]; refresh(); } }, m[1]);
          }));
        }
        bar.appendChild(seg('Affichage', 'mode', [['current', 'Actuelle'], ['complete', 'Complète']]));
        bar.appendChild(seg('Ce qu\'on déplace', 'scope', [['one', 'Un joueur', 'Glisser une bulle ne déplace qu\'elle'], ['tail', 'Avec la suite', 'Glisser une bulle emmène aussi tous ceux qui la suivent (ou maintiens Maj)']]));
        bar.appendChild(h('input', { type: 'search', class: 'tb-search', placeholder: 'Repérer quelqu\'un', value: view.q, 'aria-label': 'Repérer un joueur dans la chaîne', oninput: function (e) { view.q = e.target.value; paint(); } }));
        bar.appendChild(h('button', { type: 'button', class: 'btn btn-push tb-reroll', onclick: K.actions.newRound }, rounds.length ? 'Nouveau reroll' : 'Démarrer la boucle'));
        help.textContent = 'Glisse une bulle pour la placer avant ou après un joueur (appui long sur téléphone), la poignée ⠿ pour un fragment entier. Clique une flèche pour régler sa fiabilité, sa source, ou couper le lien.';
        paint();

        function paint() {
          ui.clear(body);
          if (archived) body.appendChild(h('p', { class: 'banner' }, 'Archive : cette boucle a été remplacée par un reroll. Les vivants et les morts sont ceux de l\'époque.'));
          var f = view.roundId ? L.fragments(st, view.roundId, view.mode) : { fragments: [], unplaced: st.players.filter(function (p) { return !L.deadSet(st).has(p.id); }).map(function (p) { return p.id; }) };
          var dead = view.roundId ? L.deadSet(st, view.roundId) : new Set();
          frags = f.fragments.slice().sort(function (a, b) {
            var aa = a.ids.some(function (id) { return store.player(id).is_ally; }), bb = b.ids.some(function (id) { return store.player(id).is_ally; });
            return (bb - aa) || (b.ids.length - a.ids.length);
          });
          trayIds = f.unplaced;
          if (!frags.length) body.appendChild(h('p', { class: 'empty' }, 'Aucun lien connu dans cette boucle. Glisse un joueur du bac sur un autre : à gauche il devient son chasseur, à droite sa cible.'));
          frags.forEach(function (fr, fi) {
            var flow = h('div', { class: 'flow' });
            // la flèche voyage avec la bulle qu'elle désigne : à la ligne, on lit « → cible » et jamais une flèche orpheline
            fr.ids.forEach(function (id, i) {
              flow.appendChild(h('span', { class: 'step' }, i > 0 && fr.edges[i - 1] ? arrow(fr.edges[i - 1]) : null, bubble(store.player(id), dead.has(id), fi, i)));
            });
            if (fr.closed) flow.appendChild(h('span', { class: 'step' }, arrow(fr.edges[fr.edges.length - 1]), h('span', { class: 'flow-end' }, 'revient à ' + store.player(fr.ids[0]).name)));
            else if (fr.tail) flow.appendChild(h('span', { class: 'flow-end flow-lost' }, 'piste perdue après ' + names(fr.tail.via.slice(-1)) + ' (mort)'));
            else flow.appendChild(h('span', { class: 'flow-end flow-lost' }, 'cible inconnue'));
            body.appendChild(h('section', { class: 'fragment', 'data-frag': String(fi) },
              h('header', { class: 'fragment-head' },
                h('span', { class: 'grip', 'data-drag': 'fragment', 'data-frag': String(fi), title: 'Glisser pour déplacer tout le fragment', role: 'img', 'aria-label': 'Poignée du fragment' }, '⠿'),
                h('h3', {}, fr.closed ? 'Boucle fermée de ' + fr.ids.length : fr.ids.length > 1 ? 'Fragment de ' + fr.ids.length : 'Isolé')), flow));
          });
          var tray = h('div', { class: 'flow flow-tray' });
          trayIds.map(store.player).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).forEach(function (p) { tray.appendChild(h('span', { class: 'step' }, bubble(p, dead.has(p.id), -1, 0))); });
          body.appendChild(h('section', { class: 'fragment fragment-tray', 'data-tray': '1' },
            h('header', { class: 'fragment-head' }, h('h3', {}, trayIds.length ? trayIds.length + ' joueurs pas encore placés' : 'Bac : dépose ici un joueur pour le sortir de la chaîne')), tray));
        }
      }
      refresh();
      refresh.destroy = function () { gone = true; endDrag(false); };
      return refresh;
    }
  };
})();
