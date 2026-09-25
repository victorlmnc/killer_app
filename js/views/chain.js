(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store, t = K.t;

  K.views = K.views || {};
  K.views.chain = {
    title: t('Chain'),
    render: function (root) {
      var view = { roundId: null, mode: 'current', scope: 'one', q: '' };
      var frags = [], trayIds = [], drag = null, pending = false, justDragged = false, gone = false;
      var bar = h('div', { class: 'toolbar' }), help = h('p', { class: 'chain-help muted small' }), body = h('div', { class: 'chain' });
      root.appendChild(bar); root.appendChild(help); root.appendChild(body);

      function names(ids) { return ids.map(function (id) { var p = store.player(id); return p ? p.name : '?'; }).join(', '); }

      function bubble(p, dead, fi, pos) {
        var q = L.norm(view.q), match = q && L.norm(p.name).indexOf(q) >= 0;
        var el = h('button', { type: 'button', class: 'bubble' + (dead ? ' is-dead' : '') + (p.is_ally ? ' is-ally' : '') + (match ? ' is-match' : '') + (q && !match ? ' is-dim' : ''),
          'data-drag': store.canEdit() ? 'bubble' : null, 'data-id': p.id, 'data-frag': String(fi), 'data-pos': String(pos), title: store.canEdit() ? t('Drag to move, click to open the sheet') : null,
          onclick: function () { if (!justDragged) K.actions.openPlayer(p.id, { roundId: view.roundId }); } }, ui.avatar(p, 'lg'), h('span', { class: 'bubble-name' }, p.name));
        return el;
      }
      function arrow(edge) {
        var title = K.actions.edgeTitle(edge.links, edge.confidence) + (edge.via && edge.via.length ? ' ' + t('Dead players in between: {names}.', { names: names(edge.via) }) : '');
        return h('button', { type: 'button', class: 'thread thread-' + edge.confidence, title: title, 'aria-label': t('Link') + ', ' + title, onclick: function () { K.actions.editEdge(edge.links); } },
          h('span', { class: 'thread-line', 'aria-hidden': 'true' }), edge.via && edge.via.length ? h('span', { class: 'thread-badge' }, '†' + edge.via.length) : null);
      }

      /* ------------------------------------------------------------ drag and drop (mouse, pen, touch) */
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
        if (drag.touch) drag.timer = setTimeout(function () { if (drag && !drag.active) { activate(); if (navigator.vibrate) navigator.vibrate(12); } }, 320); // long press: a plain swipe still scrolls the page
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

      /* ---------------------------------------------------------------------------------------- render */
      function refresh() {
        if (drag && drag.active) { pending = true; return; }   // a teammate's update waits until the gesture ends
        pending = false;
        var st = store.state, rounds = L.sortedRounds(st), current = L.currentRound(st);
        var currentId = current ? current.id : null;
        // a new round (mine or a teammate's) becomes the displayed one; the old one turns into an archive
        if (currentId !== view.knownCurrent) { view.roundId = currentId; view.knownCurrent = currentId; }
        if (!view.roundId || !rounds.some(function (r) { return r.id === view.roundId; })) view.roundId = currentId;
        var archived = current && view.roundId !== current.id;

        ui.clear(bar);
        if (rounds.length) bar.appendChild(ui.select(rounds.map(function (r) { return { value: r.id, label: r.name + (r.id === current.id ? ' (' + t('current') + ')' : '') }; }), view.roundId,
          { class: 'tb-round', 'aria-label': t('Displayed round'), onchange: function (e) { view.roundId = e.target.value; refresh(); } }));
        function seg(label, key, options) {
          return h('div', { class: 'segmented', role: 'group', 'aria-label': label }, options.map(function (m) {
            return h('button', { type: 'button', class: view[key] === m[0] ? 'is-on' : '', 'aria-pressed': String(view[key] === m[0]), title: m[2] || null, onclick: function () { view[key] = m[0]; refresh(); } }, m[1]);
          }));
        }
        bar.appendChild(seg(t('Display'), 'mode', [['current', t('Current')], ['complete', t('Complete')]]));
        if (store.canEdit()) bar.appendChild(seg(t('What moves'), 'scope', [['one', t('One player'), t('Dragging a bubble moves only that player')], ['tail', t('With the rest'), t('Dragging a bubble also takes everyone after it (or hold Shift)')]]));
        bar.appendChild(h('input', { type: 'search', class: 'tb-search', placeholder: t('Find someone'), value: view.q, 'aria-label': t('Find a player in the chain'), oninput: function (e) { view.q = e.target.value; paint(); } }));
        if (store.canEdit()) bar.appendChild(h('button', { type: 'button', class: 'btn btn-push tb-reroll', onclick: K.actions.newRound }, rounds.length ? t('New reroll') : t('Start the loop')));
        help.textContent = store.canEdit() ? t('Drag a bubble to place it before or after a player (long press on a phone), or the handle to move a whole fragment. Click an arrow to set its reliability and source, or cut the link.') : t('Read-only view of the chain.');
        paint();

        function paint() {
          ui.clear(body);
          if (archived) body.appendChild(h('p', { class: 'banner' }, t('Archive: this round was replaced by a reroll. Alive and dead players are those of the time.')));
          var f = view.roundId ? L.fragments(st, view.roundId, view.mode) : { fragments: [], unplaced: st.players.filter(function (p) { return !L.deadSet(st).has(p.id); }).map(function (p) { return p.id; }) };
          var dead = view.roundId ? L.deadSet(st, view.roundId) : new Set();
          frags = f.fragments.slice().sort(function (a, b) {
            var aa = a.ids.some(function (id) { return store.player(id).is_ally; }), bb = b.ids.some(function (id) { return store.player(id).is_ally; });
            return (bb - aa) || (b.ids.length - a.ids.length);
          });
          trayIds = f.unplaced;
          if (!frags.length) body.appendChild(h('p', { class: 'empty' }, t('No known link in this round. Drag a player from the tray onto another: on the left they become the hunter, on the right the target.')));
          frags.forEach(function (fr, fi) {
            var flow = h('div', { class: 'flow' });
            // the arrow travels with the bubble it points to, so a line break never leaves an orphan arrow
            fr.ids.forEach(function (id, i) {
              flow.appendChild(h('span', { class: 'step' }, i > 0 && fr.edges[i - 1] ? arrow(fr.edges[i - 1]) : null, bubble(store.player(id), dead.has(id), fi, i)));
            });
            if (fr.closed) flow.appendChild(h('span', { class: 'step' }, arrow(fr.edges[fr.edges.length - 1]), h('span', { class: 'flow-end' }, t('back to {name}', { name: store.player(fr.ids[0]).name }))));
            else if (fr.tail) flow.appendChild(h('span', { class: 'flow-end flow-lost' }, t('trail lost after {name} (dead)', { name: names(fr.tail.via.slice(-1)) })));
            else flow.appendChild(h('span', { class: 'flow-end flow-lost' }, t('unknown target')));
            body.appendChild(h('section', { class: 'fragment', 'data-frag': String(fi) },
              h('header', { class: 'fragment-head' },
                store.canEdit() ? h('span', { class: 'grip', 'data-drag': 'fragment', 'data-frag': String(fi), title: t('Drag to move the whole fragment'), role: 'img', 'aria-label': t('Fragment handle') }, K.icon('grip')) : null,
                h('h3', {}, fr.closed ? t('Closed loop of {n}', { n: fr.ids.length }) : fr.ids.length > 1 ? t('Fragment of {n}', { n: fr.ids.length }) : t('Isolated'))), flow));
          });
          var tray = h('div', { class: 'flow flow-tray' });
          trayIds.map(store.player).sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); }).forEach(function (p) { tray.appendChild(h('span', { class: 'step' }, bubble(p, dead.has(p.id), -1, 0))); });
          body.appendChild(h('section', { class: 'fragment fragment-tray', 'data-tray': '1' },
            h('header', { class: 'fragment-head' }, h('h3', {}, trayIds.length ? t('{n} players not placed yet', { n: trayIds.length }) : t('Tray: drop a player here to take them out of the chain'))), tray));
        }
      }
      refresh();
      refresh.destroy = function () { gone = true; endDrag(false); };
      return refresh;
    }
  };
})();
