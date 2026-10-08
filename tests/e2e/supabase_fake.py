"""Data layer against a fake Supabase client: sign-in, roles, writes, realtime, signed photos, purge."""
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from _common import URL, context, collect_errors
from playwright.sync_api import sync_playwright, expect
FAKE = r"""
window.__calls = []; window.__db = { players: [{id:'p1',name:'VALJEAN Jean',year:'3A',td:'TD1',points:2,photo_path:'p1.jpg'},{id:'p2',name:'JAVERT Émile',year:'4A',td:'TD2',points:0}],
  rounds: [], links: [], kills: [], weapons: [], events: [], spots: [], bonuses: [], homes: [], intel: [], settings: [{key:'game_name', value:'Killer test'}], accounts: [{email:'moi@test.fr', name:'', role:'admin', tabs:null, avatar_path:null}] };
window.supabase = { createClient: function (url, key) {
  window.__calls.push(['createClient', url, key]);
  var authCb = null, session = null;
  function builder(table) {
    var op = { table: table, type: 'select', filters: [] };
    var b = {
      select: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
      insert: function (rows) { op.type = 'insert'; op.rows = rows; return b; },
      upsert: function (rows) { op.type = 'upsert'; op.rows = rows; return b; },
      update: function (patch) { op.type = 'update'; op.patch = patch; return b; },
      delete: function () { op.type = 'delete'; return b; },
      eq: function (c, v) { op.filters.push(['eq', c, v]); return b; }, neq: function (c, v) { op.filters.push(['neq', c, v]); return b; },
      then: function (res, rej) {
        window.__calls.push([op.type, table, op.rows || op.patch || null, op.filters]);
        if (window.__down) return Promise.reject(new TypeError('Failed to fetch')).then(res, rej);   // no network at all
        var t = window.__db[table], refused = window.__fail === table && op.type !== 'select';
        if (refused) return Promise.resolve({ data: null, error: { message: 'RLS refuse' } }).then(res, rej);   // a refused write changes nothing
        if (op.type === 'insert') [].concat(op.rows).forEach(function (r) { t.push(r); });
        if (op.type === 'delete') window.__db[table] = t.filter(function (r) { return !op.filters.every(function (f) { return f[0] === 'eq' ? r[f[1]] === f[2] : r[f[1]] !== f[2]; }); });
        if (op.type === 'update') t.forEach(function (r) { if (op.filters.every(function (f) { return r[f[1]] === f[2]; })) Object.assign(r, op.patch); });
        return Promise.resolve({ data: op.type === 'select' ? JSON.parse(JSON.stringify(window.__db[table])) : null, error: window.__fail === table && op.type !== 'select' ? { message: 'RLS refuse' } : null }).then(res, rej);
      }
    };
    return b;
  }
  return {
    auth: {
      onAuthStateChange: function (cb) { authCb = cb; setTimeout(function () { cb('INITIAL_SESSION', session); }, 0); return { data: { subscription: {} } }; },
      signUp: function (c) { window.__calls.push(['signUp', c.email]); return Promise.resolve({ data: {}, error: null }); },
      resetPasswordForEmail: function (e) { window.__calls.push(['reset', e]); return Promise.resolve({ data: {}, error: null }); },
      signInWithPassword: function (c) {
        if (c.password !== 'bonmotdepasse') return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
        session = { user: { id: 'u1', email: c.email } }; setTimeout(function () { authCb('SIGNED_IN', session); }, 0);
        return Promise.resolve({ data: { session: session }, error: null });
      },
      signOut: function (o) {   // without a network, only a local sign-out works (as with the real library)
        window.__calls.push(['signOut', (o && o.scope) || 'global']);
        if (window.__down && !(o && o.scope === 'local')) return Promise.resolve({ error: { message: 'Failed to fetch' } });
        session = null; setTimeout(function () { authCb('SIGNED_OUT', null); }, 0); return Promise.resolve({ error: null });
      }
    },
    rpc: function (name, args) {
      window.__calls.push(['rpc', name, args || null]);
      if (name === 'set_links') { window.__db.links = window.__db.links.filter(function (l) { return args.p_remove.indexOf(l.id) < 0; }).concat(args.p_add); return Promise.resolve({ data: null, error: window.__fail === 'links' ? { message: 'RLS refuse' } : null }); }
      if (name === 'add_points') { var p = window.__db.players.find(function (x) { return x.id === args.p_player; }); if (p) p.points = Math.max(0, (p.points || 0) + args.p_delta); return Promise.resolve({ data: p ? p.points : null, error: window.__fail === 'players' ? { message: 'RLS refuse' } : null }); }
      return Promise.resolve({ data: window.__role === undefined ? 'admin' : window.__role, error: null });
    },
    from: builder,
    storage: { from: function (bucket) { return {
      createSignedUrls: function (paths, ttl) { window.__calls.push(['sign', bucket, paths, ttl]); return Promise.resolve({ data: paths.map(function (p) { return { path: p, signedUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }; }), error: null }); },
      upload: function (path, blob, o) { window.__calls.push(['upload', bucket, path, blob.type, blob.size]); return Promise.resolve({ data: { path: path }, error: null }); },
      remove: function (paths) { window.__calls.push(['removeFiles', bucket, paths]); return Promise.resolve({ data: [], error: null }); } }; } },
    channel: function () { var ch = { on: function (ev, f, cb) { window.__rt = cb; return ch; }, subscribe: function () { window.__calls.push(['subscribe']); return ch; } }; return ch; }
  };
} };
"""
CONFIG = "window.KILLER_CONFIG = { supabaseUrl: 'https://xyz.supabase.co', supabaseAnonKey: 'anon-key' };"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = context(b, viewport={'width': 1100, 'height': 800})
    ctx.route('**/js/config.js', lambda r: r.fulfill(body=CONFIG, content_type='text/javascript'))
    ctx.add_init_script(FAKE)
    pg = ctx.new_page(); errs = []; collect_errors(pg, errs); pg.add_init_script("localStorage.setItem('killer.lang', 'fr')")
    pg.goto(URL)
    print('· sign-in screen when nobody is signed in')
    expect(pg.locator('.auth-card')).to_contain_text('Espace privé')
    print('· account created / link sent: a calm message, not an error, the address kept')
    pg.get_by_role('button', name='Créer mon compte').click()
    pg.locator('input[type=email]').fill('nouveau@test.fr'); pg.locator('input[type=password]').fill('bonmotdepasse'); pg.get_by_role('button', name='Créer mon compte').click()
    expect(pg.locator('.auth-info')).to_contain_text('Compte créé ! Un e-mail de confirmation a été envoyé à nouveau@test.fr')
    expect(pg.locator('.auth-note')).to_be_hidden(); expect(pg.locator('input[type=email]')).to_have_value('nouveau@test.fr')
    pg.get_by_role('button', name='Mot de passe oublié').click(); pg.locator('input[type=email]').fill('nouveau@test.fr'); pg.get_by_role('button', name='Recevoir le lien').click()
    expect(pg.locator('.auth-info')).to_contain_text('nouveau@test.fr')
    pg.locator('input[type=email]').fill('')
    pg.locator('input[type=email]').fill('moi@test.fr'); pg.locator('input[type=password]').fill('mauvais12')
    pg.get_by_role('button', name='Se connecter').click()
    expect(pg.locator('.auth-note')).to_have_text('E-mail ou mot de passe incorrect.')
    pg.screenshot(path='/tmp/shots/login.png')
    print('· sign-in, role check, load')
    pg.locator('input[type=password]').fill('bonmotdepasse'); pg.get_by_role('button', name='Se connecter').click()
    pg.wait_for_selector('.shell')
    calls = pg.evaluate('window.__calls')
    assert any(c[:2] == ['rpc', 'my_role'] for c in calls) and ['subscribe'] in calls
    assert pg.evaluate('K.store.state.settings.game_name') == 'Killer test'
    assert pg.evaluate('K.store.state.settings.shop.length') == 5          # réglages absents → valeurs par défaut
    assert pg.locator('.demo-flag').count() == 0
    print('· photos: signed URLs requested in one batch')
    pg.goto(URL + '#/players'); pg.wait_for_selector('.row-player img')
    assert [c for c in pg.evaluate('window.__calls') if c[0] == 'sign'] == [['sign', 'photos', ['p1.jpg'], 3600]]
    print('· writes: link (creates the round), kill, setting')
    pg.evaluate("K.actions.setTarget('p1','p2',{confidence:'sur'})"); pg.wait_for_timeout(300)
    db = pg.evaluate('window.__db'); assert len(db['rounds']) == 1 and len(db['links']) == 1 and db['links'][0]['round_id'] == db['rounds'][0]['id']
    assert any(c[:2] == ['rpc', 'set_links'] for c in pg.evaluate('window.__calls')), 'links written in one transaction'
    pg.evaluate("K.actions.recordKill({victimId:'p2', killerId:'p1', weapon:'Banane', points:1, inherit:true})"); pg.wait_for_timeout(300)
    db = pg.evaluate('window.__db'); assert db['kills'][0]['victim_id'] == 'p2' and db['players'][0]['points'] == 3
    assert ['rpc', 'add_points', {'p_player': 'p1', 'p_delta': 1}] in pg.evaluate('window.__calls'), 'points added on the server'
    print('· points: a teammate scoring at the same time is not overwritten')
    pg.evaluate("window.__db.players[0].points += 5"); pg.evaluate("K.store.addPoints('p1', 2)"); pg.wait_for_timeout(200)
    assert pg.evaluate("[window.__db.players[0].points, K.store.player('p1').points]") == [10, 10]
    print('· a kill refused by the server: nothing else written, the screen goes back')
    pg.evaluate("window.__db.players.push({id:'p4', name:'FANTINE', points:0}); K.store.state.players.push({id:'p4', name:'FANTINE', points:0}); window.__fail = 'kills'")
    before = pg.evaluate("K.store.player('p1').points")
    pg.evaluate("() => { K.actions.recordKill({victimId:'p4', killerId:'p1', points:3}); }"); pg.wait_for_timeout(400)
    expect(pg.locator('.toast-error').last).to_contain_text('RLS refuse')
    got = pg.evaluate("[K.store.player('p1').points, window.__db.players[0].points, K.store.state.kills.some(k => k.victim_id === 'p4'), K.store.state.links.length, window.__db.kills.length]"); assert got[:3] == [before, before, False], (got, before)
    pg.evaluate("window.__fail = null")
    pg.evaluate("K.store.setSetting('official_players', 120)"); pg.wait_for_timeout(100)
    assert ['upsert', 'settings', {'key': 'official_players', 'value': 120}, []] in pg.evaluate('window.__calls')
    print('· realtime: a teammate change arrives without reload')
    pg.evaluate("window.__db.players.push({id:'p3', name:'COSETTE Euphrasie', year:'2A', td:'TD1', points:0}); window.__rt({table:'players'})")
    pg.locator('.filterbar').get_by_role('button', name='Tous', exact=True).click()
    expect(pg.locator('.list')).to_contain_text('COSETTE Euphrasie')
    print('· server error: clear message then resync')
    pg.evaluate("window.__fail='players'; window.__db.players[0].points = 77; window.__loadFail = true; K.store.update('players','p1',{points:99}).catch(() => {})")
    expect(pg.locator('.toast-error').last).to_contain_text('RLS refuse')
    assert pg.evaluate("K.store.player('p1').points") != 99, 'the refused change is not left on screen'
    print('· network cut mid-session: the unsaved change is undone, not kept as if saved')
    pg.evaluate("window.__down = true; K.store.update('players','p1',{name:'NOT SAVED'}).catch(() => {})"); pg.wait_for_timeout(300)
    assert pg.evaluate("K.store.player('p1').name") == 'VALJEAN Jean'
    pg.evaluate("window.__down = false"); errs[:] = [e for e in errs if 'Failed to fetch' not in e]   # the cut was on purpose
    pg.evaluate("window.__fail=null")
    print('· display name: saved server-side, signs the log')
    pg.evaluate("K.store.updateMember('moi@test.fr', {name: 'Capitaine'})"); pg.wait_for_timeout(100)
    assert ['update', 'accounts', {'name': 'Capitaine'}, [['eq', 'email', 'moi@test.fr']]] in pg.evaluate('window.__calls')
    ev = pg.evaluate("window.__db.events.slice(-1)[0]"); assert ev['details']['type'] == 'kill' and ev['details']['weapon'] == 'Banane', ev
    pg.evaluate("K.store.log('essai', {type:'link', source:'x'})"); pg.wait_for_timeout(100); assert pg.evaluate("window.__db.events.slice(-1)[0].actor") == 'Capitaine'
    pg.evaluate("K.store.clearEvents()"); pg.wait_for_timeout(100); assert pg.evaluate('window.__db.events.length') == 0
    print('· accounts and purge')
    pg.goto(URL + '#/settings'); expect(pg.locator('.view')).to_contain_text('moi@test.fr')
    pg.get_by_placeholder('Nom affiché').fill('Emma'); pg.locator('input[type=email]').fill('ami@test.fr'); pg.locator('select[aria-label="Rôle"]').last.select_option('observer'); pg.get_by_role('button', name='Autoriser').click(); pg.wait_for_timeout(100)
    row = [m for m in pg.evaluate('window.__db.accounts') if m['email'] == 'ami@test.fr'][0]; assert row['role'] == 'observer' and row['tabs'] == ['dashboard', 'chain', 'players'], row
    pg.evaluate('K.store.purge()'); pg.wait_for_timeout(300)
    calls = pg.evaluate('window.__calls'); order = [c[1] for c in calls if c[0] == 'delete' and c[3] and c[3][0][0] == 'neq']
    assert order[-8:] == ['intel', 'bonuses', 'links', 'kills', 'players', 'homes', 'rounds', 'events'], order   # le premier 'events' vient du vidage du journal testé plus haut
    assert ['removeFiles', 'photos', ['p1.jpg']] in calls
    assert any(c[:2] == ['rpc', 'purge_history'] for c in calls), 'end of game also erases the automatic backups and the deletion journal'
    print('· deletion journal (administrators)')
    pg.evaluate("window.__db.audit = [{id: 1, at: new Date().toISOString(), actor: 'max@test.fr', table_name: 'links', row_data: {hunter_id: 'x', target_id: 'y'}}, {id: 2, at: new Date().toISOString(), actor: 'max@test.fr', table_name: 'players', row_data: {name: 'DUPONT Léa'}}]")
    pg.goto(URL + '#/settings'); pg.get_by_role('button', name='Journal des suppressions').click()
    expect(pg.locator('dialog[open] .audit-row')).to_have_count(2); expect(pg.locator('dialog[open]')).to_contain_text('Fiche · DUPONT Léa'); expect(pg.locator('dialog[open]')).to_contain_text('max@test.fr')
    pg.keyboard.press('Escape')
    print('· sign out')
    pg.evaluate('K.store.auth.signOut()'); expect(pg.locator('.auth-card')).to_be_visible()
    print('· observer: read-only, only allowed tabs')
    pg.evaluate("window.__db.players.push({id:'p9', name:'ALLIÉ Test', points:0, is_ally:true, status:'priority'}); window.__role = 'observer'; window.__db.accounts.push({email:'obs@test.fr', name:'', role:'observer', tabs:['dashboard','chain'], avatar_path:null})")
    pg.locator('input[type=email]').fill('obs@test.fr'); pg.locator('input[type=password]').fill('bonmotdepasse'); pg.get_by_role('button', name='Se connecter').click()
    pg.wait_for_selector('.shell'); assert pg.locator('.nav-item').count() == 2
    # every player looks the same: the loaded sheets carry no alliance and no status; the dashboard has no ring, no blocks
    assert pg.evaluate("window.__db.players.some(p => p.is_ally && p.status)"), 'the database still has them'
    assert pg.evaluate("K.store.state.players.length > 0 && !K.store.state.players.some(p => p.is_ally || p.status)")
    assert pg.locator('.ring').count() == 0 and pg.locator('.carousel').count() == 0 and pg.locator('.hero-side').count() == 1
    before = len(pg.evaluate('window.__calls')); pg.evaluate("K.store.insert('players', {name: 'X'})"); pg.wait_for_timeout(100)
    assert not [c for c in pg.evaluate('window.__calls')[before:] if c[0] == 'insert'], 'observer must not write'
    pg.evaluate('K.store.auth.signOut()'); expect(pg.locator('.auth-card')).to_be_visible()
    print('· removed from the team while signed in: locked out at the next check, no copy left on the device')
    pg.evaluate("window.__role = 'member'")
    pg.locator('input[type=email]').fill('moi@test.fr'); pg.locator('input[type=password]').fill('bonmotdepasse'); pg.get_by_role('button', name='Se connecter').click()
    pg.wait_for_selector('.shell'); pg.wait_for_timeout(2300)   # the offline copy is written after 2 s
    assert pg.evaluate("!!localStorage.getItem('killer.cache.v1')")
    pg.evaluate("window.__role = 'observer'; K.store.recheckRole()"); pg.wait_for_timeout(200)
    assert pg.evaluate("[K.store.role, K.store.canEdit()]") == ['observer', False], 'a changed role applies at once'
    pg.evaluate("window.__role = null; document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(300)
    expect(pg.locator('.auth-card')).to_contain_text("n'est pas sur la liste")
    assert pg.evaluate("[localStorage.getItem('killer.cache.v1'), K.store.state.players.length]") == [None, 0]
    pg.get_by_role('button', name='Se déconnecter').click(); expect(pg.locator('.auth-card')).to_contain_text('Espace privé')
    print('· signing out without a network: the copy is wiped, it does not come back')
    pg.evaluate("window.__role = 'member'")
    pg.locator('input[type=email]').fill('moi@test.fr'); pg.locator('input[type=password]').fill('bonmotdepasse'); pg.get_by_role('button', name='Se connecter').click()
    pg.wait_for_selector('.shell'); pg.wait_for_timeout(2300)
    assert pg.evaluate("!!localStorage.getItem('killer.cache.v1')")
    ctx.set_offline(True); pg.evaluate("window.__down = true")
    pg.evaluate("K.store.auth.signOut()"); pg.wait_for_timeout(400)
    expect(pg.locator('.auth-card')).to_contain_text('Espace privé')
    assert pg.evaluate("localStorage.getItem('killer.cache.v1')") is None
    assert ['signOut', 'local'] in pg.evaluate('window.__calls'), 'local sign-out when the server cannot be reached'
    ctx.set_offline(False); pg.evaluate("window.__down = false")
    errs[:] = [e for e in errs if 'Failed to fetch' not in e]
    print('· signed in but not on the list')
    pg.evaluate('window.__role = null')
    pg.locator('input[type=email]').fill('intrus@test.fr'); pg.locator('input[type=password]').fill('bonmotdepasse'); pg.get_by_role('button', name='Se connecter').click()
    expect(pg.locator('.auth-card')).to_contain_text("n'est pas sur la liste")
    b.close()
errs = [e for e in errs if 'RLS refuse' not in e]   # the simulated server error is logged on purpose
assert not errs, errs
print('OK')
