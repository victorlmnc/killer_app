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

    step('weapon of unknown difficulty: the kill counts a range of points until someone says easy or hard')
    k = pg.evaluate("(() => { const k = K.store.state.kills.find(x => x.weapon === 'Briquet'), p = K.store.player(k.killer_id); return { killer: p.id, name: p.name, points: p.points, kill: k.id }; })()")
    unk = pg.locator('section.panel', has=pg.locator('h2', has_text='Difficulté inconnue'))
    expect(unk.locator('.unknown-weapon', has_text='Briquet')).to_contain_text('1 kill en attente')
    pg.evaluate("id => K.actions.openPlayer(id)", k['killer'])
    expect(pg.locator('dialog[open] .tag-points')).to_have_text(f"{k['points']} à {k['points'] + 2} pts"); pg.keyboard.press('Escape')
    unk.locator('.unknown-weapon', has_text='Briquet').get_by_role('button', name='Difficile').click(); pg.wait_for_timeout(200)
    after = pg.evaluate("a => [K.store.player(a.killer).points, K.store.state.kills.find(x => x.id === a.kill).weapon_level, K.store.state.kills.find(x => x.id === a.kill).points, K.store.state.weapons.find(w => w.name === 'Briquet').difficulty]", k)
    assert after == [k['points'] + 2, 'difficile', 3, 'difficile'], after
    expect(pg.locator('.toast').last).to_contain_text('2 points de plus')
    # a kill recorded with a new weapon and "don't know": the weapon joins the catalogue as unknown, the killer gets a range
    v = pg.evaluate("(() => { const st = K.store.state, dead = K.logic.deadSet(st), r = K.logic.currentRound(st); const p = st.players.find(x => !dead.has(x.id) && K.logic.resolveHunter(st, r.id, x.id).id); return { victim: p.id, killer: K.logic.resolveHunter(st, r.id, p.id).id }; })()")
    before = pg.evaluate("id => K.store.player(id).points", v['killer'])
    pg.evaluate("id => K.actions.killDialog(id)", v['victim'])
    pg.locator('dialog[open] input[list="kill-weapons"]').fill('Parapluie')
    pg.locator('dialog[open] select:has(option[value="inconnue"])').select_option('inconnue')
    expect(pg.locator('dialog[open]')).to_contain_text('1 ou 3')
    pg.get_by_role('button', name='Enregistrer le kill').click(); pg.wait_for_timeout(300)
    got = pg.evaluate("a => [K.store.player(a.killer).points, (K.store.state.weapons.find(w => w.name === 'Parapluie') || {}).difficulty, K.store.state.kills.find(x => x.victim_id === a.victim).weapon_level]", v)
    assert got == [before + 1, 'inconnue', 'inconnue'], got
    expect(unk.locator('.unknown-weapon', has_text='Parapluie')).to_contain_text('1 kill en attente')
    pg.evaluate("id => { K.actions.revive(id); }", v["victim"]); pg.get_by_role('button', name='Annuler le kill').click(); pg.wait_for_timeout(200)
    assert pg.evaluate("id => K.store.player(id).points", v['killer']) == before, 'undo takes back the sure point only'

    step('photo: cropped before saving (drag, zoom), square; "Crop" again from the photo viewer; GIFs untouched')
    import struct, zlib
    def png(w, hgt):   # left half red, right half blue
        raw = b''.join(b'\x00' + b''.join(b'\xff\x00\x00' if x < w // 2 else b'\x00\x00\xff' for x in range(w)) for _ in range(hgt))
        chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, hgt, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    pid = pg.evaluate("K.store.state.players.find(p => !p.photo_path).id")
    pg.evaluate("id => K.actions.openPlayer(id)", pid)
    pg.locator('dialog[open] input[type=file]').first.set_input_files({ 'name': 'wide.png', 'mimeType': 'image/png', 'buffer': png(400, 200) })
    crop = pg.locator('dialog[open]').last; expect(crop).to_contain_text('Recadrer la photo')
    box = crop.locator('.crop-frame').bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.mouse.down()
    pg.mouse.move(box['x'] - box['width'], box['y'] + box['height'] / 2, steps=8); pg.mouse.up()   # all the way to the right half
    crop.get_by_role('button', name='Utiliser cette photo').click()
    pg.wait_for_function("id => (K.store.player(id).photo_path || '').startsWith('data:image/jpeg')", arg=pid)
    info = pg.evaluate("""id => new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(i.width / 2, i.height / 2, 1, 1).data; res([i.width, i.height, d[0], d[2]]); }; i.src = K.store.player(id).photo_path; })""", pid)
    assert info[0] == info[1] and info[3] > 200 and info[2] < 60, info                # square, and the blue half is now in the middle
    pg.locator('dialog[open] .profile-photo').click()                                  # the photo viewer
    pg.locator('dialog[open]').last.get_by_role('button', name='Recadrer').click()
    expect(pg.locator('dialog[open]').last).to_contain_text('Recadrer la photo')
    pg.locator('dialog[open]').last.get_by_role('button', name='Utiliser cette photo').click()
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')
    gif = b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;'
    pid2 = pg.evaluate("K.store.state.players.find(p => !p.photo_path).id")
    pg.evaluate("id => K.actions.openPlayer(id)", pid2)
    pg.locator('dialog[open] input[type=file]').first.set_input_files({ 'name': 'a.gif', 'mimeType': 'image/gif', 'buffer': gif })
    pg.wait_for_function("id => (K.store.player(id).photo_path || '').startsWith('data:image/gif')", arg=pid2)   # no cropper, still a GIF
    pg.keyboard.press('Escape')

    step('share a sheet: you choose what goes in the text')
    sp = pg.evaluate("(() => { const st = K.store.state, dead = K.logic.deadSet(st), r = K.logic.currentRound(st); const p = st.players.find(x => !dead.has(x.id) && x.weapons && K.logic.resolveTarget(st, r.id, x.id).id); return { id: p.id, name: p.name, target: K.store.player(K.logic.resolveTarget(st, r.id, p.id).id).name }; })()")
    pg.evaluate("id => K.actions.openPlayer(id)", sp['id'])
    pg.locator('dialog[open]').get_by_role('button', name='Partager').click()
    share = pg.locator('dialog[open]').last
    expect(share.locator('h2')).to_contain_text('Partager ' + sp['name'])
    txt = lambda: share.locator('textarea').input_value()
    assert txt().startswith(sp['name']) and ('Chasse ' + sp['target']) in txt() and 'Armes : ' in txt(), txt()
    share.locator('label.check', has_text='Killer et cible').locator('input').uncheck()
    assert ('Chasse ' + sp['target']) not in txt(), 'unticked: left out'
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')

    step('mystery player: their killer is "a 2A in TD 2"; the candidates; once known, merged into the real sheet')
    my = pg.evaluate("""() => { const st = K.store.state, dead = K.logic.deadSet(st), r = K.logic.currentRound(st);
      const free = st.players.filter(x => !dead.has(x.id) && !x.is_ally);
      const victim = free.find(x => !K.logic.resolveHunter(st, r.id, x.id).id);
      const real = free.find(x => x.id !== victim.id && x.year && x.td && !K.logic.resolveTarget(st, r.id, x.id).id);
      return { victim: victim.id, real: real.id, realName: real.name, year: real.year, td: real.td.split(',')[0] }; }""")
    pg.evaluate("id => K.actions.openPlayer(id)", my['victim'])
    pg.locator('dialog[open] select[aria-label="Killer"]').select_option('__mystery')
    dlg = pg.locator('dialog[open]').last
    expect(dlg.locator('h2')).to_contain_text('Killer inconnu de')
    dlg.locator('select').first.select_option(my['year']); dlg.get_by_placeholder('TD1').fill(my['td'])
    expect(dlg).to_contain_text('correspond')
    dlg.get_by_role('button', name='Ajouter à la chaîne').click(); pg.wait_for_timeout(300)
    mid = pg.evaluate("v => { const st = K.store.state, r = K.logic.currentRound(st), h = K.logic.resolveHunter(st, r.id, v).id; return K.store.player(h).is_mystery ? h : null; }", my['victim'])
    assert mid, 'the mystery sheet hunts the victim'
    assert pg.evaluate("id => !K.logic.stats(K.store.state).incomplete.some(p => p.id === id) && !K.logic.generalRanking(K.store.state).some(r => r.id === id)", mid)
    pg.keyboard.press('Escape'); pg.evaluate("id => K.actions.openPlayer(id)", mid)
    box = pg.locator('dialog[open] .mystery-box')
    expect(box).to_contain_text('Qui est-ce ?'); expect(box).to_contain_text(my['realName'])
    box.locator('.mystery-cand', has_text=my['realName']).get_by_role('button', name='C\'est lui/elle').click()
    pg.locator('dialog[open]').get_by_role('button', name='Fusionner').click(); pg.wait_for_timeout(300)
    assert pg.evaluate("id => !K.store.player(id)", mid), 'the mystery sheet is gone'
    assert pg.evaluate("v => { const st = K.store.state, r = K.logic.currentRound(st); return K.logic.resolveHunter(st, r.id, v).id; }", my['victim']) == my['real'], 'the link moved to the real sheet'
    expect(pg.locator('dialog[open] h2').last).to_have_text(my['realName'])
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')

    step('intel feed: an info with a place on the map, on the sheet and on the dashboard')
    pid3 = pg.evaluate("(() => { const st = K.store.state, dead = K.logic.deadSet(st); return st.players.find(x => !dead.has(x.id) && !K.logic.intelOf(st, x.id).length).id; })()")
    pg.evaluate("id => K.actions.openPlayer(id)", pid3)
    pg.locator('dialog[open]').get_by_role('button', name='Ajouter une info').click()
    dlg = pg.locator('dialog[open]').last
    dlg.locator('textarea').fill('Vu au self avec un parapluie')
    dlg.locator('select').first.select_option(label='Canteen')
    dlg.get_by_role('button', name='Ajouter l\'info').click(); pg.wait_for_timeout(300)
    x = pg.evaluate("id => K.logic.intelOf(K.store.state, id)[0]", pid3)
    assert x['text'] == 'Vu au self avec un parapluie' and x['place'] == 'Canteen' and x['lat'] == 47.0809, x
    expect(pg.locator('dialog[open] .intel')).to_contain_text('Vu au self avec un parapluie'); expect(pg.locator('dialog[open] .intel')).to_contain_text('Sur la carte')
    pg.keyboard.press('Escape')
    pg.goto(URL + '#/dashboard'); expect(pg.locator('.intel-panel')).to_contain_text('Vu au self avec un parapluie')

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

    step('scoring: a new scoring in Settings recomputes the kills and the points of their killers, labels follow')
    k = pg.evaluate("(() => { const k = K.store.state.kills.find(x => x.weapon === 'Arrosoir'); return { kill: k.id, killer: k.killer_id, points: K.store.player(k.killer_id).points }; })()")
    pg.goto(URL + '#/settings')
    sc = pg.locator('section.scoring')
    sc.get_by_label('Arme difficile').fill('4'); sc.get_by_label('First blood').fill('6')
    sc.get_by_role('button', name='Enregistrer le barème').click()
    expect(pg.locator('dialog[open]')).to_contain_text('changent de points')
    pg.locator('dialog[open]').get_by_role('button', name='Appliquer').click(); pg.wait_for_timeout(300)
    got = pg.evaluate("a => [K.store.state.kills.find(x => x.id === a.kill).points, K.store.player(a.killer).points, K.logic.scoring(K.store.state).hard]", k)
    assert got == [4, k['points'] + 2, 4], (got, k)   # Arrosoir 3 -> 4; the same killer's first blood (Banane) 5 -> 6
    pg.goto(URL + '#/shop'); expect(pg.locator('section.panel', has=pg.locator('h2', has_text='Barème des kills'))).to_contain_text('4 pts')
    v = pg.evaluate("(() => { const st = K.store.state, dead = K.logic.deadSet(st); return st.players.find(x => !dead.has(x.id)).id; })()")
    pg.evaluate("id => K.actions.killDialog(id)", v)
    expect(pg.locator('dialog[open] select:has(option[value="inconnue"])')).to_contain_text('Difficile (4 pts)')
    expect(pg.locator('dialog[open]')).to_contain_text('First blood (+6)')
    pg.keyboard.press('Escape')

    step('reroll: every sheet loses its weapons, kept in the history of the loop that ends')
    before = pg.evaluate("(() => { const st = K.store.state, cur = K.logic.currentRound(st), p = st.players.find(x => x.weapons && x.weapons.trim()); return { id: p.id, weapons: p.weapons, round: cur.name, holders: K.store.state.players.filter(x => x.weapons && x.weapons.trim()).length }; })()")
    pg.evaluate("() => { K.actions.newRound(); }")
    dlg = pg.locator('dialog[open]').last
    expect(dlg).to_contain_text('Retirer les armes des %d joueurs' % before['holders'])
    dlg.get_by_role('button', name='Créer le reroll').click(); pg.wait_for_timeout(300)
    assert pg.evaluate("K.store.state.players.every(p => !(p.weapons || '').trim())"), 'every sheet is empty'
    assert pg.evaluate("a => K.store.state.rounds.find(r => r.name === a.round).held_weapons[a.id]", before) == before['weapons']
    pg.evaluate("id => K.actions.openPlayer(id)", before['id'])
    past = pg.locator('dialog[open] .past-weapons')
    expect(past).to_contain_text('Armes des boucles précédentes'); expect(past).to_contain_text(before['round'])
    pg.keyboard.press('Escape')

    step('kill with an unknown killer: the weapon and the points are recorded; the killer gets them once named')
    u = pg.evaluate("""() => { const st = K.store.state, dead = K.logic.deadSet(st), alive = st.players.filter(x => !dead.has(x.id) && !x.is_mystery);
      const v = alive[0]; v.weapons = 'Gant'; const k = alive[1]; K.store.emit(); return { victim: v.id, victimName: v.name, killer: k.id, killerName: k.name, points: k.points || 0 }; }""")
    pg.evaluate("id => K.actions.killDialog(id)", u['victim'])
    dlg = pg.locator('dialog[open]').last
    expect(dlg).to_contain_text("Killer inconnu pour l'instant")
    dlg.locator('input[list="kill-weapons"]').fill('Parapluie')
    dlg.locator('select:has(option[value="inconnue"])').select_option('difficile')
    expect(dlg).to_contain_text('Le killer recevra ces points')
    dlg.get_by_role('button', name='Enregistrer le kill').click(); pg.wait_for_timeout(300)
    kill = pg.evaluate("v => K.store.state.kills.find(k => k.victim_id === v)", u['victim'])
    assert kill['killer_id'] is None and kill['weapon'] == 'Parapluie' and kill['weapon_level'] == 'difficile' and kill['points'] == 4, kill   # hard = 4 since the new scoring
    pg.evaluate("id => K.actions.openPlayer(id)", u['victim'])
    pg.locator('dialog[open]').get_by_role('button', name='Indiquer le killer').click()
    pg.locator('dialog[open]').last.get_by_role('button', name=u['killerName']).first.click(); pg.wait_for_timeout(300)
    got = pg.evaluate("a => [K.store.state.kills.find(k => k.victim_id === a.victim).killer_id, K.store.player(a.killer).points, K.store.player(a.killer).weapons]", u)
    assert got == [u['killer'], u['points'] + 4, 'Gant'], got   # the points, and the victim's weapons in the current loop
    pg.keyboard.press('Escape')
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
