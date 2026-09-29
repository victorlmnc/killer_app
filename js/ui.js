/* Small DOM helpers: element builder, dialogs, toasts, avatars, player picker. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var ui = K.ui = {}, t = K.t;

  /* Every piece of content goes through text nodes: nothing typed by a user is parsed as HTML. */
  function h(tag, attrs) {
    var el = document.createElement(tag), value;
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { el.style.setProperty(p, v[p]); });
      else if (k === 'value') value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (function add(kids) {
      kids.forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return add(c);
        el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(Array.prototype.slice.call(arguments, 2));
    if (value !== undefined) el.value = value;
    return el;
  }
  ui.h = h;
  /* Views redraw by clearing and rebuilding their content, which makes the page jump to the top and drops focus.
     Clearing anything inside the view pins the scroll position (and the focused control, found again by id or
     aria-label) until the rebuild is done. Changing tab calls ui.releaseScroll so a new tab still opens at the top. */
  var pin = null;
  function holdScroll(el) {
    var active = document.activeElement, focus = null;
    if (active && active !== el && el.contains(active)) focus = { tag: active.tagName, id: active.id, label: active.getAttribute('aria-label') };
    if (pin) { if (focus && !pin.focus) pin.focus = focus; return; }
    var p = pin = { y: window.scrollY, focus: focus };
    function restore() {
      if (pin !== p) return;
      var f = p.focus, again = null;
      if (f && (f.id || f.label) && !document.querySelector('dialog[open]')) {
        again = f.id ? document.getElementById(f.id) : document.querySelector('main.view ' + f.tag + '[aria-label="' + f.label.replace(/["\\]/g, '\\$&') + '"]');
        if (again && again !== document.activeElement) again.focus({ preventScroll: true });
        p.focus = null;
      }
      if (window.scrollY !== p.y) window.scrollTo(0, p.y);
    }
    Promise.resolve().then(restore);                                                                 // right after the rebuild
    requestAnimationFrame(function () { restore(); if (pin === p) pin = null; });                   // after layout-dependent code (carousel)
  }
  ui.releaseScroll = function () { pin = null; };
  ui.clear = function (el) {
    if (el.firstChild && el.closest && el.closest('main.view')) holdScroll(el);
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };

  ui.toast = function (text, kind) {
    // A modal <dialog> lives in the top layer: the toast has to move there to stay visible.
    var open = document.querySelectorAll('dialog[open]'), parent = open.length ? open[open.length - 1] : document.body;
    var host = document.getElementById('toasts') || h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    if (host.parentNode !== parent) parent.appendChild(host);
    var el = host.appendChild(h('div', { class: 'toast' + (kind ? ' toast-' + kind : '') }, text));
    setTimeout(function () { el.remove(); }, kind === 'error' ? 6000 : 3200);
  };

  /* Bottom sheet on phones, centred panel on larger screens. */
  ui.dialog = function (opts) {
    var dlg = h('dialog', { class: 'sheet' + (opts.wide ? ' sheet-wide' : '') });
    function close() { if (dlg.open) dlg.close(); }
    dlg.addEventListener('close', function () { dlg.remove(); if (opts.onClose) opts.onClose(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    var body = h('div', { class: 'sheet-body' });
    dlg.appendChild(h('div', { class: 'sheet-inner' },
      h('header', { class: 'sheet-head' }, h('h2', {}, opts.title || ''), h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: close }, K.icon('close'))),
      body));
    document.body.appendChild(dlg);
    var api = { el: dlg, body: body, close: close, setTitle: function (s) { dlg.querySelector('h2').textContent = s; } };
    if (opts.render) opts.render(body, api);
    dlg.showModal();
    return api;
  };

  ui.confirm = function (o) {
    return new Promise(function (resolve) {
      var answered = false;
      ui.dialog({
        title: o.title, onClose: function () { if (!answered) resolve(false); },
        render: function (body, api) {
          (Array.isArray(o.text) ? o.text : [o.text]).forEach(function (line) { body.appendChild(h('p', { class: 'prose' }, line)); });
          body.appendChild(h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); } }, t('Cancel')),
            h('button', { type: 'button', class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), onclick: function () { answered = true; resolve(true); api.close(); } }, o.action || t('Confirm'))));
        }
      });
    });
  };

  ui.field = function (label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  };
  ui.select = function (options, value, attrs) {
    return h('select', Object.assign({ value: value == null ? '' : value }, attrs || {}), options.map(function (o) {
      var opt = typeof o === 'string' ? { value: o, label: o } : o;
      return h('option', { value: opt.value, disabled: !!opt.disabled }, opt.label);
    }));
  };

  ui.yearColor = function (year) {
    var y = (K.store.state.settings.years || []).find(function (x) { return x.name === year; });
    return y ? y.color : 'var(--muted)';
  };
  ui.initials = function (name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var first = parts[0] || '?', last = parts.length > 1 ? parts[parts.length - 1] : '';
    return (first[0] + (last[0] || '')).toUpperCase();
  };
  ui.avatar = function (p, size) {
    var url = K.store.photoUrl(p && (p.photo_path || p.avatar_path));
    var el = h('span', { class: 'avatar' + (size ? ' avatar-' + size : ''), style: { '--year': ui.yearColor(p && p.year) } });
    if (url) el.appendChild(h('img', { src: url, alt: '', loading: 'lazy' }));
    else el.appendChild(h('span', { 'aria-hidden': 'true' }, ui.initials(p && p.name)));
    return el;
  };
  ui.yearTag = function (p) {
    var text = [p.year, p.dept, p.td].filter(Boolean).join(' ');
    return text ? h('span', { class: 'tag tag-year', style: { '--year': ui.yearColor(p.year) } }, text) : null;
  };
  /* A weapon as a tag coloured by its catalogue difficulty (green easy, brass hard, grey unknown); the text says it too. */
  ui.weaponDifficulty = function (name) {
    var n = K.logic.norm(name), w = K.store.state.weapons.find(function (x) { return K.logic.norm(x.name) === n; });
    return w ? w.difficulty : null;
  };
  ui.weaponTag = function (name, small) {
    var d = ui.weaponDifficulty(name), label = d === 'difficile' ? t('hard') : d === 'facile' ? t('easy') : t('unknown difficulty');
    return h('span', { class: 'tag tag-weapon tag-' + (d || 'none') + (small ? ' tag-sm' : ''), title: name + ' (' + label + ')' },
      K.icon('weapons', 'ic-sm'), name, small ? h('span', { class: 'sr-only' }, ' (' + label + ')') : h('span', { class: 'tag-weapon-level' }, label));
  };
  /* Weapons of a sheet as removable tags, plus a search that offers catalogue weapons first (same spelling everywhere,
     no duplicates) and a new weapon only when nothing matches. .value is the usual comma-separated text. */
  var pickers = 0;
  ui.weaponPicker = function (text, opts) {
    // opts: { onChange(), check(name, names) -> reason it cannot be added or null, max }
    opts = opts || {};
    var L = K.logic, names = L.weaponList(text), items = [], active = 0, id = 'wpick-' + (++pickers);
    var tags = h('div', { class: 'wpick-tags' }), msg = h('p', { class: 'field-hint danger', role: 'alert', hidden: true });
    var input = h('input', { type: 'text', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': id, 'aria-label': t('Add a weapon'),
      oninput: function () { say(''); suggest(); }, onkeydown: key, onblur: function () { setTimeout(close, 150); } });
    var list = h('ul', { class: 'wpick-list', role: 'listbox', id: id, hidden: true });
    function say(text) { msg.textContent = text; msg.hidden = !text; }
    function full() { return opts.max && names.length >= opts.max; }
    function changed() {
      drawTags();
      input.disabled = full(); input.placeholder = full() ? t('{n} weapons at most', { n: opts.max }) : t('Add a weapon…');
      if (opts.onChange) opts.onChange();
    }
    function drawTags() {
      ui.clear(tags);
      names.forEach(function (n, i) {
        tags.appendChild(h('span', { class: 'wpick-item' }, ui.weaponTag(n, true),
          h('button', { type: 'button', class: 'wpick-remove', 'aria-label': t('Remove {w}', { w: n }), onclick: function () { names.splice(i, 1); say(''); changed(); input.focus(); } }, '×')));
      });
    }
    function resolve(name) {   // typed text -> the catalogue spelling when it is the same weapon
      var m = L.matchWeapons(name, K.store.state.weapons)[0];
      return m && m.how === 'exact' ? m.weapon.name : name.trim();
    }
    function add(name) {
      name = resolve(name);
      input.value = ''; close();   // before onChange, so the half-typed search is never read as a weapon
      if (!name || names.some(function (n) { return L.norm(n) === L.norm(name); })) return input.focus();
      var why = opts.check && opts.check(name, names.slice());
      if (why) { say(why); return input.focus(); }
      say(''); names.push(name); changed();
      if (!input.disabled) input.focus();
    }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function suggest() {
      var q = input.value.trim();
      ui.clear(list); items = []; active = 0;
      if (!q) return close();
      var found = L.matchWeapons(q, K.store.state.weapons, names).slice(0, 7);
      items = found.map(function (m) { return { name: m.weapon.name, how: m.how, why: opts.check && opts.check(m.weapon.name, names.slice()) }; });
      if (!found.some(function (m) { return m.how === 'exact'; }) && !names.some(function (n) { return L.norm(n) === L.norm(q); })) items.push({ name: q, isNew: true });
      items.forEach(function (it, i) {
        list.appendChild(h('li', { id: id + '-' + i, role: 'option', class: 'wpick-option' + (it.isNew ? ' is-new' : '') + (it.why ? ' is-blocked' : ''), 'aria-disabled': it.why ? 'true' : null,
          onmousedown: function (e) { e.preventDefault(); }, onclick: function () { add(it.name); } },
          it.isNew ? [K.icon('plus', 'ic-sm'), t('Add "{w}" as a new weapon', { w: it.name })]
            : [ui.weaponTag(it.name, true), it.why ? h('span', { class: 'muted small' }, it.why) : it.how === 'close' ? h('span', { class: 'muted small' }, t('similar spelling')) : null]));
      });
      list.hidden = !items.length; input.setAttribute('aria-expanded', String(!!items.length));
      mark();
    }
    function mark() {
      Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle('is-active', i === active); li.setAttribute('aria-selected', String(i === active)); });
      if (items.length) input.setAttribute('aria-activedescendant', id + '-' + active);
    }
    function key(e) {
      var open = !list.hidden && items.length;
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); active = (active + 1) % items.length; mark(); }
      else if (e.key === 'ArrowUp' && open) { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
      else if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); add(open ? items[active].name : input.value); }
      else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Backspace' && !input.value && names.length) { names.pop(); say(''); changed(); }
    }
    drawTags(); input.disabled = full(); input.placeholder = full() ? t('{n} weapons at most', { n: opts.max }) : t('Add a weapon…');
    return {
      el: h('div', { class: 'wpick' }, tags, h('div', { class: 'wpick-search' }, input, list), msg), input: input,
      names: function () { return names.slice(); },
      get value() { var pending = input.value.trim() && resolve(input.value), all = names.slice(); if (pending && !all.some(function (n) { return L.norm(n) === L.norm(pending); })) all.push(pending); return all.join(', '); }
    };
  };
  /* Special status of a sheet: dangerous (red) or priority target (brass). */
  ui.STATUSES = [{ id: 'dangerous', label: 'Dangerous' }, { id: 'priority', label: 'Priority target' }];
  ui.statusTag = function (p, small) {
    var s = p && ui.STATUSES.find(function (x) { return x.id === p.status; });
    return s ? h('span', { class: 'tag tag-status tag-' + s.id + (small ? ' tag-sm' : '') }, t(s.label)) : null;
  };

  /* ----- timetable ----- */
  // Times are Paris times (K.logic.TIME_ZONE), wherever the phone is: the game is in France.
  function loc() { return K.i18n.lang === 'fr' ? 'fr-FR' : 'en-GB'; }
  function fmt(d, o) { return d.toLocaleString(loc(), Object.assign({ timeZone: K.logic.TIME_ZONE }, o)); }
  function hm(d) { return fmt(d, { hour: '2-digit', minute: '2-digit' }); }
  function dayLabel(d) { var s = fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  function sameDay(a, b) { return K.logic.parisDay(a) === K.logic.parisDay(b); }
  function dayStart(date, plusDays) { var p = K.logic.parisParts(date); return K.logic.parisDate(p.y, p.m, p.d + (plusDays || 0), 0, 0); }
  // HyperPlanning colours by kind of class: lecture (purple), TD (blue), TP (green), special event (orange)
  var KINDS = ['cm', 'td', 'tp', 'event'];
  function kindLabel(k) { return { cm: t('Lecture'), td: 'TD', tp: 'TP', event: t('Event') }[k]; }
  function kindTag(e) { var k = K.logic.classKind(e); return h('span', { class: 'kind-tag kind-' + k }, kindLabel(k)); }
  function classText(e) { return [e.subject || e.summary, e.location].filter(Boolean).join(' · '); }
  function shortDate(d) { return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function whenNext(e, now) {
    if (e.allDay) return t('from {date}', { date: shortDate(e.start) });   // holidays: a date, no time
    var tomorrow = dayStart(now, 1);
    if (sameDay(e.start, now)) return t('at {time}', { time: hm(e.start) });
    if (sameDay(e.start, tomorrow)) return t('tomorrow at {time}', { time: hm(e.start) });
    return shortDate(e.start) + ' ' + hm(e.start);
  }
  /* Where a player is now and next, from every timetable layer that applies to them (year, department, TD, TP,
     language group, options). compact: short lines, and nothing at all when no layer applies. */
  ui.schedule = function (p, compact) {
    if (!K.store.calendarsFor(p).length) {
      if (compact) return null;
      return h('p', { class: 'muted small sched' }, p.year ? t('No timetable applies to this player yet.') : t('The year is needed for the timetable.'),
        p.year && K.store.isAdmin() ? [' ', h('a', { class: 'linkish', href: '#/settings' }, t('Add the links'))] : null);
    }
    var box = h('div', { class: 'sched' + (compact ? ' sched-compact' : '') }, h('span', { class: 'muted small' }, t('Loading the timetable…')));
    K.store.playerEvents(p).then(function (res) {
      if (!box.isConnected && box.parentNode) return;
      var events = res.events, now = new Date(), s = K.logic.scheduleAt(events, now);
      ui.clear(box);
      if (s.current) box.appendChild(h('p', { class: 'sched-line sched-now' }, h('span', { class: 'sched-label' }, t('Now')), kindTag(s.current), classText(s.current), h('span', { class: 'muted' }, ' · ' + (s.current.allDay ? t('until {date}', { date: shortDate(new Date(s.current.end - 1)) }) : t('until {time}', { time: hm(s.current.end) })))));
      if (s.next && (!compact || !s.current)) box.appendChild(h('p', { class: 'sched-line' }, h('span', { class: 'sched-label' }, t('Next')), kindTag(s.next), classText(s.next), h('span', { class: 'muted' }, ' · ' + whenNext(s.next, now))));
      if (!s.current && !s.next) box.appendChild(h('p', { class: 'muted small' }, t('No upcoming class in this timetable.')));
      if (res.failed) box.appendChild(h('p', { class: 'muted small' }, K.n(res.failed, '{n} timetable could not be loaded.', '{n} timetables could not be loaded.')));
      if (!compact) box.appendChild(h('button', { type: 'button', class: 'linkish small', onclick: function () { ui.weekDialog(p, events); } }, t('See the week')));
    }).catch(function (err) {
      ui.clear(box).appendChild(h('p', { class: 'muted small' }, t('Timetable unavailable: {err}', { err: err.message || err })));
    });
    return box;
  };
  ui.weekDialog = function (p, events) {
    var today = new Date(), monday = dayStart(today, -K.logic.parisParts(today).wd);   // Monday 00:00, Paris time
    ui.dialog({ title: t('Timetable of {name}', { name: p.name }), render: function (body) {
      function draw() {
        ui.clear(body);
        var end = dayStart(monday, 7);
        var head = h('div', { class: 'row week-nav' },
          h('button', { type: 'button', class: 'btn', 'aria-label': t('Previous week'), onclick: function () { monday = dayStart(monday, -7); draw(); } }, K.icon('chevron', 'ic-left')),
          h('strong', { class: 'row-main' }, t('Week of {date}', { date: fmt(monday, { day: 'numeric', month: 'long' }) })),
          h('button', { type: 'button', class: 'btn', 'aria-label': t('Next week'), onclick: function () { monday = dayStart(monday, 7); draw(); } }, K.icon('chevron', 'ic-right')));
        body.appendChild(head);
        body.appendChild(h('div', { class: 'kind-legend' }, KINDS.map(function (k) { return h('span', { class: 'kind-tag kind-' + k }, kindLabel(k)); })));
        var week = events.filter(function (e) { return e.end > monday && e.start < end; }), now = new Date();
        if (!week.length) body.appendChild(h('p', { class: 'empty' }, t('No class this week.')));
        for (var d = 0; d < 7; d++) {
          var day = dayStart(monday, d);
          var dayEnd = dayStart(day, 1), list = week.filter(function (e) { return e.allDay ? e.start < dayEnd && e.end > day : sameDay(e.start, day); });   // holidays: every day they cover
          if (!list.length) continue;
          body.appendChild(h('h3', { class: 'week-day' + (sameDay(day, now) ? ' is-today' : '') }, dayLabel(day)));
          body.appendChild(h('div', { class: 'stack-tight' }, list.map(function (e) {
            var live = e.start <= now && now < e.end;
            return h('div', { class: 'week-class kind-' + K.logic.classKind(e) + (live ? ' is-now' : ''), title: kindLabel(K.logic.classKind(e)) }, h('span', { class: 'week-time' }, e.allDay ? t('All day') : hm(e.start) + '–' + hm(e.end)),
              h('span', {}, h('strong', {}, e.subject || e.summary || '—'), e.location ? h('span', { class: 'muted small' }, ' · ' + e.location) : null,
                e.teacher ? h('span', { class: 'muted small week-desc' }, e.teacher) : e.subject ? null : e.description ? h('span', { class: 'muted small week-desc' }, e.description) : null));
          })));
        }
      }
      draw();
    } });
  };
  ui.confLabel = function (c) { return { sur: t('Confirmed'), probable: t('Likely'), rumeur: t('Rumour') }[c] || t('Confirmed'); };

  /* Player picker with search. opts: { title, filter(p), extra: [{label, value}] } -> Promise(id | value | undefined) */
  ui.pickPlayer = function (opts) {
    return new Promise(function (resolve) {
      var done = false, L = K.logic;
      ui.dialog({
        title: opts.title, onClose: function () { if (!done) resolve(undefined); },
        render: function (body, api) {
          var list = h('div', { class: 'pick-list' });
          var input = h('input', { type: 'search', placeholder: t('Search a name'), autocomplete: 'off', oninput: draw });
          body.appendChild(input); body.appendChild(list);
          function choose(v) { done = true; resolve(v); api.close(); }
          function draw() {
            var q = L.norm(input.value);
            ui.clear(list);
            (opts.extra || []).forEach(function (x) { list.appendChild(h('button', { type: 'button', class: 'row row-btn', onclick: function () { choose(x.value); } }, h('span', { class: 'row-main muted' }, x.label))); });
            var pool = K.store.state.players.filter(function (p) { return (!opts.filter || opts.filter(p)) && (!q || L.norm(p.name).indexOf(q) >= 0); })
              .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', K.i18n.lang); });
            pool.slice(0, 60).forEach(function (p) {
              list.appendChild(h('button', { type: 'button', class: 'row row-btn', onclick: function () { choose(p.id); } }, ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name), ui.yearTag(p)));
            });
            if (!pool.length) list.appendChild(h('p', { class: 'empty' }, t('No match. Check the spelling or add the player from the Players tab.')));
            else if (pool.length > 60) list.appendChild(h('p', { class: 'empty' }, t('{n} more: narrow the search.', { n: pool.length - 60 })));
          }
          draw();
        }
      });
    });
  };

  /* Copying from the page yields plain text only: no HTML, so chats and editors do not turn headings into "#". */
  document.addEventListener('copy', function (e) {
    var target = e.target, editable = target && (/INPUT|TEXTAREA/.test(target.tagName) || target.isContentEditable);
    if (editable || !e.clipboardData) return;
    var text = String(window.getSelection && window.getSelection()).replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });

  ui.safeUrl = function (u) { return /^https?:\/\//i.test(String(u || '')) ? u : null; };
  ui.ago = function (iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return t('just now');
    if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) });
    if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) });
    return t('{n} d ago', { n: Math.round(s / 86400) });
  };
  ui.when = function (iso) { return new Date(iso).toLocaleString(K.i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: K.logic.TIME_ZONE }); };   // Paris time
  ui.pct = function (x) { return Math.round((x || 0) * 100) + ' %'; };
  ui.download = function (name, text, type) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'application/octet-stream' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  };
})();
