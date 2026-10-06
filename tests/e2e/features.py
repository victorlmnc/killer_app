"""Timetables, when to catch a target, shop bonuses and danger alerts, pre-shot planner (demo mode),
then the offline copy (fake Supabase client that goes offline)."""
import sys, datetime
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from _common import URL, context, collect_errors
from playwright.sync_api import sync_playwright, expect

# A timetable around now, in UTC: a class in progress, another later today, and a holiday.
now = datetime.datetime.now(datetime.timezone.utc).replace(second=0, microsecond=0)
z = lambda d: d.strftime('%Y%m%dT%H%M%SZ')
ICS = '\r\n'.join(['BEGIN:VCALENDAR', 'X-WR-CALNAME:HYP - <3><TD>TD1',
  'BEGIN:VEVENT', 'UID:1', 'DTSTART:' + z(now - datetime.timedelta(minutes=30)), 'DTEND:' + z(now + datetime.timedelta(minutes=50)),
  'SUMMARY:TD1 - Maths', 'LOCATION:SA2.04', 'DESCRIPTION:TD : TD1\\nMatière : Mathématiques\\nEnseignant : M. X', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'DTSTART:' + z(now + datetime.timedelta(hours=2)), 'DTEND:' + z(now + datetime.timedelta(hours=3)),
  'SUMMARY:Amphi', 'LOCATION:Amphi A', 'DESCRIPTION:Matière : Physique\\nEnseignant : Mme Y', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:3', 'DTSTART:' + z(now + datetime.timedelta(hours=2)), 'DTEND:' + z(now + datetime.timedelta(hours=3)),
  'SUMMARY:TD2 - Chimie', 'LOCATION:SA1.01', 'DESCRIPTION:TD : TD2\\nMatière : Chimie', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:COURSANNULE-4', 'DTSTART:' + z(now + datetime.timedelta(hours=4)), 'DTEND:' + z(now + datetime.timedelta(hours=5)),
  'SUMMARY:Annulation : TD1 - Maths', 'DESCRIPTION:Annulation : \\nTD : TD1', 'END:VEVENT', 'END:VCALENDAR'])

def step(s): print('·', s)

