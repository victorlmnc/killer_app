/* Data layer. Two adapters behind one API:
   - supabase: the shared database (when js/config.js is filled in)
   - local:    localStorage + demo game, so the app can be tried without any setup */
(function () {
  'use strict';
  var K = (window.K = window.K || {});
  var TABLES = ['players', 'rounds', 'links', 'kills', 'weapons', 'events', 'spots', 'bonuses'];
  var LOCAL_KEY = 'killer.local.v1';
  var PHOTO_BUCKET = 'photos';
  var ROLES = ['admin', 'member', 'observer'];

  var listeners = [];
  var store = K.store = {
    mode: 'local',
    state: { players: [], rounds: [], links: [], kills: [], weapons: [], events: [], spots: [], bonuses: [], settings: {}, members: [] },
    user: null, role: null,
    ROLES: ROLES,
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    emit: function () { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  };

  /* ----- permissions ----- */
  store.isAdmin = function () { return store.role === 'admin' && !store.offline; };
  store.canEdit = function () { return (store.role === 'admin' || store.role === 'member') && !store.offline; };   // offline copy: read-only
  store.me = function () {
    var email = String((store.user && store.user.email) || '').toLowerCase();
    return store.state.members.find(function (m) { return String(m.email).toLowerCase() === email; }) || null;
  };
  /* Tabs an account may open. Observers get the list chosen by the admin; others get everything. */
  store.allowedTabs = function (all) {
    var me = store.me();
    var tabs = all.filter(function (id) { return id !== 'settings' || store.isAdmin(); });
    if (store.role === 'observer' && me && Array.isArray(me.tabs)) tabs = tabs.filter(function (id) { return me.tabs.indexOf(id) >= 0; });
    return tabs;
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
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
      try { saved = JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { /* storage unavailable */ }
      var data = saved && saved.players ? saved : K.seed.demo();
      TABLES.concat(['members']).forEach(function (t) { store.state[t] = data[t] || []; });
      store.state.settings = withDefaults(data.settings);
      store.user = { email: 'demo@local' };
      if (!store.state.members.length) store.state.members = [{ email: 'demo@local', name: '', role: 'admin', tabs: null, avatar_path: null }];
      store.role = 'admin';
      return Promise.resolve();
    },
    persist: function () { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(store.state)); } catch (e) { /* quota or private mode */ } },
    reset: function () { try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ } return local.init(); }
  };
  ['insert', 'update', 'remove', 'setSetting', 'member'].forEach(function (op) { local[op] = function () { local.persist(); return Promise.resolve(); }; });

  /* --------------------------------------------------------------- supabase */
  var sb = null, signed = new Map(), signing = false, reloadTimers = {};
  function check(res) { if (res.error) throw res.error; return res.data; }

  var supa = {
    load: function (table) {
      var q = sb.from(table).select('*');
      if (table === 'events') q = q.order('created_at', { ascending: false }).limit(80);
      return q.then(check).then(function (rows) { store.state[table] = rows || []; }, function (err) {
        // a table added by a newer version while supabase/schema.sql has not been run again: empty, the rest works
        if (/does not exist|schema cache|42P01|PGRST20[45]/i.test((err && (err.code + ' ' + err.message)) || '')) { console.warn('Table missing, run supabase/schema.sql again:', table); store.state[table] = []; return; }
        throw err;
      });
    },
    loadSettings: function () {
      return sb.from('settings').select('*').then(check).then(function (rows) {
        var s = {}; (rows || []).forEach(function (r) { s[r.key] = r.value; });
        store.state.settings = withDefaults(s);
      });
    },
    loadMembers: function () { return sb.from('accounts').select('*').then(check).then(function (rows) { store.state.members = rows || []; }); },
    loadAll: function () { return Promise.all(TABLES.map(supa.load).concat([supa.loadSettings(), supa.loadMembers()])); },
    insert: function (table, row) { return sb.from(table).insert(row).then(check); },
    update: function (table, id, patch) { return sb.from(table).update(patch).eq('id', id).then(check); },
    remove: function (table, id) { return sb.from(table).delete().eq('id', id).then(check); },
    setSetting: function (key, value) { return sb.from('settings').upsert({ key: key, value: value }).then(check); },
    subscribe: function () {
      if (supa.subscribed) return; supa.subscribed = true;
      sb.channel('killer').on('postgres_changes', { event: '*', schema: 'public' }, function (payload) {
        var t = payload.table;
        clearTimeout(reloadTimers[t]);
        reloadTimers[t] = setTimeout(function () {
          var job = t === 'settings' ? supa.loadSettings() : t === 'accounts' ? supa.loadMembers() : TABLES.indexOf(t) >= 0 ? supa.load(t) : null;
          if (job) job.then(function () { if (t === 'accounts') refreshRole(); store.emit(); }).catch(console.error);
        }, 250);
      }).subscribe();
    }
  };
  function refreshRole() { var me = store.me(); if (me && ROLES.indexOf(me.role) >= 0) store.role = me.role; }

  /* ------------------------------------------------------------ common API */
  function backend() { return store.mode === 'supabase' ? supa : local; }
  function guard(promise, what) {
    return promise.catch(function (err) {
      console.error(err);
      if (K.ui) K.ui.toast((what || K.t('Save')) + ' — ' + (err.message || err), 'error');
      if (store.mode === 'supabase') return supa.loadAll().then(store.emit).catch(console.error);
    });
  }
  function denied() { if (K.ui) K.ui.toast(K.t('Read-only account: you cannot change the game data.'), 'error'); return Promise.resolve(null); }

  store.insert = function (table, row) {
    if (!store.canEdit()) return denied();
    row = Object.assign({ id: uuid() }, row);
    if (table === 'events') store.state.events.unshift(row); else store.state[table].push(row);
    store.emit();
    return guard(backend().insert(table, row)).then(function () { return row; });
  };
  store.insertMany = function (table, rows) {
    if (!store.canEdit()) return denied();
    rows = rows.map(function (r) { return Object.assign({ id: uuid() }, r); });
    Array.prototype.push.apply(store.state[table], rows);
    store.emit();
    return guard(backend().insert(table, rows), K.t('Import')).then(function () { return rows; });
  };
  store.update = function (table, id, patch) {
    if (!store.canEdit()) return denied();
    var row = store.state[table].find(function (r) { return r.id === id; });
    if (row) Object.assign(row, patch);
    store.emit();
    return guard(backend().update(table, id, patch));
  };
  store.remove = function (table, id) {
    if (!store.canEdit()) return denied();
    store.state[table] = store.state[table].filter(function (r) { return r.id !== id; });
    if (table === 'players') { // mirror the SQL foreign-key cascades
      store.state.links = store.state.links.filter(function (l) { return l.hunter_id !== id && l.target_id !== id; });
      store.state.kills = store.state.kills.filter(function (k) { return k.victim_id !== id; });
      store.state.kills.forEach(function (k) { if (k.killer_id === id) k.killer_id = null; });
    }
    if (table === 'rounds') {
      store.state.links = store.state.links.filter(function (l) { return l.round_id !== id; });
      store.state.kills.forEach(function (k) { if (k.round_id === id) k.round_id = null; });
    }
    store.emit();
    return guard(backend().remove(table, id), K.t('Delete'));
  };
  store.setSetting = function (key, value) {
    if (!store.isAdmin()) return denied();
    store.state.settings[key] = value;
    store.emit();
    return guard(backend().setSetting(key, value));
  };
  store.displayName = function (email) {
    email = String(email || (store.user && store.user.email) || '').toLowerCase();
    var m = store.state.members.find(function (x) { return String(x.email).toLowerCase() === email; });
    return (m && m.name) || email.split('@')[0] || '';
  };
  /* Activity log: a short line plus the event details (ids, note, source...) so it can be reopened from the dashboard. */
  store.log = function (text, details) {
    if (!store.canEdit()) return Promise.resolve(null);
    return store.insert('events', { text: text, actor: store.displayName(), details: details || null, created_at: new Date().toISOString() });
  };
  store.clearEvents = function () {
    if (!store.isAdmin()) return denied();
    store.state.events = []; store.emit();
    if (store.mode !== 'supabase') { local.persist(); return Promise.resolve(); }
    return guard(sb.from('events').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(check), K.t('Clear log'));
  };
  store.player = function (id) { return store.state.players.find(function (p) { return p.id === id; }) || null; };
  /* The player sheet linked to the signed-in account, if any. */
  store.myPlayer = function () { var me = store.me(); return me && me.player_id ? store.player(me.player_id) : null; };

  /* ----- timetables: iCal layers (settings.calendars), fetched through the "edt" edge function ----- */
  var calendars = new Map(), CALENDAR_TTL = 30 * 6e4;
  function hashString(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  store.calendarsFor = function (p) { return K.logic.calendarsFor(p, store.state.settings.calendars); };
  /* One link -> { name, events } (cached 30 min, shared by every player of that layer). */
  store.calendar = function (url) {
    var hit = calendars.get(url);
    if (hit && Date.now() - hit.at < CALENDAR_TTL) return hit.promise;
    var job = store.mode === 'supabase'
      ? sb.functions.invoke('edt', { body: { url: url } }).then(function (res) {
          if (res.error) return (res.error.context && res.error.context.text ? res.error.context.text() : Promise.resolve(res.error.message)).then(function (m) { throw new Error(m); });
          return res.data;
        })
      : fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });   // demo: works only if the server allows it
    var key = 'killer.cal.' + hashString(url);
    job = job.then(function (text) {
      if (store.mode === 'supabase' && typeof text === 'string') { try { localStorage.setItem(key, text); } catch (e) { /* quota */ } }
      return text;
    }, function (err) {   // offline: the last copy of that timetable, if any
      var kept = null; try { kept = localStorage.getItem(key); } catch (e) { /* none */ }
      if (kept) return kept;
      throw err;
    });
    var promise = job.then(function (text) { text = typeof text === 'string' ? text : ''; return { name: K.logic.icsCalendarName(text), events: K.logic.parseIcs(text) }; });
    promise.catch(function () { calendars.delete(url); });   // failures are retried next time
    calendars.set(url, { at: Date.now(), promise: promise });
    return promise;
  };
  /* A player's whole timetable: every layer that applies to them, merged. Fails only if every layer fails. */
  store.playerEvents = function (p) {
    var layers = store.calendarsFor(p), errors = [];
    return Promise.all(layers.map(function (c) { return store.calendar(c.url).then(function (cal) { return cal.events; }, function (e) { errors.push(e); return null; }); }))
      .then(function (lists) {
        var ok = lists.filter(Boolean);
        if (!ok.length && errors.length) throw errors[0];
        var events = K.logic.mergeEvents(ok).filter(function (e) { return K.logic.eventForPlayer(e, p); });   // only their groups' classes
        return { events: events, layers: layers.length, failed: errors.length };
      });
  };

  /* ----- accounts (email allow-list with roles) ----- */
  function memberJob(promise, what) { if (store.mode !== 'supabase') return local.member(); return guard(promise.then(check), what); }
  store.addMember = function (email, name, role, tabs) {
    if (!store.isAdmin()) return denied();
    var row = { email: email.trim().toLowerCase(), name: (name || '').trim(), role: ROLES.indexOf(role) >= 0 ? role : 'member', tabs: tabs || null, avatar_path: null };
    store.state.members.push(row); store.emit();
    return memberJob(store.mode === 'supabase' ? sb.from('accounts').insert(row) : null, K.t('Add'));
  };
  store.updateMember = function (email, patch) {
    var mine = store.me() && store.me().email === email;
    if (!store.isAdmin() && !mine) return denied();
    if (!store.isAdmin()) patch = { name: patch.name, avatar_path: patch.avatar_path, player_id: patch.player_id }; // only the admin touches roles and tabs
    Object.keys(patch).forEach(function (k) { if (patch[k] === undefined) delete patch[k]; });
    var m = store.state.members.find(function (x) { return x.email === email; });
    if (m) Object.assign(m, patch);
    if (mine || store.isAdmin()) refreshRole();
    store.emit();
    return memberJob(store.mode === 'supabase' ? sb.from('accounts').update(patch).eq('email', email) : null, K.t('Update'));
  };
  store.removeMember = function (email) {
    if (!store.isAdmin()) return denied();
    store.state.members = store.state.members.filter(function (m) { return m.email !== email; }); store.emit();
    return memberJob(store.mode === 'supabase' ? sb.from('accounts').delete().eq('email', email) : null, K.t('Remove'));
  };

  /* ----- photos: private bucket, one-hour signed URLs ----- */
  store.photoUrl = function (path) {
    if (path && typeof path === 'object') path = path.photo_path;
    if (!path) return null;
    if (path.indexOf('data:') === 0) return path;
    var hit = signed.get(path);
    if (hit && hit.exp > Date.now()) return hit.url;
    refreshSigned();
    return null;
  };
  function allPhotoPaths() {
    return store.state.players.map(function (p) { return p.photo_path; }).concat(store.state.members.map(function (m) { return m.avatar_path; }))
      .filter(function (path) { return path && path.indexOf('data:') !== 0; });
  }
  function refreshSigned() {
    if (signing || store.mode !== 'supabase') return;
    var paths = allPhotoPaths().filter(function (path) { var hit = signed.get(path); return !hit || hit.exp <= Date.now(); });
    if (!paths.length) return;
    signing = true;
    sb.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600).then(function (res) {
      signing = false;
      if (res.error) { console.error(res.error); paths.forEach(function (p) { signed.set(p, { url: null, exp: Date.now() + 6e4 }); }); return; }
      (res.data || []).forEach(function (d, i) { signed.set(d.path || paths[i], { url: d.signedUrl || null, exp: Date.now() + 50 * 6e4 }); });
      store.emit();
    }).catch(function (e) { signing = false; console.error(e); });
  }
  /* Square-crops and recompresses in a canvas before upload: small file, and EXIF metadata (GPS...) is dropped. */
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
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(K.t('Unreadable image'))); };
      img.src = url;
    });
  }
  var GIF_MAX = { supabase: 1048576, local: 400 * 1024 };   // animated GIFs are stored as-is, so they are capped by size
  function isGif(file) { return file && file.type === 'image/gif'; }
  function gifTooBig(file) { return isGif(file) && file.size > GIF_MAX[store.mode]; }
  function gifDataUrl(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error(K.t('Unreadable image'))); }; r.readAsDataURL(file); }); }
  function localImage(file, max) { return isGif(file) ? gifDataUrl(file) : shrink(file, max).then(function (c) { return c.toDataURL('image/jpeg', 0.8); }); }
  function tooBig() { if (K.ui) K.ui.toast(K.t('This GIF is too large ({kb} kB max).', { kb: Math.round(GIF_MAX[store.mode] / 1024) }), 'error'); return Promise.resolve(null); }
  function uploadImage(file, path, old) {
    if (isGif(file)) {
      return guard(sb.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: 'image/gif', upsert: true }).then(check)
        .then(function () { if (old && old !== path) sb.storage.from(PHOTO_BUCKET).remove([old]); signed.delete(path); return path; }), K.t('Photo upload'));
    }
    return guard(shrink(file, 640).then(function (c) { return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); }); })
      .then(function (blob) { return sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true }); }).then(check)
      .then(function () { if (old && old !== path) sb.storage.from(PHOTO_BUCKET).remove([old]); signed.delete(path); return path; }), K.t('Photo upload'));
  }
  store.setPhoto = function (playerId, file) {
    var p = store.player(playerId); if (!p || !store.canEdit()) return denied();
    if (gifTooBig(file)) return tooBig();
    if (store.mode !== 'supabase') return localImage(file, 240).then(function (url) { return store.update('players', playerId, { photo_path: url }); });
    return uploadImage(file, 'players/' + playerId + '-' + Date.now() + (isGif(file) ? '.gif' : '.jpg'), p.photo_path).then(function (path) { if (path) return store.update('players', playerId, { photo_path: path }); });
  };
  store.removePhoto = function (playerId) {
    var p = store.player(playerId); if (!p || !p.photo_path) return Promise.resolve();
    if (store.mode === 'supabase' && p.photo_path.indexOf('data:') !== 0) sb.storage.from(PHOTO_BUCKET).remove([p.photo_path]);
    return store.update('players', playerId, { photo_path: null });
  };
  store.setAvatar = function (file) {
    var me = store.me(); if (!me) return Promise.resolve();
    if (gifTooBig(file)) return tooBig();
    if (store.mode !== 'supabase') return localImage(file, 160).then(function (url) { return store.updateMember(me.email, { avatar_path: url }); });
    return uploadImage(file, 'avatars/' + store.user.id + (isGif(file) ? '.gif' : '.jpg'), me.avatar_path).then(function (path) { if (path) return store.updateMember(me.email, { avatar_path: path }); });
  };

  /* ----- end of game: everything personal goes, the weapon catalogue, spots and settings stay ----- */
  store.purge = function () {
    if (!store.isAdmin()) return denied();
    var paths = store.state.players.map(function (p) { return p.photo_path; }).filter(function (p) { return p && p.indexOf('data:') !== 0; });
    ['players', 'rounds', 'links', 'kills', 'events', 'bonuses'].forEach(function (t) { store.state[t] = []; });
    store.emit();
    if (store.mode !== 'supabase') { local.persist(); return Promise.resolve(); }
    var all = '00000000-0000-0000-0000-000000000000';
    var jobs = paths.length ? [sb.storage.from(PHOTO_BUCKET).remove(paths)] : [];
    return guard(Promise.all(jobs)
      .then(function () { return sb.from('bonuses').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('links').delete().neq('id', all).then(check); })   // order matters: links and kills reference players and rounds
      .then(function () { return sb.from('kills').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('players').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('rounds').delete().neq('id', all).then(check); })
      .then(function () { return sb.from('events').delete().neq('id', all).then(check); }), K.t('Reset'));
  };
  store.resetDemo = function () { return local.reset().then(store.emit); };

  /* ----- nightly backups (supabase/schema.sql: game_backups, take_backup, pg_cron) ----- */
  store.nightly = {
    available: function () { return store.mode === 'supabase' && store.isAdmin(); },
    list: function () { return sb.from('game_backups').select('id, taken_at').order('taken_at', { ascending: false }).limit(30).then(check); },
    get: function (id) { return sb.from('game_backups').select('data').eq('id', id).single().then(check).then(function (row) { return row.data; }); },
    take: function () { return sb.rpc('take_backup').then(check); }
  };

  /* ----- full backup: the whole game in one file, photos embedded as data URLs ----- */
  function blobToDataUrl(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function inBatches(items, size, fn) {
    var i = 0;
    function next() { var chunk = items.slice(i, i += size); return chunk.length ? Promise.all(chunk.map(fn)).then(next) : Promise.resolve(); }
    return next();
  }
  function allEvents() {   // the app keeps only the latest 80 in memory
    var out = [];
    function page(from) {
      return sb.from('events').select('*').order('created_at', { ascending: false }).range(from, from + 999).then(check)
        .then(function (rows) { out = out.concat(rows || []); return rows && rows.length === 1000 ? page(from + 1000) : out; });
    }
    return page(0);
  }
  /* Resolves to the backup object. onProgress(done, total) while photos download. */
  store.snapshot = function (withPhotos, onProgress) {
    var copy = JSON.parse(JSON.stringify(store.state));
    delete copy.members;
    var events = store.mode === 'supabase' ? allEvents().then(function (rows) { copy.events = rows; }) : Promise.resolve();
    return events.then(function () {
      var photos = copy.players.filter(function (p) { return p.photo_path; });
      if (!withPhotos) { photos.forEach(function (p) { p.photo_path = null; }); return; }
      var done = 0;
      return inBatches(photos.filter(function (p) { return p.photo_path.indexOf('data:') !== 0; }), 6, function (p) {
        return sb.storage.from(PHOTO_BUCKET).download(p.photo_path).then(check).then(blobToDataUrl)
          .then(function (url) { p.photo_path = url; }, function (e) { console.error(e); p.photo_path = null; })
          .then(function () { if (onProgress) onProgress(++done, photos.length); });
      });
    }).then(function () { return K.logic.makeBackup(copy); });
  };

  /* Replaces the game with a backup read by K.logic.readBackup. opts.catalogue also replaces weapons, spots and settings.
     Resolves to true when everything was written. */
  store.restore = function (data, opts) {
    if (!store.isAdmin()) return denied().then(function () { return false; });
    opts = opts || {};
    var GAME = ['players', 'rounds', 'links', 'kills', 'events', 'bonuses'], tables = opts.catalogue ? GAME.concat(['weapons', 'spots']) : GAME;
    if (store.mode !== 'supabase') {
      tables.forEach(function (t) { store.state[t] = data[t]; });
      store.state.players.forEach(function (p) { if (p.photo_path && p.photo_path.indexOf('data:') !== 0) p.photo_path = null; });   // storage paths mean nothing here
      if (opts.catalogue) store.state.settings = withDefaults(data.settings);
      local.persist(); store.emit();
      return Promise.resolve(true);
    }
    var all = '00000000-0000-0000-0000-000000000000', stamp = Date.now();
    // 1. photos go to storage first, so the rows are written with their final paths
    var uploads = inBatches(data.players.filter(function (p) { return p.photo_path && p.photo_path.indexOf('data:') === 0; }), 4, function (p) {
      return fetch(p.photo_path).then(function (r) { return r.blob(); }).then(function (blob) {
        var gif = blob.type === 'image/gif', path = 'players/' + p.id + '-' + stamp + (gif ? '.gif' : '.jpg');
        if (blob.size > GIF_MAX.supabase) throw new Error('photo too large');
        return sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: gif ? 'image/gif' : 'image/jpeg', upsert: true }).then(check).then(function () { p.photo_path = path; });
      }).catch(function (e) { console.error(e); p.photo_path = null; });
    });
    function wipe(t) { return sb.from(t).delete().neq('id', all).then(check); }
    function fill(t) { return inBatches(chunks(data[t], 500), 1, function (rows) { return sb.from(t).insert(rows).then(check); }); }
    return uploads.then(function () {
      // 2. old photos that the backup does not reuse
      var keep = new Set(data.players.map(function (p) { return p.photo_path; }));
      var old = store.state.players.map(function (p) { return p.photo_path; }).filter(function (p) { return p && p.indexOf('data:') !== 0 && !keep.has(p); });
      return old.length ? sb.storage.from(PHOTO_BUCKET).remove(old) : null;
    })
      // 3. empty the tables, references first; 4. refill, referenced tables first
      .then(function () { return ['bonuses', 'links', 'kills', 'events', 'players', 'rounds'].concat(opts.catalogue ? ['weapons', 'spots'] : []).reduce(function (p, t) { return p.then(function () { return wipe(t); }); }, Promise.resolve()); })
      .then(function () { return ['rounds', 'players', 'links', 'kills', 'events', 'bonuses'].concat(opts.catalogue ? ['weapons', 'spots'] : []).reduce(function (p, t) { return p.then(function () { return fill(t); }); }, Promise.resolve()); })
      .then(function () {
        if (!opts.catalogue) return;
        var rows = Object.keys(data.settings).map(function (k) { return { key: k, value: data.settings[k] }; });
        return rows.length ? sb.from('settings').upsert(rows).then(check) : null;
      })
      .then(function () { return true; }, function (err) { console.error(err); if (K.ui) K.ui.toast(K.t('Restore') + ' — ' + (err.message || err), 'error'); return false; })
      .then(function (ok) { return supa.loadAll().then(store.emit).then(function () { return ok; }, function () { return ok; }); });
  };
  function chunks(rows, size) { var out = []; for (var i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size)); return out; }

  /* ----- auth ----- */
  store.auth = {
    signIn: function (email, password) { return sb.auth.signInWithPassword({ email: email, password: password }); },
    signUp: function (email, password) { return sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: location.origin + location.pathname } }); },
    resetPassword: function (email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); },
    updatePassword: function (password) { return sb.auth.updateUser({ password: password }); },
    signOut: function () { return sb.auth.signOut(); }
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* Boot. handlers = { onSignedOut, onNotMember, onReady, onRecovery, onError } */
  /* ----- offline copy: the last data loaded, kept on this device to open the app without a connection ----- */
  var CACHE_KEY = 'killer.cache.v1', cacheTimer = null;
  function saveCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () {
      if (store.mode !== 'supabase' || store.offline || !store.user || !store.role) return;
      var copy = { at: Date.now(), email: String(store.user.email || '').toLowerCase(), role: store.role, state: {} };
      TABLES.concat(['members', 'settings']).forEach(function (t) { copy.state[t] = store.state[t]; });
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(copy)); } catch (e) { /* quota: no offline copy */ }
    }, 2000);
  }
  function dropCache() { try { localStorage.removeItem(CACHE_KEY); Object.keys(localStorage).filter(function (k) { return k.indexOf('killer.cal.') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ } }
  /* Opens the offline copy (read-only) when it belongs to that account (any account when email is null). */
  function offlineStart(email, handlers) {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { /* none */ }
    if (!c || !c.state || (email && c.email !== String(email).toLowerCase())) return false;
    TABLES.concat(['members']).forEach(function (t) { store.state[t] = c.state[t] || []; });
    store.state.settings = withDefaults(c.state.settings);
    store.user = store.user || { email: c.email }; store.role = c.role; store.offline = { at: c.at };
    handlers.onReady();
    return true;
  }
  store.boot = function (handlers) {
    var cfg = window.KILLER_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { store.mode = 'local'; return local.init().then(handlers.onReady); }
    store.mode = 'supabase';
    var ready = window.supabase ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    ready = ready.catch(function (err) { if (offlineStart(null, handlers)) return 'offline'; throw err; });   // no network, no library
    return ready.then(function (state) {
      if (state === 'offline') return;
      sb = store.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      var started = false;
      function enter(session) {
        store.user = session ? session.user : null;
        if (!session) {
          if (!navigator.onLine && offlineStart(null, handlers)) return;   // the session could not be refreshed without a connection
          started = false; signed.clear(); store.role = null; dropCache();
          TABLES.concat(['members']).forEach(function (t) { store.state[t] = []; });
          return handlers.onSignedOut();
        }
        if (started) return; started = true;
        return sb.rpc('my_role').then(check).then(function (role) {
          store.role = ROLES.indexOf(role) >= 0 ? role : null;
          if (!store.role) return handlers.onNotMember();
          return supa.loadAll().then(function () { supa.subscribe(); store.on(saveCache); saveCache(); handlers.onReady(); });
        }).catch(function (err) {
          started = false; console.error(err);
          if (offlineStart(session.user.email, handlers)) return;   // no connection: last copy, read-only
          handlers.onError(err);
        });
      }
      sb.auth.onAuthStateChange(function (event, session) {
        if (event === 'PASSWORD_RECOVERY') return handlers.onRecovery();
        if (event === 'SIGNED_OUT') return enter(null);
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(function () { enter(session); }, 0);
      });
    });
  };
})();
