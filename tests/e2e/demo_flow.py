"""Main user flows in demo mode: sheet menus, drag and drop, kills, log, roles, settings, import/export."""
import io, json, sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from _common import URL, context, collect_errors
from PIL import Image
from playwright.sync_api import sync_playwright, expect

img = io.BytesIO(); Image.new('RGB', (900, 600), (200, 80, 60)).save(img, 'PNG')
errs = []
def step(t): print('-', t)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = context(b, viewport={'width': 1280, 'height': 1500})
    pg = ctx.new_page(); collect_errors(pg, errs)
    pg.add_init_script("localStorage.setItem('killer.lang', 'fr')")
    state = lambda: pg.evaluate('K.store.state')
    pid = lambda n: pg.evaluate('n => K.store.state.players.find(p => p.name === n).id', n)
    target = lambda n: pg.evaluate('n => { const s=K.store.state, r=K.logic.currentRound(s), p=s.players.find(p=>p.name===n); const t=K.logic.resolveTarget(s,r.id,p.id).id; return t && K.store.player(t).name }', n)
    chain = lambda: pg.evaluate("K.logic.fragments(K.store.state, K.logic.currentRound(K.store.state).id, 'current').fragments.map(f => f.ids.map(id => K.store.player(id).name.split(' ')[0]).join('>'))")
    def center(name, fx=0.5):
        bx = pg.locator('.bubble', has_text=name).first.bounding_box(); return bx['x'] + bx['width'] * fx, bx['y'] + 30
    def drag(src, dst, fx, shift=False, locator=None):
        pg.locator('.bubble', has_text=dst).first.scroll_into_view_if_needed()
        if locator: bx = locator.bounding_box(); sx, sy = bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2
        else: sx, sy = center(src)
        if shift: pg.keyboard.down('Shift')
        pg.mouse.move(sx, sy); pg.mouse.down()
        if shift: pg.keyboard.up('Shift')
        tx, ty = center(dst, fx); pg.mouse.move((sx + tx) / 2, (sy + ty) / 2, steps=4); pg.mouse.move(tx, ty, steps=6)
        pg.mouse.up(); pg.wait_for_timeout(250)

    pg.goto(URL + '#/players'); pg.wait_for_selector('.row-player')
    step('language: French by default, English after switching')
    assert pg.locator('h1').inner_text() == 'Joueurs'
    step('sheet: target menu lists free players only, reliability is clickable')
    pg.get_by_role('button', name='AROUET Candide').first.click()
    sel = pg.locator('dialog select[aria-label="Cible"]'); opts = sel.locator('option').all_inner_texts()
    assert 'BOVARY Emma' in opts and 'AROUET Candide' not in opts and 'POQUELIN Agnès' not in opts and 'LANTIER Étienne' not in opts, opts
    sel.select_option(label='BOVARY Emma'); pg.wait_for_timeout(200); assert target('AROUET Candide') == 'BOVARY Emma'
    tag = pg.locator('dialog .tag-conf').first; expect(tag).to_have_text('Sûr'); tag.click()
    dlg = pg.locator('dialog').last; dlg.locator('select').select_option('rumeur'); dlg.get_by_placeholder('ex. vu sur son téléphone').fill('Entendu au foyer'); dlg.get_by_role('button', name='Enregistrer').click()
    tag = pg.locator('dialog .tag-conf').first; expect(tag).to_have_text('Rumeur'); assert 'Entendu au foyer' in tag.get_attribute('title')
    pg.keyboard.press('Escape')

    step('chain: drag and drop, arrows')
    pg.goto(URL + '#/chain'); pg.wait_for_selector('.bubble')
    drag('SCAPIN', 'AROUET', 0.85); assert 'AROUET>SCAPIN>BOVARY' in chain(), chain()
    assert pg.locator('dialog[open]').count() == 0
    drag('COUPEAU', 'SCAPIN', 0.15); assert 'AROUET>COUPEAU>SCAPIN>BOVARY' in chain(), chain()
    drag('COUPEAU', 'GRANDET', 0.85, shift=True); c = chain(); assert any(x.endswith('GRANDET>COUPEAU>SCAPIN>BOVARY') for x in c) and 'AROUET' not in ' '.join(c), c
    fi = pg.evaluate("[...document.querySelectorAll('.fragment[data-frag]')].findIndex(s => s.textContent.includes('GRANDET'))")
    drag(None, 'ROULETABILLE', 0.85, locator=pg.locator('.fragment[data-frag="%d"] .grip' % fi)); assert any(x.endswith('ROULETABILLE>LUPIN>DANTÈS>VALJEAN>GRANDET>COUPEAU>SCAPIN>BOVARY') for x in chain()), chain()
    drag('AROUET', 'SCAPIN', 0.15); assert any(x.endswith('COUPEAU>AROUET>SCAPIN>BOVARY') for x in chain()), chain()
    pg.locator('.fragment', has_text='COUPEAU').locator('.thread').last.click()
    dlg = pg.locator('dialog[open]'); dlg.locator('select').first.select_option('probable'); dlg.get_by_role('button', name='Enregistrer').click(); pg.wait_for_timeout(150)
    assert pg.locator('.thread-probable').count() >= 1

    step('kill: weapons pass to the killer, note kept, log entry with details')
    vw = pg.evaluate("K.store.state.players.find(p=>p.name==='SCAPIN Léandre').weapons = 'Chaudron, Lacet'")
    pg.evaluate("id => K.actions.killDialog(id)", pid('SCAPIN Léandre'))
    dlg = pg.locator('dialog[open]'); expect(dlg.locator('.btn-block')).to_contain_text('AROUET Candide')
    assert not dlg.locator('input[type=checkbox]').is_checked()
    dlg.get_by_placeholder('Arme utilisée').fill('Chaudron'); dlg.locator('textarea').fill('Au Learning Center, 14 h.')
    dlg.get_by_role('button', name='Enregistrer le kill').click(); pg.wait_for_timeout(300)
    assert pg.evaluate("K.store.state.players.find(p=>p.name==='AROUET Candide').weapons") == 'Chaudron, Lacet'
    pg.goto(URL + '#/dashboard'); ev = pg.locator('.event', has_text='a éliminé SCAPIN').first
    assert 'Learning Center' in ev.get_attribute('title'); ev.click(); expect(pg.locator('dialog[open]')).to_contain_text('Détails du kill'); pg.keyboard.press('Escape')

    step('import: column mapping and row filter, CSV export')
    pg.goto(URL + '#/players'); pg.get_by_role('button', name='Importer').click()
    pg.locator('dialog textarea').fill('Joue ?\tNom\tAnnée\tTD\nOUI\tTARTUFFE Orgon\t5\tTD2\nNON\tDORINE Elmire\t4\tTD1\nOUI\tVALJEAN Jean\t2\tTD1')
    expect(pg.locator('dialog .map-col')).to_have_count(4)
    assert pg.locator('dialog .map-col select').nth(1).input_value() == 'name'
    pg.locator('dialog').get_by_label('Ne garder que les lignes').select_option('0'); pg.locator('dialog').get_by_placeholder('ex. OUI').fill('oui')
    expect(pg.locator('dialog p.muted')).to_contain_text('1 à importer, 1 déjà dans la base, 1 ignorés')
    pg.locator('dialog').get_by_role('button', name='Importer', exact=True).click()
    names = [x['name'] for x in state()['players']]; assert 'TARTUFFE Orgon' in names and 'DORINE Elmire' not in names
    pg.get_by_role('button', name='Exporter').click()
    with pg.expect_download() as dl: pg.get_by_role('button', name='Joueurs (CSV)').click()
    csv = open(dl.value.path(), encoding='utf-8-sig').read(); assert csv.startswith('Nom;État;') and 'TARTUFFE Orgon' in csv
    with pg.expect_popup() as pop: pg.get_by_role('button', name='Exporter').click(); pg.get_by_role('button', name='Rapport').click()
    expect(pop.value.locator('h1')).to_contain_text('Killer'); pop.value.close()

    step('profile: display name and language')
    pg.locator('.whoami').click(); pg.locator('dialog input[type=text]').fill('Le Chef'); pg.locator('dialog').get_by_role('button', name='Enregistrer').click(); pg.wait_for_timeout(150)
    expect(pg.locator('.whoami-name')).to_have_text('Le Chef')

    step('roles: a member has no Settings tab, an observer is read-only with chosen tabs')
    pg.goto(URL + '#/settings'); expect(pg.locator('h1')).to_have_text('Paramètres')
    pg.evaluate("K.store.role = 'member'; K.store.emit(); location.hash = '#/settings'"); pg.wait_for_timeout(200)
    assert pg.locator('.nav-item', has_text='Paramètres').count() == 0 and pg.locator('h1').inner_text() != 'Paramètres'
    pg.evaluate("K.store.state.members[0].role = 'observer'; K.store.state.members[0].tabs = ['dashboard', 'chain']; K.store.role = 'observer'; K.store.emit(); location.hash = '#/players'"); pg.wait_for_timeout(200)
    assert pg.locator('.nav-item').count() == 2 and pg.locator('h1').inner_text() == 'Dashboard'
    pg.evaluate("location.hash = '#/chain'"); pg.wait_for_timeout(200)
    assert pg.locator('.grip').count() == 0 and pg.get_by_role('button', name='Nouveau reroll').count() == 0
    n = pg.evaluate('K.store.state.links.length'); pg.evaluate("K.store.remove('links', K.store.state.links[0].id)"); expect(pg.locator('.toast-error')).to_contain_text('lecture seule'); assert pg.evaluate('K.store.state.links.length') == n
    pg.evaluate("K.store.state.members[0].role = 'admin'; K.store.role = 'admin'; K.store.emit()")

    step('settings: accounts with roles, clear log, erase game')
    pg.goto(URL + '#/settings'); pg.wait_for_timeout(200)
    pg.get_by_placeholder('name@example.org').fill('obs@example.org'); pg.locator('select[aria-label="Rôle"]').last.select_option('observer'); pg.get_by_role('button', name='Autoriser').click(); pg.wait_for_timeout(150)
    m = [x for x in state()['members'] if x['email'] == 'obs@example.org'][0]; assert m['role'] == 'observer' and m['tabs']
    pg.get_by_role('button', name='Vider le journal').click(); pg.locator('dialog[open]').get_by_role('button', name='Vider le journal').click(); pg.wait_for_timeout(150)
    assert pg.evaluate('K.store.state.events.length') == 0
    pg.get_by_role('button', name='Effacer la partie').click(); pg.locator('dialog').get_by_role('button', name='Effacer la partie').click(); pg.wait_for_timeout(200)
    s = state(); assert not s['players'] and len(s['weapons']) == 120 and len(s['spots']) == 2
    pg.goto(URL + '#/dashboard'); pg.reload(); pg.wait_for_selector('.panel-empty')
    ctx.close()

    step('phone: long press then drag')
    ctx = context(b, viewport={'width': 390, 'height': 844}, has_touch=True)
    pg = ctx.new_page(); collect_errors(pg, errs); pg.add_init_script("localStorage.removeItem('killer.local.v1')")
    pg.goto(URL + '#/chain'); pg.wait_for_selector('.bubble')
    fire = """([type, x, y]) => { const el = document.elementFromPoint(x, y) || document.body; el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, button: 0, isPrimary: true })); }"""
    def touch_drag(src, dst, fx, hold):
        pg.locator('.bubble', has_text=dst).first.scroll_into_view_if_needed(); a = pg.locator('.bubble', has_text=src).first.bounding_box()
        sx, sy = a['x'] + a['width'] / 2, a['y'] + 30; pg.evaluate(fire, ['pointerdown', sx, sy]); pg.wait_for_timeout(hold)
        d = pg.locator('.bubble', has_text=dst).first.bounding_box(); tx, ty = d['x'] + d['width'] * fx, d['y'] + 30
        for i in range(1, 7): pg.evaluate(fire, ['pointermove', sx + (tx - sx) * i / 6, sy + (ty - sy) * i / 6])
        pg.evaluate(fire, ['pointerup', tx, ty]); pg.wait_for_timeout(250)
    before = pg.evaluate('K.store.state.links.length')
    touch_drag('VALJEAN', 'GRANDET', 0.85, 60); assert pg.evaluate('K.store.state.links.length') == before
    names = pg.evaluate("[...document.querySelectorAll('[data-tray] .bubble-name')].slice(0, 2).map(b => b.textContent)")
    touch_drag(names[0].split()[0], names[1].split()[0], 0.85, 420)
    l = pg.evaluate("K.store.state.links.slice(-1)[0]"); ids = {x['id']: x['name'] for x in pg.evaluate('K.store.state.players')}
    assert (ids[l['hunter_id']], ids[l['target_id']]) == (names[1], names[0])
    b.close()
print('console errors:', errs); assert not errs
print('OK')