with sync_playwright() as p:
    b = p.chromium.launch(); errors = []
    ctx = context(b, viewport={'width': 1100, 'height': 900})
    ctx.route('https://edt.example/**', lambda r: r.fulfill(body=ICS, content_type='text/calendar', headers={'Access-Control-Allow-Origin': '*'}))
    pg = ctx.new_page(); collect_errors(pg, errors); pg.add_init_script("localStorage.setItem('killer.lang', 'fr')")
    pg.goto(URL); pg.wait_for_selector('.hero')

    step('timetable: a layer added from Settings applies to the right players; classes of other groups and cancelled ones are left out')
    ids = pg.evaluate("""() => { const st = K.store.state, L = K.logic, dead = L.deadSet(st), round = L.currentRound(st);
      const ally = st.players.find(p => { const t = p.is_ally && !dead.has(p.id) && L.resolveTarget(st, round.id, p.id).id; return t && !K.store.player(t).is_ally; });
      const target = K.store.player(L.resolveTarget(st, round.id, ally.id).id);
      K.store.update('players', target.id, { year: '3', td: 'TD1', weapons: 'Banane, Cravate' });
      K.store.update('players', ally.id, { year: '3', td: 'TD2' });
      K.store.updateMember('demo@local', { player_id: ally.id });
      return { ally: ally.id, target: target.id, targetName: target.name }; }""")
    pg.goto(URL + '#/settings'); pg.get_by_label('Lien iCal à ajouter').fill('https://edt.example/3.ics'); pg.get_by_role('button', name='Ajouter', exact=True).click()
    pg.wait_for_function("K.store.state.settings.calendars && K.store.state.settings.calendars.length === 1")
    layer = pg.evaluate("K.store.state.settings.calendars[0]")
    assert (layer['year'], layer['field'], layer['value']) == ('3', 'td', 'TD1'), layer
    pg.evaluate("c => K.store.setSetting('calendars', [Object.assign({}, c, { field: '', value: '' })])", layer)   # for the whole 3rd year
    pg.evaluate("id => K.actions.openPlayer(id)", ids['target'])
    sched = pg.locator('dialog[open] .sched')
    expect(sched).to_contain_text('Mathématiques'); expect(sched).to_contain_text('SA2.04'); expect(sched.locator('.kind-td')).to_have_count(1)
    expect(sched).not_to_contain_text('Chimie')                                      # TD2 class: not theirs
    pg.get_by_role('button', name='Voir la semaine').click()
    week = pg.locator('dialog[open]').last
    expect(week.locator('.kind-legend')).to_be_visible(); expect(week).not_to_contain_text('Annulation')
    expect(week.locator('.week-class.kind-cm')).to_have_count(1)                     # the lecture, in purple
    pg.keyboard.press('Escape')

    step('when to catch them: from the sheet of the target, with my own timetable (my account is linked to my sheet)')
    pg.locator('dialog[open]').get_by_role('button', name="Quand l'attraper").click()
    catch = pg.locator('dialog[open]').last
    expect(catch).to_contain_text('Quand attraper'); expect(catch.locator('.catch-row, .empty').first).to_be_visible()
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')

    step('shop: a purchase takes the points, shows in the shop, on the sheet, and raises an alert for the alliance')
    pg.evaluate("id => K.store.update('players', id, { points: 5 })", ids['target'])
    pg.goto(URL + '#/shop')
    pg.locator('.shop-item', has=pg.locator('h3', has_text='Immunité')).get_by_role('button', name='Enregistrer un achat').click()
    dlg = pg.locator('dialog[open]').last
    dlg.locator('.field .btn-block').click()
    picker = pg.locator('dialog[open]').last; picker.locator('input[type=search]').fill(ids['targetName']); picker.locator('.pick-list .row-btn').first.click()
    expect(dlg.locator('input[type=number]')).to_have_value('24')
    dlg.get_by_role('button', name='Enregistrer', exact=True).click()
    pg.wait_for_function("K.store.state.bonuses.length === 1")
    assert pg.evaluate("id => K.store.player(id).points", ids['target']) == 2
    expect(pg.locator('.bonus-row')).to_contain_text('Immunité')
    pg.evaluate("""b => K.store.update('bonuses', b.id, { starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString() })""",
                pg.evaluate("K.store.state.bonuses[0]"))                                 # in effect now
    pg.goto(URL + '#/dashboard')
    expect(pg.locator('.alerts')).to_contain_text('est immunisée')
    expect(pg.locator('.me')).to_contain_text('Immunité')                           # on "my target"
    pg.locator('.me-sched').get_by_role('button', name='Voir la semaine').click()    # "where is my target": the week too
    expect(pg.locator('dialog[open]').last).to_contain_text('Mathématiques'); pg.keyboard.press('Escape')

    step('pre-shot: the weapons of our targets, with what we already have')
    pg.evaluate("() => { const w = K.store.state.weapons.find(x => K.logic.norm(x.name) === 'banane'); if (w) K.store.update('weapons', w.id, { owned: true, note: 'dans le frigo' }); }")
    pg.goto(URL + '#/weapons')
    plan = pg.locator('section.panel', has=pg.locator('h2', has_text='Préshot'))
    expect(plan).to_contain_text(ids['targetName']); expect(plan).to_contain_text('dans le frigo'); expect(plan).to_contain_text('À trouver')

    step('shared flat: created from the map, its flatmates follow its address; it stays alive while one of them is')
    ctx.route('**/leaflet.min.*', lambda r: r.abort())                                # no map tiles needed: the lists work without
    ctx.route('**/data.geopf.fr/**', lambda r: r.fulfill(json={ 'features': [{ 'geometry': { 'coordinates': [2.401, 47.081] }, 'properties': { 'score': 0.9, 'label': '8 rue des Lilas' } }] }))
    mates = pg.evaluate("K.store.state.players.filter(p => !p.home_id && !K.logic.deadSet(K.store.state).has(p.id)).slice(0, 2).map(p => p.name)")
    pg.goto(URL + '#/map')
    flats = pg.locator('section.panel', has=pg.locator('h2', has_text='Colocs'))
    expect(flats).to_contain_text('Coloc du Port')                                    # the demo flat
    flats.get_by_role('button', name='Nouvelle coloc').click()
    dlg = pg.locator('dialog[open]').last
    dlg.get_by_placeholder('ex. Coloc du Port').fill('Les Lilas'); dlg.locator('input[type=text]').nth(1).fill('8 rue des Lilas, Bourges')
    for name in mates:
        dlg.get_by_role('button', name='Ajouter un colocataire').click()
        picker = pg.locator('dialog[open]').last; picker.locator('input[type=search]').fill(name); picker.locator('.pick-list .row-btn').first.click()
    dlg.get_by_role('button', name='Enregistrer').click()
    pg.wait_for_function("(() => { const h = K.store.state.homes.find(x => x.name === 'Les Lilas'); return h && K.store.state.players.filter(p => p.home_id === h.id).length === 2; })()")
    synced = pg.evaluate("(() => { const h = K.store.state.homes.find(x => x.name === 'Les Lilas'); return K.store.state.players.filter(p => p.home_id === h.id).map(p => [p.address, p.lat, p.address_type]); })()")
    assert all(s == ['8 rue des Lilas, Bourges', 47.081, 'coloc'] for s in synced), synced
    expect(flats.locator('.flat-row', has_text='Les Lilas')).to_contain_text('2/2 vivants')
    pg.evaluate("(() => { const h = K.store.state.homes.find(x => x.name === 'Les Lilas'); const p = K.store.state.players.find(x => x.home_id === h.id); return K.actions.recordKill({ victimId: p.id, killerId: null }); })()")
    expect(flats.locator('.flat-row', has_text='Les Lilas')).to_contain_text('1/2 vivants')
    expect(flats.locator('.flat-row.is-dead', has_text='Les Lilas')).to_have_count(0)  # still alive
    assert errors == [], errors
    ctx.close()

    step('offline: the last copy opens read-only when the database cannot be reached')
    FAKE = r"""
    window.__db = { players: [{ id: 'p1', name: 'VALJEAN Jean', year: '3A', td: 'TD1', points: 2 }], rounds: [], links: [], kills: [], weapons: [], events: [], spots: [], bonuses: [], homes: [],
      settings: [{ key: 'game_name', value: 'Killer test' }], accounts: [{ email: 'moi@test.fr', name: '', role: 'admin', tabs: null, avatar_path: null }] };
    window.supabase = { createClient: function () {
      var offline = localStorage.getItem('fake.offline') === '1', fail = function () { return Promise.reject(new TypeError('Failed to fetch')); };
      function builder(table) { var b = { select: function () { return b; }, order: function () { return b; }, limit: function () { return b; }, eq: function () { return b; },
        then: function (res, rej) { return (offline ? fail() : Promise.resolve({ data: JSON.parse(JSON.stringify(window.__db[table] || [])), error: null })).then(res, rej); } }; return b; }
      return { auth: { onAuthStateChange: function (cb) { setTimeout(function () { cb('INITIAL_SESSION', { user: { id: 'u1', email: 'moi@test.fr' } }); }, 0); } },
        rpc: function () { return offline ? fail() : Promise.resolve({ data: 'admin', error: null }); }, from: builder,
        storage: { from: function () { return { createSignedUrls: function () { return Promise.resolve({ data: [], error: null }); } }; } },
        channel: function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; } }; return ch; } };
    } };"""
    ctx = context(b, viewport={'width': 1100, 'height': 800})
    ctx.route('**/js/config.js', lambda r: r.fulfill(body="window.KILLER_CONFIG = { supabaseUrl: 'https://xyz.supabase.co', supabaseAnonKey: 'anon' };", content_type='text/javascript'))
    ctx.add_init_script(FAKE)
    pg = ctx.new_page(); errors = []; collect_errors(pg, errors); pg.add_init_script("localStorage.setItem('killer.lang', 'fr')")
    pg.goto(URL + '#/players'); expect(pg.locator('.row-player')).to_have_count(1)
    expect(pg.locator('.offline-bar')).to_be_hidden()
    pg.wait_for_function("localStorage.getItem('killer.cache.v1') !== null", timeout=6000)
    pg.evaluate("localStorage.setItem('fake.offline', '1')"); pg.reload()
    expect(pg.locator('.offline-bar')).to_be_visible(); expect(pg.locator('.offline-bar')).to_contain_text('Hors ligne')
    expect(pg.locator('.row-player')).to_contain_text('VALJEAN Jean')
    expect(pg.get_by_role('button', name='Ajouter un joueur')).to_have_count(0)      # read-only
    b.close()
    errors = [e for e in errors if 'Failed to fetch' not in e]
    assert errors == [], errors
print('OK')
