(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var ui = K.ui = {};

  /* Tout le contenu passe par des nœuds texte : rien de ce que vous saisissez n'est interprété comme du HTML. */
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
    // Un <dialog> modal vit dans la « top layer » : le toast doit y entrer pour rester visible.
    var open = document.querySelectorAll('dialog[open]'), parent = open.length ? open[open.length - 1] : document.body;
    var host = document.getElementById('toasts') || h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    if (host.parentNode !== parent) parent.appendChild(host);
    var t = host.appendChild(h('div', { class: 'toast' + (kind ? ' toast-' + kind : '') }, text));
    setTimeout(function () { t.remove(); }, kind === 'error' ? 6000 : 3200);
  };

  /* Dialogue : feuille basse sur téléphone, panneau centré sur grand écran. */
  ui.dialog = function (opts) {
    var dlg = h('dialog', { class: 'sheet' + (opts.wide ? ' sheet-wide' : '') });
    function close() { if (dlg.open) dlg.close(); }
    dlg.addEventListener('close', function () { dlg.remove(); if (opts.onClose) opts.onClose(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    var body = h('div', { class: 'sheet-body' });
    dlg.appendChild(h('div', { class: 'sheet-inner' },
      h('header', { class: 'sheet-head' },
        h('h2', {}, opts.title || ''),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: close }, '✕')),
      body));
    document.body.appendChild(dlg);
    var api = { el: dlg, body: body, close: close, setTitle: function (t) { dlg.querySelector('h2').textContent = t; } };
    if (opts.render) opts.render(body, api);
    dlg.showModal();
    return api;
  };

  ui.confirm = function (o) {
    return new Promise(function (resolve) {
      var answered = false;
      var d = ui.dialog({
        title: o.title, onClose: function () { if (!answered) resolve(false); },
        render: function (body, api) {
          (Array.isArray(o.text) ? o.text : [o.text]).forEach(function (line) { body.appendChild(h('p', { class: 'prose' }, line)); });
          body.appendChild(h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn', onclick: function () { api.close(); } }, 'Annuler'),
            h('button', { type: 'button', class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), onclick: function () { answered = true; resolve(true); api.close(); } }, o.action || 'Confirmer')));
        }
      });
      return d;
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
    var url = K.store.photoUrl(p);
    var el = h('span', { class: 'avatar' + (size ? ' avatar-' + size : ''), style: { '--year': ui.yearColor(p && p.year) } });
    if (url) el.appendChild(h('img', { src: url, alt: '', loading: 'lazy' }));
    else el.appendChild(h('span', { 'aria-hidden': 'true' }, ui.initials(p && p.name)));
    return el;
  };
  ui.yearTag = function (p) {
    var text = [p.year, p.dept, p.td].filter(Boolean).join(' ');
    return text ? h('span', { class: 'tag tag-year', style: { '--year': ui.yearColor(p.year) } }, text) : null;
  };

  ui.confLabel = { sur: 'Sûr', probable: 'Probable', rumeur: 'Rumeur' };

  /* Sélecteur de joueur avec recherche. opts : { title, filter(p), extra:[{label,value}] } → Promise(id | value | undefined) */
  ui.pickPlayer = function (opts) {
    return new Promise(function (resolve) {
      var done = false, L = K.logic;
      ui.dialog({
        title: opts.title, onClose: function () { if (!done) resolve(undefined); },
        render: function (body, api) {
          var list = h('div', { class: 'pick-list' });
          var input = h('input', { type: 'search', placeholder: 'Chercher un nom', autocomplete: 'off', oninput: draw });
          body.appendChild(input); body.appendChild(list);
          function choose(v) { done = true; resolve(v); api.close(); }
          function draw() {
            var q = L.norm(input.value);
            ui.clear(list);
            (opts.extra || []).forEach(function (x) {
              list.appendChild(h('button', { type: 'button', class: 'row row-btn', onclick: function () { choose(x.value); } }, h('span', { class: 'row-main muted' }, x.label)));
            });
            var pool = K.store.state.players.filter(function (p) { return (!opts.filter || opts.filter(p)) && (!q || L.norm(p.name).indexOf(q) >= 0); })
              .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fr'); });
            pool.slice(0, 60).forEach(function (p) {
              list.appendChild(h('button', { type: 'button', class: 'row row-btn', onclick: function () { choose(p.id); } },
                ui.avatar(p, 'sm'), h('span', { class: 'row-main' }, p.name), ui.yearTag(p)));
            });
            if (!pool.length) list.appendChild(h('p', { class: 'empty' }, 'Personne ne correspond. Vérifie l\'orthographe ou ajoute le joueur depuis l\'onglet Joueurs.'));
            else if (pool.length > 60) list.appendChild(h('p', { class: 'empty' }, (pool.length - 60) + ' autres : précise la recherche.'));
          }
          draw();
        }
      });
    });
  };

  ui.safeUrl = function (u) { return /^https?:\/\//i.test(String(u || '')) ? u : null; };
  ui.ago = function (iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'à l\'instant';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return 'il y a ' + Math.round(s / 86400) + ' j';
  };
  ui.pct = function (x) { return Math.round((x || 0) * 100) + ' %'; };
})();
