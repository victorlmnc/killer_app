(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, store = K.store, t = K.t;
  var app = document.getElementById('app');
  // [route, icon, label (translated at render time)]
  var NAV = K.NAV = [['dashboard', 'dashboard', 'Dashboard'], ['chain', 'chain', 'Chain'], ['players', 'players', 'Players'], ['map', 'map', 'Map'],
    ['weapons', 'weapons', 'Weapons'], ['shop', 'shop', 'Shop'], ['classes', 'classes', 'Classes'], ['settings', 'settings', 'Settings']];
  var refreshView = null, shell = null;

  function logo(size) {
    var el = h('span', { class: 'logo', 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px' } });
    el.innerHTML = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="20" cy="20" r="15" stroke-dasharray="2 4.5" opacity=".6"/>'
      + '<path d="M20 5a15 15 0 0 1 14.3 10.4" stroke="var(--thread)" stroke-width="2.4" stroke-linecap="round"/><path d="M36.8 10.2l-1.6 7.3-6-4.3z" fill="var(--thread)" stroke="none"/>'
      + '<circle cx="20" cy="5" r="2.6" fill="currentColor" stroke="none"/></svg>';
    return el;
  }
  function brand(tag, attrs) { return h(tag, Object.assign({ class: 'brand' }, attrs || {}), logo(tag === 'h1' ? 40 : 28), h('span', {}, 'Killer')); }
  function langSwitch() {
    return h('div', { class: 'lang', role: 'group', 'aria-label': t('Language') }, ['fr', 'en'].map(function (l) {
      return h('button', { type: 'button', class: K.i18n.lang === l ? 'is-on' : '', 'aria-pressed': String(K.i18n.lang === l), onclick: function () { if (K.i18n.lang !== l) K.setLang(l); } }, l.toUpperCase());
    }));
  }

  /* ------------------------------------------------------------ sign in */
  function authScreen(mode, message) {
    refreshView = null; shell = null; ui.clear(app);
    var email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'name@example.org' });
    var pass = h('input', { type: 'password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password', required: true, minlength: '8' });
    var note = h('p', { class: 'auth-note', role: 'alert' }, message || '');
    var labels = { signin: t('Sign in'), signup: t('Create my account'), reset: t('Send the link'), newpass: t('Save the password') };
    var submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, labels[mode]);
    function run(e) {
      e.preventDefault(); submit.disabled = true; note.textContent = '';
      var job = mode === 'signin' ? store.auth.signIn(email.value.trim(), pass.value)
        : mode === 'signup' ? store.auth.signUp(email.value.trim(), pass.value)
        : mode === 'reset' ? store.auth.resetPassword(email.value.trim()) : store.auth.updatePassword(pass.value);
      job.then(function (res) {
        submit.disabled = false;
        if (res.error) { note.textContent = /invalid login/i.test(res.error.message) ? t('Wrong email or password.') : res.error.message; return; }
        if (mode === 'signup') authScreen('signin', t('Account created. Click the link you received by email, then sign in.'));
        if (mode === 'reset') authScreen('signin', t('If this address has an account, a link is on its way.'));
        if (mode === 'newpass') { ui.toast(t('Password saved.')); location.hash = '#/dashboard'; location.reload(); }
      }).catch(function (err) { submit.disabled = false; note.textContent = err.message || String(err); });
    }
    function sw(to, label) { return h('button', { type: 'button', class: 'linkish', onclick: function () { authScreen(to); } }, label); }
    app.appendChild(h('main', { class: 'auth' }, h('form', { class: 'auth-card', onsubmit: run },
      brand('h1'),
      h('p', { class: 'prose' }, mode === 'newpass' ? t('Choose your new password.') : t('Private team workspace. Your address must have been allowed by the administrator.')),
      mode !== 'newpass' ? ui.field(t('Email'), email) : null,
      mode !== 'reset' ? ui.field(mode === 'signin' ? t('Password') : t('Password (8 characters minimum)'), pass) : null,
      note, submit,
      h('p', { class: 'auth-switch' }, mode === 'signin' ? [sw('signup', t('Create my account')), sw('reset', t('Forgot password'))] : mode === 'newpass' ? null : sw('signin', t('I already have an account'))),
      langSwitch())));
  }
  function notMember() {
    refreshView = null; shell = null; ui.clear(app);
    app.appendChild(h('main', { class: 'auth' }, h('div', { class: 'auth-card' }, brand('h1'),
      h('p', { class: 'prose' }, t('You are signed in as {email}, but this address is not on the team list. Ask the administrator to add it, then reload the page.', { email: store.user.email })),
      h('button', { type: 'button', class: 'btn btn-block', onclick: function () { store.auth.signOut(); } }, t('Sign out')))));
  }

  /* ---------------------------------------------------------------- shell */
  function buildShell() {
    ui.clear(app);
    var nav = h('nav', { class: 'nav', 'aria-label': t('Sections') });
    var title = h('h1', {}), game = h('span', { class: 'game-name' }), status = h('dl', { class: 'status' });
    var whoami = h('button', { type: 'button', class: 'whoami', title: t('My profile'), onclick: K.actions.profileDialog });
    var main = h('main', { class: 'view', id: 'view', tabindex: '-1' });
    app.appendChild(h('div', { class: 'shell' },
      h('aside', { class: 'side' }, brand('a', { href: '#/dashboard' }), game, nav, whoami, store.mode !== 'supabase' ? h('p', { class: 'demo-flag' }, t('Demo data, stored in this browser.')) : null),
      h('div', { class: 'content' }, h('header', { class: 'topbar' }, title, status), main)));
    shell = { nav: nav, title: title, main: main, game: game, status: status, whoami: whoami };
  }
  function tabs() { return store.allowedTabs(NAV.map(function (n) { return n[0]; })); }

  /* Status strip and account chip, on every page. */
  function chrome() {
    if (!shell) return;
    var st = store.state, s = K.logic.stats(st), round = K.logic.currentRound(st), allowed = tabs();
    if (allowed.indexOf(current()) < 0 && allowed.length) { location.hash = '#/' + allowed[0]; return; }   // role changed under our feet
    shell.game.textContent = st.settings.game_name || '';
    ui.clear(shell.nav);
    NAV.forEach(function (n) {
      if (allowed.indexOf(n[0]) < 0) return;
      shell.nav.appendChild(h('a', { href: '#/' + n[0], class: 'nav-item', 'data-route': n[0] }, K.icon(n[1], 'nav-icon'), h('span', { class: 'nav-label' }, t(n[2]))));
    });
    ui.clear(shell.status);
    [[round ? round.name : t('No round'), t('Round')], [s.alive + ' / ' + s.total, t('Alive')], [ui.pct(s.coverage), t('Chain known')]].forEach(function (f) { shell.status.appendChild(h('div', {}, h('dt', {}, f[1]), h('dd', {}, f[0]))); });
    ui.clear(shell.whoami);
    var me = store.me(), name = store.displayName();
    shell.whoami.appendChild(ui.avatar({ name: name, avatar_path: me && me.avatar_path }, 'sm'));
    shell.whoami.appendChild(h('span', {}, h('span', { class: 'whoami-name' }, name || t('Guest')), h('span', { class: 'whoami-sub' }, { admin: t('Administrator'), member: t('Alliance member'), observer: t('Observer') }[store.role] || '')));
    markActive();
  }
  function markActive() {
    var name = current();
    Array.prototype.forEach.call(shell.nav.children, function (a) {
      var on = a.getAttribute('data-route') === name; a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function current() { return (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0]; }
  function route() {
    if (!shell) return;
    var name = current(), allowed = tabs();
    if (!K.views[name] || allowed.indexOf(name) < 0) { name = allowed[0] || 'dashboard'; if (location.hash !== '#/' + name) { location.hash = '#/' + name; return; } }
    var view = K.views[name];
    shell.title.textContent = view.title;
    document.title = view.title + ' · ' + (store.state.settings.game_name || 'Killer');
    if (refreshView && refreshView.destroy) refreshView.destroy();
    ui.clear(shell.main); shell.main.className = 'view view-' + name;
    refreshView = view.render(shell.main);
    chrome();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  store.on(function () { chrome(); if (refreshView) refreshView(); });

  ui.clear(app).appendChild(h('p', { class: 'boot' }, t('Loading…')));
  store.boot({
    onSignedOut: function () { authScreen('signin'); },
    onRecovery: function () { authScreen('newpass'); },
    onNotMember: notMember,
    onReady: function () { buildShell(); route(); },
    onError: function (err) { ui.clear(app).appendChild(h('main', { class: 'auth' }, h('div', { class: 'auth-card' }, brand('h1'),
      h('p', { class: 'prose' }, t('Could not reach the database: {err}. Check js/config.js and make sure supabase/schema.sql has been run.', { err: err.message || err }))))); }
  }).catch(function (err) { ui.clear(app).appendChild(h('p', { class: 'boot' }, t('Could not start: {err}', { err: err.message || err }))); });
})();
