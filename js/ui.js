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
  ui.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };

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
      return h('option', { value: opt.value }, opt.label);
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
  ui.when = function (iso) { return new Date(iso).toLocaleString(K.i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };
  ui.pct = function (x) { return Math.round((x || 0) * 100) + ' %'; };
  ui.download = function (name, text, type) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'application/octet-stream' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  };
})();
