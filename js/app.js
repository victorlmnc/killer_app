(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, store = K.store;
  var app = document.getElementById('app');
  var NAV = [['dashboard', '📊', 'Dashboard'], ['chaine', '🕵️', 'Chaîne'], ['joueurs', '🗂️', 'Joueurs'], ['map', '🗺️', 'Map'], ['armes', '🔪', 'Armes'],
    ['shop', '🛒', 'Shop'], ['classes', '🎓', 'Classes'], ['parametres', '⚙️', 'Paramètres']];
  var refreshView = null, shell = null;

  K.setTheme = function (t) {
    try { localStorage.setItem('killer-qg-theme', t); } catch (e) { /* rien */ }
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  };
  try { K.setTheme(localStorage.getItem('killer-qg-theme') || 'auto'); } catch (e) { /* rien */ }

  /* ------------------------------------------------------------ connexion */
  function authScreen(mode, message) {
    refreshView = null; shell = null; ui.clear(app);
    var email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'prenom.nom@insa-cvl.fr' });
    var pass = h('input', { type: 'password', autocomplete: mode === 'signin' ? 'current-password' : 'new-password', required: true, minlength: '8' });
    var note = h('p', { class: 'auth-note', role: 'alert' }, message || '');
    var labels = { signin: 'Se connecter', signup: 'Créer mon compte', reset: 'Recevoir le lien', newpass: 'Enregistrer le mot de passe' };
    var submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, labels[mode]);

    function run(e) {
      e.preventDefault(); submit.disabled = true; note.textContent = '';
      var job = mode === 'signin' ? store.auth.signIn(email.value.trim(), pass.value)
        : mode === 'signup' ? store.auth.signUp(email.value.trim(), pass.value)
        : mode === 'reset' ? store.auth.resetPassword(email.value.trim()) : store.auth.updatePassword(pass.value);
      job.then(function (res) {
        submit.disabled = false;
        if (res.error) { note.textContent = /invalid login/i.test(res.error.message) ? 'E-mail ou mot de passe incorrect.' : res.error.message; return; }
        if (mode === 'signup') authScreen('signin', 'Compte créé. Clique sur le lien reçu par e-mail, puis connecte-toi.');
        if (mode === 'reset') authScreen('signin', 'Si cette adresse a un compte, un lien vient de partir.');
        if (mode === 'newpass') { ui.toast('Mot de passe enregistré.'); location.hash = '#/dashboard'; location.reload(); }
      }).catch(function (err) { submit.disabled = false; note.textContent = err.message || String(err); });
    }
    function sw(to, label) { return h('button', { type: 'button', class: 'linkish', onclick: function () { authScreen(to); } }, label); }

    app.appendChild(h('main', { class: 'auth' }, h('form', { class: 'auth-card', onsubmit: run },
      h('h1', { class: 'brand' }, 'QG Killer'),
      h('p', { class: 'prose' }, mode === 'newpass' ? 'Choisis ton nouveau mot de passe.' : 'Réservé aux membres de l\'alliance. Ton adresse doit avoir été autorisée par un admin.'),
      mode !== 'newpass' ? ui.field('E-mail', email) : null,
      mode !== 'reset' ? ui.field(mode === 'signin' ? 'Mot de passe' : 'Mot de passe (8 caractères minimum)', pass) : null,
      note, submit,
      h('p', { class: 'auth-switch' }, mode === 'signin' ? [sw('signup', 'Créer mon compte'), sw('reset', 'Mot de passe oublié')] : mode === 'newpass' ? null : sw('signin', 'J\'ai déjà un compte')))));
  }

  function notMember() {
    refreshView = null; shell = null; ui.clear(app);
    app.appendChild(h('main', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', { class: 'brand' }, 'QG Killer'),
      h('p', { class: 'prose' }, 'Tu es connecté avec ' + store.user.email + ', mais cette adresse n\'est pas sur la liste de l\'alliance. Demande à un admin de l\'ajouter dans Paramètres, puis recharge la page.'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: function () { store.auth.signOut(); } }, 'Se déconnecter'))));
  }

  /* ---------------------------------------------------------------- shell */
  function buildShell() {
    ui.clear(app);
    var nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, NAV.map(function (n) {
      return h('a', { href: '#/' + n[0], class: 'nav-item', 'data-route': n[0] }, h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, n[1]), h('span', { class: 'nav-label' }, n[2]));
    }));
    var title = h('h1', {}), game = h('span', { class: 'game-name' }), main = h('main', { class: 'view', id: 'view', tabindex: '-1' });
    app.appendChild(h('div', { class: 'shell' },
      h('aside', { class: 'side' }, h('a', { class: 'brand', href: '#/dashboard' }, 'QG Killer'), game, nav,
        store.mode !== 'supabase' ? h('p', { class: 'demo-flag' }, 'Mode démo : données fictives, stockées dans ce navigateur.') : null),
      h('div', { class: 'content' }, h('header', { class: 'topbar' }, title), main)));
    shell = { nav: nav, title: title, main: main, game: game };
  }

  function route() {
    if (!shell) return;
    var name = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
    if (!K.views[name]) name = 'dashboard';
    var view = K.views[name];
    shell.title.textContent = view.title;
    shell.game.textContent = store.state.settings.game_name || '';
    document.title = view.title + ' – QG Killer';
    Array.prototype.forEach.call(shell.nav.children, function (a) {
      var on = a.getAttribute('data-route') === name; a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (refreshView && refreshView.destroy) refreshView.destroy(); // la carte libère ses écouteurs en quittant l'onglet
    ui.clear(shell.main); shell.main.className = 'view view-' + name;
    refreshView = view.render(shell.main);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  store.on(function () { if (shell) shell.game.textContent = store.state.settings.game_name || ''; if (refreshView) refreshView(); });

  ui.clear(app).appendChild(h('p', { class: 'boot' }, 'Chargement…'));
  store.boot({
    onSignedOut: function () { authScreen('signin'); },
    onRecovery: function () { authScreen('newpass'); },
    onNotMember: notMember,
    onReady: function () { buildShell(); route(); },
    onError: function (err) { ui.clear(app).appendChild(h('main', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', { class: 'brand' }, 'QG Killer'),
      h('p', { class: 'prose' }, 'Connexion à la base impossible : ' + (err.message || err) + '. Vérifie js/config.js et que supabase/schema.sql a bien été exécuté.')))); }
  }).catch(function (err) { ui.clear(app).appendChild(h('p', { class: 'boot' }, 'Démarrage impossible : ' + (err.message || err))); });
})();
