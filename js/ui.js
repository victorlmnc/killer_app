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

  ui.scrollHint = function (row) {
    var box = h('div', { class: 'scroll-hint' }, row);
    function update() {
      var more = row.scrollWidth - row.clientWidth > 2;
      box.classList.toggle('more-right', more && row.scrollLeft < row.scrollWidth - row.clientWidth - 2);
      box.classList.toggle('more-left', more && row.scrollLeft > 2);
    }
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    requestAnimationFrame(function () { requestAnimationFrame(update); });   // after layout (and after the chosen option is scrolled into view)
    return box;
  };
  /* Crop a photo to a square: drag to move, slider / wheel / pinch to zoom. source: a File or an image URL.
     Resolves to a square JPEG File, or null when cancelled. Animated GIFs are not cropped (they would stop moving). */
  ui.cropImage = function (source) {
    return new Promise(function (resolve) {
      var url = typeof source === 'string' ? source : URL.createObjectURL(source), img = new Image(), done = false;
      if (typeof source === 'string' && source.indexOf('data:') !== 0) img.crossOrigin = 'anonymous';   // signed storage URLs: the canvas must stay readable
      function finish(v) { if (done) return; done = true; if (typeof source !== 'string') URL.revokeObjectURL(url); resolve(v); }
      img.onerror = function () { ui.toast(t('Unreadable image'), 'error'); finish(null); };
      img.onload = function () {
        ui.dialog({ title: t('Crop the photo'), onClose: function () { finish(null); }, render: function (body, api) {
          var frame = h('div', { class: 'crop-frame' }), view = h('img', { class: 'crop-img', src: url, alt: '', draggable: 'false' });
          var zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': t('Zoom') });
          frame.appendChild(view);
          body.appendChild(h('p', { class: 'muted small' }, t('Move the photo with your finger or the mouse; zoom with the slider (or pinch, or the wheel).')));
          body.appendChild(frame);
          body.appendChild(h('div', { class: 'crop-zoom' }, h('span', { 'aria-hidden': 'true' }, '−'), zoom, h('span', { 'aria-hidden': 'true' }, '+')));
          var W = img.naturalWidth, H = img.naturalHeight, size = 0, base = 1, k = 1, x = 0, y = 0;
          function clamp() { var s = base * k; x = Math.min(0, Math.max(size - W * s, x)); y = Math.min(0, Math.max(size - H * s, y)); }
          function draw() { clamp(); view.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + base * k + ')'; zoom.value = String(k); }
          function setZoom(nk, cx, cy) {   // keep the point under (cx, cy) in place
            nk = Math.max(1, Math.min(4, nk)); var s0 = base * k, s1 = base * nk;
            cx = cx == null ? size / 2 : cx; cy = cy == null ? size / 2 : cy;
            x = cx - (cx - x) * s1 / s0; y = cy - (cy - y) * s1 / s0; k = nk; draw();
          }
          requestAnimationFrame(function () {
            size = frame.clientWidth; base = Math.max(size / W, size / H);
            x = (size - W * base) / 2; y = (size - H * base) / 2; draw();
          });
          zoom.addEventListener('input', function () { setZoom(parseFloat(zoom.value)); });
          frame.addEventListener('wheel', function (e) { e.preventDefault(); var r = frame.getBoundingClientRect(); setZoom(k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
          var pts = new Map(), pinch = null;
          frame.addEventListener('pointerdown', function (e) { frame.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = null; });
          frame.addEventListener('pointermove', function (e) {
            var prev = pts.get(e.pointerId); if (!prev) return;
            var cur = { x: e.clientX, y: e.clientY };
            if (pts.size === 1) { x += cur.x - prev.x; y += cur.y - prev.y; draw(); }
            else {
              pts.set(e.pointerId, cur);
              var p = Array.from(pts.values()), d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), r = frame.getBoundingClientRect();
              if (pinch) setZoom(k * d / pinch, (p[0].x + p[1].x) / 2 - r.left, (p[0].y + p[1].y) / 2 - r.top);
              pinch = d;
            }
            pts.set(e.pointerId, cur);
          });
          function up(e) { pts.delete(e.pointerId); pinch = null; }
          frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
          body.appendChild(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: api.close }, t('Cancel')),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
              var s = base * k, side = size / s, out = document.createElement('canvas');
              out.width = out.height = Math.round(Math.min(800, side));
              try {
                out.getContext('2d').drawImage(img, -x / s, -y / s, side, side, 0, 0, out.width, out.height);
                out.toBlob(function (blob) { finish(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : null); api.close(); }, 'image/jpeg', 0.92);
              } catch (err) { ui.toast(t('Unreadable image'), 'error'); finish(null); api.close(); }
            } }, t('Use this photo'))));
        } });
      };
      img.src = url;
    });
  };
  /* A chosen photo goes through the cropper first, except animated GIFs. */
  ui.pickPhoto = function (file) { return file && file.type === 'image/gif' ? Promise.resolve(file) : ui.cropImage(file); };
  ui.field = function (label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  };
  ui.select = function (options, value, attrs) {
    return h('select', Object.assign({ value: value == null ? '' : value }, attrs || {}), options.map(function (o) {
      var opt = typeof o === 'string' ? { value: o, label: o } : o;
      return h('option', { value: opt.value, disabled: !!opt.disabled }, opt.label);
    }));
  };

  /* A menu that looks like a filter chip: the chip shows the choice (o.empty when nothing is chosen, lit when
     something is), a native select lies invisible on top of it so the phone's own picker opens. The select keeps
     16px text, so iOS does not zoom in on it. o: { empty, prefix (before a chosen value), lit (false: never lit), onchange, 'aria-label' } */
  ui.chipSelect = function (options, value, o) {
    o = o || {};
    var opts = options.map(function (x) { return typeof x === 'string' ? { value: x, label: x } : x; });
    var text = h('span', { class: 'chip-select-text' }), wrap = h('label', { class: 'chip chip-select' }, text, K.icon('chevron', 'chip-select-chevron'));
    var sel = ui.select(opts, value, { class: 'chip-select-native', 'aria-label': o['aria-label'] || null, onchange: function (e) { show(); if (o.onchange) o.onchange(e); } });
    function show() {
      var v = sel.value, cur = opts.find(function (x) { return String(x.value) === v; });
      text.textContent = !v && o.empty ? o.empty : (v && o.prefix ? o.prefix + ' ' : '') + (cur ? cur.label : v);
      wrap.classList.toggle('is-on', o.lit !== false && !!v);
    }
    wrap.appendChild(sel); show();
    return wrap;
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
    else if (p && p.is_mystery) { el.classList.add('avatar-mystery'); el.appendChild(h('span', { 'aria-hidden': 'true' }, '?')); }
    else el.appendChild(h('span', { 'aria-hidden': 'true' }, ui.initials(p && p.name)));
    // members of the alliance: a white star badge on the photo (the avatar clips its content, so it sits on a wrapper)
    if (!p || !p.is_ally) return el;
    return h('span', { class: 'avatar-wrap' + (size ? ' avatar-wrap-' + size : '') }, el,
      h('span', { class: 'ally-badge', title: t('Alliance member') }, h('span', { 'aria-hidden': 'true' }, '★'), h('span', { class: 'sr-only' }, t('Alliance member'))));
  };
  ui.yearTag = function (p) {
    var text = [p.year, p.dept, p.td].filter(Boolean).join(' ');
    return text ? h('span', { class: 'tag tag-year', style: { '--year': ui.yearColor(p.year) } }, text) : null;
  };
  /* A weapon as a tag coloured by its catalogue difficulty (green easy, brass hard, grey unknown); the text says it too. */
  ui.weaponDifficulty = function (name) {
    var n = K.logic.norm(name), w = K.store.state.weapons.find(function (x) { return K.logic.norm(x.name) === n; });
    return w && w.difficulty !== 'inconnue' ? w.difficulty : null;
  };
  /* Labels that follow the scoring set in Settings */
  function pts(n) { return K.n(n, '{n} pt', '{n} pts'); }
  ui.levelOptions = function (withUnknown) {
    var sc = K.logic.scoring(K.store.state);
    return [{ value: 'facile', label: t('Easy ({p})', { p: pts(sc.easy) }) }, { value: 'difficile', label: t('Hard ({p})', { p: pts(sc.hard) }) }]
      .concat(withUnknown ? [{ value: 'inconnue', label: t("Don't know ({a} or {b} pts)", { a: sc.easy, b: sc.hard }) }] : []);
  };
  ui.levelText = function (d) {   // "Hard, 3 pts"
    var sc = K.logic.scoring(K.store.state);
    return d === 'difficile' ? t('Hard, {p}', { p: pts(sc.hard) }) : d === 'facile' ? t('Easy, {p}', { p: pts(sc.easy) }) : t('{a} or {b} points', { a: sc.easy, b: sc.hard });
  };
  ui.bonusOptions = function () {
    return [{ value: '0', label: t('None') }].concat(K.logic.bonusChoices(K.logic.scoring(K.store.state)).map(function (b) {
      return { value: String(b.value), label: t(b.kind === 'both' ? 'Video or witnessed +{n}' : b.kind === 'video' ? 'Video +{n}' : 'Witnessed +{n}', { n: b.value }) };
    }));
  };
  /* "12 pts", or "12 to 14 pts" while kills made with a weapon of unknown difficulty are not settled */
  ui.pointsText = function (p) {
    if (p && p.is_mystery && !p.points) return t('points unknown');
    var r = K.logic.pointsRange(K.store.state, p);
    return r.max > r.min ? t('{a} to {b} pts', { a: r.min, b: r.max }) : K.n(r.min, '{n} pt', '{n} pts');
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
  /* Small marks after a name, the same as on the chain bubbles: white star = alliance, red ! = dangerous,
     brass ◎ = priority target. The words are there for screen readers. */
  ui.nameMarks = function (p) {
    if (!p) return null;
    var marks = [];
    if (p.is_ally) marks.push(['ally', '★', t('Alliance member')]);
    if (p.status === 'dangerous') marks.push(['dangerous', '!', t('Dangerous')]);
    if (p.status === 'priority') marks.push(['priority', '◎', t('Priority target')]);
    return marks.length ? h('span', { class: 'name-marks' }, marks.map(function (m) {
      return h('span', { class: 'name-mark name-mark-' + m[0], title: m[2] }, h('span', { 'aria-hidden': 'true' }, m[1]), h('span', { class: 'sr-only' }, ' (' + m[2] + ')'));
    })) : null;
  };
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
  ui.hm = function (d) { return hm(d); }; ui.dayLabel = function (d) { return dayLabel(d); };
  /* "Now: Maths · SA2.04 · until 12:20" and "Next: …" as plain text (to share a sheet) */
  ui.scheduleLines = function (events, now) {
    now = now || new Date();
    var s = K.logic.scheduleAt(events, now), out = [];
    if (s.current) out.push(t('Now') + ' : ' + classText(s.current) + ' · ' + (s.current.allDay ? t('until {date}', { date: shortDate(new Date(s.current.end - 1)) }) : t('until {time}', { time: hm(s.current.end) })));
    if (s.next) out.push(t('Next') + ' : ' + classText(s.next) + ' · ' + whenNext(s.next, now));
    return out;
  };
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
    function fill() { K.store.playerEvents(p).then(function (res) {
      if (!box.isConnected && box.parentNode) return;
      var events = res.events, now = new Date(), s = K.logic.scheduleAt(events, now);
      ui.clear(box);
      if (s.current) box.appendChild(h('p', { class: 'sched-line sched-now' }, h('span', { class: 'sched-label' }, t('Now')), kindTag(s.current), classText(s.current), h('span', { class: 'muted' }, ' · ' + (s.current.allDay ? t('until {date}', { date: shortDate(new Date(s.current.end - 1)) }) : t('until {time}', { time: hm(s.current.end) })))));
      if (s.next && (!compact || !s.current)) box.appendChild(h('p', { class: 'sched-line' }, h('span', { class: 'sched-label' }, t('Next')), kindTag(s.next), classText(s.next), h('span', { class: 'muted' }, ' · ' + whenNext(s.next, now))));
      if (!s.current && !s.next) box.appendChild(h('p', { class: 'muted small' }, t('No upcoming class in this timetable.')));
      if (res.failed) box.appendChild(h('p', { class: 'muted small' }, K.n(res.failed, '{n} timetable could not be loaded.', '{n} timetables could not be loaded.')));
      if (!compact) box.appendChild(h('div', { class: 'row row-wrap sched-actions' },
        h('button', { type: 'button', class: 'linkish small', onclick: function () { ui.weekDialog(p, events); } }, t('See the week')),
        !p.is_ally ? h('button', { type: 'button', class: 'linkish small', onclick: function () { K.actions.catchDialog(p.id); } }, t('When to catch them')) : null));
    }).catch(function (err) {
      ui.clear(box).appendChild(h('p', { class: 'muted small' }, t('Timetable unavailable: {err}', { err: err.message || err })));
    }); }
    fill();
    return ui.live(box, fill);   // "now" and "next" follow the clock
  };
  /* A bought bonus: "Immunité · until Tue 00:10" when in effect, "from Tue 00:10" when still to come. */
  ui.whenShort = function (d) { return shortDate(new Date(d)) + ' ' + hm(new Date(d)); };
  ui.bonusTag = function (b, small) {
    var st = K.logic.bonusStatus(b), now = new Date(), s = new Date(b.starts_at), e = b.ends_at && new Date(b.ends_at);
    var label = st === 'active' ? (sameDay(e, now) ? t('until {time}', { time: hm(e) }) : t('until {date}', { date: ui.whenShort(e) }))
      : st === 'upcoming' ? (sameDay(s, now) ? t('at {time}', { time: hm(s) }) : sameDay(s, dayStart(now, 1)) ? t('tomorrow at {time}', { time: hm(s) }) : t('from {date}', { date: ui.whenShort(s) }))
      : t('used');
    return h('span', { class: 'tag tag-bonus tag-bonus-' + st + (small ? ' tag-sm' : ''), title: b.name + ' · ' + label }, b.name, h('span', { class: 'tag-bonus-when' }, ' · ' + label));
  };
  /* Bonuses of a player still to come or in effect (nothing when there are none). */
  ui.bonusTags = function (p, small) {
    var list = p ? K.logic.currentBonuses(K.store.state, p.id) : [];
    return list.length ? h('span', { class: 'tags bonus-tags' }, list.map(function (b) { return ui.bonusTag(b, small); })) : null;
  };
  /* Things that change with the clock ("now", "until 12:22", bonuses starting or ending) are redrawn every minute:
     live elements redraw themselves; when a bonus starts or ends, the whole screen is refreshed once. */
  var live = [], bonusSignature = '';
  ui.live = function (el, redraw) { live.push({ el: el, redraw: redraw }); return el; };
  setInterval(function () {
    if (document.hidden) return;
    live = live.filter(function (x) { return x.el.isConnected; });
    live.forEach(function (x) { try { x.redraw(); } catch (e) { console.error(e); } });
    var sig = (K.store.state.bonuses || []).map(function (b) { return b.id + K.logic.bonusStatus(b); }).join();
    if (bonusSignature && sig !== bonusSignature) K.store.emit();
    bonusSignature = sig;
  }, 60e3);
  /* The week of a player, loading their timetable first (from a place that only shows "now" and "next"). */
  ui.openWeek = function (p) {
    K.store.playerEvents(p).then(function (res) { ui.weekDialog(p, res.events); }, function (err) { ui.toast(t('Timetable unavailable: {err}', { err: err.message || err }), 'error'); });
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
            // opts.prefer(p): players listed first (e.g. the alliance), then the others under a heading
            var dead = L.deadSet(K.store.state), first = function (p) { return opts.prefer && opts.prefer(p) ? 0 : 1; };
            var pool = K.store.state.players.filter(function (p) { return (!opts.filter || opts.filter(p)) && (!q || L.norm(p.name).indexOf(q) >= 0); })
              .sort(function (a, b) { return first(a) - first(b) || (a.name || '').localeCompare(b.name || '', K.i18n.lang); });
            pool.slice(0, 60).forEach(function (p, i) {
              if (opts.prefer && i && first(p) !== first(pool[i - 1])) list.appendChild(h('p', { class: 'pick-sep muted small' }, opts.otherLabel || t('Other players')));
              var isDead = dead.has(p.id);
              list.appendChild(h('button', { type: 'button', class: 'row row-btn' + (isDead ? ' is-dead' : ''), onclick: function () { choose(p.id); } }, ui.avatar(p, 'sm'),
                h('span', { class: 'row-main' }, p.name), isDead ? h('span', { class: 'tag tag-dead' }, t('Dead')) : null, ui.yearTag(p)));
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
