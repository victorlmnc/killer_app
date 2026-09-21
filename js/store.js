/* Couche de données. Deux adaptateurs derrière la même API :
   - supabase : la vraie base partagée (si js/config.js est rempli)
   - local    : localStorage + partie fictive, pour essayer l'app sans rien configurer */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var TABLES = ['players', 'rounds', 'links', 'kills', 'weapons', 'events', 'spots'];
  var LOCAL_KEY = 'killer-qg-local-v3'; // v3 : types de logement + lieux stratégiques
  var PHOTO_BUCKET = 'photos';

  var listeners = [];
  var store = K.store = {
    mode: 'local',
    state: { players: [], rounds: [], links: [], kills: [], weapons: [], events: [], spots: [], settings: {}, members: [] },
    user: null, isMember: false, isAdmin: false,
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    emit: function () { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  store.uuid = uuid;

  function withDefaults(settings) {
    var out = JSON.parse(JSON.stringify(K.seed.settings));
    Object.keys(settings || {}).forEach(function (k) { out[k] = settings[k]; });
    return out;
  }

  /* ------------------------------------------------------------------ local */
  var local = {
    init: function () {
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { /* stockage indisponible */ }
      var data = saved && saved.players ? saved : K.seed.demo();
      data.players.forEach(function (p) { if (p.sector != null) { if (!p.address) p.address = p.sector; delete p.sector; } }); // ancien nom du champ
      TABLES.concat(['members']).forEach(function (t) { store.state[t] = data[t] || []; });
      store.state.settings = withDefaults(data.settings);
      store.user = { email: 'demo@local' }; store.isMember = true; store.isAdmin = true;
      return Promise.resolve();
    },
    persist: function () { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(store.state)); } catch (e) { /* quota ou mode privé */ } },
    insert: function () { local.persist(); return Promise.resolve(); },
    update: function () { local.persist(); return Promise.resolve(); },
    remove: function () { local.persist(); return Promise.resolve(); },
    setSetting: function () { local.persist(); return Promise.resolve(); },
    reset: function () { try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* rien */ } return local.init(); }
  };

  /* --------------------------------------------------------------- supabase */
  var sb = null, signed = new Map(), signing = false, reloadTimers = {};

  function check(res) { if (res.error) throw res.error; return res.data; }

  var supa = {
    load: function (table) {
      var q = sb.from(table).select('*');
      if (table === 'events') q = q.order('created_at', { ascending: false }).limit(60);
      return q.then(check).then(function (rows) { store.state[table] = rows || []; });
    },
    loadSettings: function () {
      return sb.from('settings').select('*').then(check).then(function (rows) {
        var s = {}; (rows || []).forEach(function (r) { s[r.key] = r.value; });
        store.state.settings = withDefaults(s);
      });
    },
    loadMembers: function () {
      return sb.from('allowed_emails').select('*').then(check).then(function (rows) { store.state.members = rows || []; });
    },
    loadAll: function () {
      return Promise.all(TABLES.map(supa.load).concat([supa.loadSettings(), supa.loadMembers()]));
    },
    insert: function (table, row) { return sb.from(table).insert(row).then(check); },
    update: function (table, id, patch) { return sb.from(table).update(patch).eq('id', id).then(check); },
    remove: function (table, id) { return sb.from(table).delete().eq('id', id).then(check); },
    setSetting: function (key, value) { return sb.from('settings').upsert({ key: key, value: value }).then(check); },
    subscribe: function () {
      if (supa.subscribed) return; supa.subscribed = true;
      sb.channel('qg').on('postgres_changes', { event: '*', schema: 'public' }, function (payload) {
        var t = payload.table;
        clearTimeout(reloadTimers[t]);
        reloadTimers[t] = setTimeout(function () {
          var job = t === 'settings' ? supa.loadSettings() : t === 'allowed_emails' ? supa.loadMembers()
            : TABLES.indexOf(t) >= 0 ? supa.load(t) : null;
          if (job) job.then(store.emit).catch(console.error);
        }, 250);
      }).subscribe();
    }
  };

  /* ------------------------------------------------------------ API commune */
  function backend() { return store.mode === 'supabase' ? supa : local; }

  function guard(promise, what) {
    return promise.catch(function (err) {
      console.error(err);
      if (K.ui) K.ui.toast((what || 'Enregistrement') + ' impossible : ' + (err.message || err), 'error');
      if (store.mode === 'supabase') return supa.loadAll().then(store.emit).catch(console.error); // resynchronise sur la vérité du serveur
    });
  }

  store.insert = function (table, row) {
    row = Object.assign({ id: uuid() }, row);
    if (table === 'events') store.state.events.unshift(row); else store.state[table].push(row);
    store.emit();
    return guard(backend().insert(table, row)).then(function () { return row; });
  };
  store.insertMany = function (table, rows) {
    rows = rows.map(function (r) { return Object.assign({ id: uuid() }, r); });
    Array.prototype.push.apply(store.state[table], rows);
    store.emit();
    return guard(backend().insert(table, rows), 'Import');
  };
  store.update = function (table, id, patch) {
    var row = store.state[table].find(function (r) { return r.id === id; });
    if (row) Object.assign(row, patch);
    store.emit();
    return guard(backend().update(table, id, patch));
  };
  store.remove = function (table, id) {
    store.state[table] = store.state[table].filter(function (r) { return r.id !== id; });
    if (table === 'players') { // mêmes cascades que les clés étrangères côté SQL
      store.state.links = store.state.links.filter(function (l) { return l.hunter_id !== id && l.target_id !== id; });
      store.state.kills = store.state.kills.filter(function (k) { return k.victim_id !== id; });
      store.state.kills.forEach(function (k) { if (k.killer_id === id) k.killer_id = null; });
    }
    if (table === 'rounds') {
      store.state.links = store.state.links.filter(function (l) { return l.round_id !== id; });
      store.state.kills.forEach(function (k) { if (k.round_id === id) k.round_id = null; });
    }
    store.emit();
    return guard(backend().remove(table, id), 'Suppression');
  };
  store.setSetting = function (key, value) {
    store.state.settings[key] = value;
    store.emit();
    return guard(backend().setSetting(key, value));
  };
  store.log = function (text) {
    var actor = store.user && store.user.email ? store.user.email.split('@')[0] : '';
    return store.insert('events', { text: text, actor: actor, created_at: new Date().toISOString() });
  };
  store.player = function (id) { return store.state.players.find(function (p) { return p.id === id; }) || null; };

  /* ----- accès (liste blanche d'e-mails) ----- */
  store.addMember = function (email, role) {
    var row = { email: email.trim().toLowerCase(), role: role || 'member' };
    store.state.members.push(row); store.emit();
    if (store.mode !== 'supabase') return Promise.resolve();
    return guard(sb.from('allowed_emails').insert(row).then(check), 'Ajout');
  };
  store.removeMember = function (email) {
    store.state.members = store.state.members.filter(function (m) { return m.email !== email; }); store.emit();
    if (store.mode !== 'supabase') return Promise.resolve();
    return guard(sb.from('allowed_emails').delete().eq('email', email).then(check), 'Retrait');
  };

  /* ----- photos : bucket privé, URL signées d'une heure ----- */
  store.photoUrl = function (p) {
    if (!p || !p.photo_path) return null;
    if (p.photo_path.indexOf('data:') === 0) return p.photo_path;
    var hit = signed.get(p.photo_path);
    if (hit && hit.exp > Date.now()) return hit.url;
    refreshSigned();
    return null;
  };
  function refreshSigned() {
    if (signing || store.mode !== 'supabase') return;
    var paths = store.state.players.map(function (p) { return p.photo_path; }).filter(function (path) {
      if (!path || path.indexOf('data:') === 0) return false;
      var hit = signed.get(path); return !hit || hit.exp <= Date.now();
    });
    if (!paths.length) return;
    signing = true;
    sb.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600).then(function (res) {
      signing = false;
      if (res.error) { console.error(res.error); paths.forEach(function (p) { signed.set(p, { url: null, exp: Date.now() + 6e4 }); }); return; }
      (res.data || []).forEach(function (d, i) { signed.set(d.path || paths[i], { url: d.signedUrl || null, exp: Date.now() + 50 * 6e4 }); });
      store.emit();
    }).catch(function (e) { signing = false; console.error(e); });
  }

  /* Réduit l'image dans un canvas avant envoi : fichier léger, et les métadonnées EXIF (GPS…) disparaissent. */
  function shrink(file, max) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var side = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = Math.min(max, side);
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }
  store.setPhoto = function (playerId, file) {
    var p = store.player(playerId); if (!p) return Promise.resolve();
    if (store.mode !== 'supabase') {
      return shrink(file, 240).then(function (c) { return store.update('players', playerId, { photo_path: c.toDataURL('image/jpeg', 0.8) }); });
    }
    var old = p.photo_path, path = playerId + '-' + Date.now() + '.jpg';
    return guard(shrink(file, 640).then(function (c) {
      return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
    }).then(function (blob) {
      return sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    }).then(check).then(function () {
      if (old) sb.storage.from(PHOTO_BUCKET).remove([old]);
      return store.update('players', playerId, { photo_path: path });
    }), 'Envoi de la photo');
  };
  store.removePhoto = function (playerId) {
    var p = store.player(playerId); if (!p || !p.photo_path) return Promise.resolve();
    if (store.mode === 'supabase' && p.photo_path.indexOf('data:') !== 0) sb.storage.from(PHOTO_BUCKET).remove([p.photo_path]);
    return store.update('players', playerId, { photo_path: null });
  };

  /* ----- fin de partie : tout ce qui est personnel disparaît, le catalogue d'armes et les réglages restent ----- */
  store.purge = function () {
    var paths = store.state.players.map(function (p) { return p.photo_path; }).filter(function (p) { return p && p.indexOf('data:') !== 0; });
    ['players', 'rounds', 'links', 'kills', 'events'].forEach(function (t) { store.state[t] = []; });
    store.emit();
    if (store.mode !== 'supabase') { local.persist(); return Promise.resolve(); }
    var all = '00000000-0000-0000-0000-000000000000';
    var jobs = paths.length ? [sb.storage.from(PHOTO_BUCKET).remove(paths)] : [];
    return guard(Promise.all(jobs).then(function () {
      // l'ordre compte : liens et kills dépendent des joueurs et des boucles
      return sb.from('links').delete().neq('id', all).then(check);
    }).then(function () { return sb.from('kills').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('players').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('rounds').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('events').delete().neq('id', all).then(check); }), 'Purge');
  };
  store.resetDemo = function () { return local.reset().then(store.emit); };

  /* ----- authentification ----- */
  store.auth = {
    signIn: function (email, password) { return sb.auth.signInWithPassword({ email: email, password: password }); },
    signUp: function (email, password) {
      return sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + location.pathname } });
    },
    resetPassword: function (email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); },
    updatePassword: function (password) { return sb.auth.updateUser({ password: password }); },
    signOut: function () { return sb.auth.signOut(); }
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('Chargement impossible : ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* Démarrage. handlers = { onSignedOut, onNotMember, onReady, onRecovery } */
  store.boot = function (handlers) {
    var cfg = window.KILLER_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      store.mode = 'local';
      return local.init().then(handlers.onReady);
    }
    store.mode = 'supabase';
    var ready = window.supabase ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    return ready.then(function () {
      sb = store.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      var started = false;
      function enter(session) {
        store.user = session ? session.user : null;
        if (!session) { // à la déconnexion, plus rien de la partie ne reste en mémoire
          started = false; signed.clear();
          TABLES.concat(['members']).forEach(function (t) { store.state[t] = []; });
          return handlers.onSignedOut();
        }
        if (started) return; started = true;
        return Promise.all([sb.rpc('is_member').then(check), sb.rpc('is_admin').then(check)]).then(function (r) {
          store.isMember = !!r[0]; store.isAdmin = !!r[1];
          if (!store.isMember) return handlers.onNotMember();
          return supa.loadAll().then(function () { supa.subscribe(); handlers.onReady(); });
        }).catch(function (err) { started = false; console.error(err); handlers.onError(err); });
      }
      sb.auth.onAuthStateChange(function (event, session) {
        if (event === 'PASSWORD_RECOVERY') return handlers.onRecovery();
        if (event === 'SIGNED_OUT') return enter(null);
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(function () { enter(session); }, 0);
      });
    });
  };
})();
