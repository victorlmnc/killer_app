"""Map tab against a stub Leaflet (records markers/polylines) and a stub geocoder."""
import json, sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from _common import URL, context, collect_errors
from playwright.sync_api import sync_playwright, expect
# Stub Leaflet: checks what the app asks for (markers, popups, lines), not Leaflet itself.
STUB = r"""
window.L = (function () {
  var state = { map: null, markers: [], views: [], fits: [], removed: false, tile: null };
  window.__L = state;
  function marker(ll, o) { var m = { ll: ll, o: o, bindPopup: function (fn) { m.pop = fn; return m; },
      openPopup: function () { var host = document.querySelector('#fake-pop') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'fake-pop' }));
        host.innerHTML = ''; host.appendChild(typeof m.pop === 'function' ? m.pop() : m.pop); state.opened = o.title; } }; return m; }
  return {
    map: function (el) { state.groups = 0; var handlers = {}; state.map = { el: el, setView: function (c, z) { state.views.push([c, z]); state.zoom = z; return state.map; }, getZoom: function () { return state.zoom || 13; },
        fitBounds: function (b) { state.fits.push(b); }, closePopup: function () {}, on: function (ev, fn) { handlers[ev] = fn; }, fire: function (ev, e) { handlers[ev](e); }, remove: function () { state.removed = true; } }; return state.map; },
    tileLayer: function (url, o) { state.tile = { url: url, o: o }; return { addTo: function () {} }; },
    layerGroup: function () { var first = !state.groups; state.groups = (state.groups || 0) + 1; var key = first ? 'bus' : 'markers'; state[key] = [];
      return { addTo: function () { return this; }, clearLayers: function () { state[key] = []; }, addLayer: function (m) { state[key].push(m); } }; },
    divIcon: function (o) { return o; }, marker: marker,
    polyline: function (path, o) { return { kind: 'line', path: path, o: o }; },
    circleMarker: function (ll, o) { var m = marker(ll, o); m.kind = 'stop'; return m; }
  };
})();
"""
geocoded = []
def geocoder(route):
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(route.request.url).query); geocoded.append(q)
    text = q['q'][0]
    if 'introuvable' in text.lower(): body = {'type': 'FeatureCollection', 'features': []}
    else: body = {'type': 'FeatureCollection', 'features': [{'geometry': {'type': 'Point', 'coordinates': [2.3991, 47.0812]}, 'properties': {'label': text, 'score': 0.93}}]}
    route.fulfill(body=json.dumps(body), content_type='application/json', headers={'access-control-allow-origin': '*'})

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = context(b, viewport={'width': 390, 'height': 844}, has_touch=True)
    ctx.route('**/data.geopf.fr/**', geocoder)
    ctx.route('**/leaflet.min.css', lambda r: r.fulfill(body='', content_type='text/css'))
    BUS = "window.KILLER_BUS = {source:'AggloBus test', generated:'2026-09-21', lines:[{id:'R1',name:'1',long:'Gare - Campus',color:'#0055A4',paths:[[[47.09,2.39],[47.08,2.41]]],stops:[{n:'Gare',lat:47.09,lng:2.39},{n:'Campus',lat:47.08,lng:2.41}]},{id:'R2',name:'2',long:'',color:'javascript:alert(1)',paths:[[[47.07,2.4],[47.06,2.41]]],stops:[{n:'Lac',lat:47.06,lng:2.41}]}]};"
    ctx.route('**/data/bus.js', lambda r: r.fulfill(body=BUS, content_type='text/javascript'))
    ctx.add_init_script(STUB)
    pg = ctx.new_page(); errs = []; collect_errors(pg, errs); pg.add_init_script("localStorage.setItem('killer.lang', 'fr')")
    pg.goto(URL + '#/map'); pg.wait_for_function('window.__L.markers.length > 0')
    S = lambda: pg.evaluate('({n: __L.markers.length, titles: __L.markers.map(m => m.o.title), fits: __L.fits.length, tile: __L.tile})')
    players = pg.evaluate('K.store.state.players')
    withAddr = [x for x in players if x['address']]; located = [x for x in withAddr if x['lat'] is not None]
    print('· one marker per located address, players without address are skipped')
    s = S(); names = ', '.join(s['titles'])
    assert all(x['name'] in names for x in located) and not any(x['name'] in names for x in players if not x['address'])
    assert s['n'] < len(located), 'les résidences partagées doivent être regroupées'
    assert s['tile']['url'].startswith('https://tile.openstreetmap.org') and 'OpenStreetMap' in s['tile']['o']['attribution'] and s['fits'] == 1
    expect(pg.locator('.view-map > section.panel').first).to_contain_text(f'Joueurs localisés {len(located)}')
    print('· list row centres the map and opens the popup: name, address, sheet')
    row = pg.locator('.map-row .row-btn').first; who = row.locator('.row-title').inner_text(); row.click()
    pop = pg.locator('#fake-pop'); expect(pop).to_contain_text(who); expect(pop).to_contain_text('rue')
    pop.get_by_role('button', name='Voir la fiche').first.dispatch_event('click')  # le faux popup tombe sous la barre de navigation
    expect(pg.locator('dialog[open] h2')).to_be_visible(); expect(pg.locator('dialog[open]')).to_contain_text('Adresse :')
    pg.keyboard.press('Escape')
    print('· shared residence popup lists everybody there')
    multi = pg.evaluate("(() => { const m = __L.markers.find(m => m.o.title.includes(',')); m.openPopup(); return m.o.title.split(', ').length })()")
    assert pg.locator('#fake-pop .map-pop-item').count() == multi and multi > 1
    print('· filters: alive, alliance targets')
    pg.locator('.chip', has_text='Vivant').click(); dead = pg.evaluate('[...K.logic.deadSet(K.store.state)]')
    alive_located = [x for x in located if x['id'] not in dead]
    expect(pg.locator('.view-map > section.panel').first).to_contain_text(f'Joueurs localisés {len(alive_located)}')
    pg.locator('.chip', has_text='Cibles').click(); pg.wait_for_timeout(100)
    assert pg.locator('.view-map > section.panel').first.locator('.map-row').count() <= 4
    pg.locator('.chip', has_text='Tous').click()
    print('· locate pending addresses (stub geocoder), never sending a name')
    todo = [x for x in withAddr if x['lat'] is None]; assert todo
    pg.get_by_role('button', name='Localiser ces adresses').click()
    expect(pg.locator('.toast')).to_contain_text(f'{len(todo)} adresse'); pg.wait_for_timeout(200)
    assert len(geocoded) == len(todo) and all(g['limit'] == ['1'] and 'lat' in g for g in geocoded)
    assert not any(x['name'].split()[0].lower() in g['q'][0].lower() for g in geocoded for x in players)
    assert pg.locator('.view-map > section.panel').nth(2).is_hidden()
    print('· new address on a sheet is geocoded; unknown address can be placed by hand')
    pid = [x for x in players if not x['address']][0]['id']
    pg.evaluate("id => K.actions.editPlayer(id)", pid)
    pg.get_by_placeholder('ex. 12 rue Moyenne').fill('Bâtiment introuvable'); pg.get_by_role('button', name='Enregistrer').click()
    expect(pg.locator('.toast-error')).to_contain_text('Adresse introuvable')
    expect(pg.locator('.view-map > section.panel').nth(2)).to_contain_text('Bâtiment introuvable')
    pg.get_by_role('button', name='Placer sur la carte').click()
    expect(pg.locator('.map-hint')).to_contain_text('Touche la carte')
    pg.evaluate("__L.map.fire('click', { latlng: { lat: 47.09, lng: 2.41 } })"); pg.wait_for_timeout(150)
    me = pg.evaluate("id => K.store.player(id)", pid); assert (me['lat'], me['lng']) == (47.09, 2.41)
    assert pg.locator('.map-hint').is_hidden()
    pg.evaluate("id => K.actions.editPlayer(id)", pid)
    pg.get_by_placeholder('ex. 12 rue Moyenne').fill(''); pg.get_by_role('button', name='Enregistrer').click(); pg.wait_for_timeout(150)
    me = pg.evaluate("id => K.store.player(id)", pid); assert me['lat'] is None and me['name'] not in ', '.join(S()['titles'])
    print('· Show-on-map link from a sheet, cleanup when leaving the tab')
    pg.goto(URL + '#/players'); pg.wait_for_selector('.row-player'); assert pg.evaluate('__L.removed')
    pg.evaluate("__L.opened = undefined"); pg.evaluate("id => K.actions.openPlayer(id)", located[0]['id']); pg.get_by_role('link', name='Voir sur la carte').click()
    pg.wait_for_function("window.__L.opened !== undefined"); assert located[0]['name'] in pg.evaluate('__L.opened')
    print('· layers: housing types, hiding, strategic spots')
    pg.goto(URL + '#/map'); pg.wait_for_function('window.__L.markers.length > 0')
    pg.locator('.layers summary').click()
    kinds = pg.evaluate("__L.markers.map(m => (m.o.icon.html.match(/pin-(normale|coloc|immeuble|residence|spot)/) || [])[1])")
    assert set(kinds) == {'normale', 'coloc', 'immeuble', 'residence', 'spot'}, set(kinds)
    assert pg.evaluate("__L.markers.filter(m => m.o.icon.html.includes('pin-residence')).every(m => /pin-count/.test(m.o.icon.html))")
    n_before = pg.evaluate('__L.markers.length'); n_res = kinds.count('residence')
    pg.locator('.layer-row', has_text='Résidences étudiantes').click(); pg.wait_for_function('n => (window.__L.markers || []).length === n', arg=n_before - n_res, timeout=5000)
    expect(pg.locator('.view-map > section.panel').first).not_to_contain_text('Résidence des Tanneurs')      # la liste suit les calques
    assert json.loads(pg.evaluate('localStorage.getItem("killer.map.v1")'))['hidden'] == ['residence']   # remembered on the device
    pg.locator('.layer-row', has_text='Résidences étudiantes').click()
    print('· add a strategic spot by tapping the map, then its popup')
    pg.get_by_role('button', name='Ajouter un lieu stratégique').click()
    pg.get_by_placeholder('ex. resto U').fill('Arrêt Lahitolle'); pg.get_by_role('button', name='Ajouter le lieu').click()
    expect(pg.locator('.map-hint')).to_contain_text('Arrêt Lahitolle')
    pg.evaluate("__L.map.fire('click', { latlng: { lat: 47.083, lng: 2.417 } })"); pg.wait_for_timeout(150)
    sp = pg.evaluate("K.store.state.spots.find(s => s.name === 'Arrêt Lahitolle')"); assert (sp['lat'], sp['lng']) == (47.083, 2.417)
    pg.evaluate("__L.markers.find(m => m.o.title === 'Arrêt Lahitolle').openPopup()")
    expect(pg.locator('#fake-pop')).to_contain_text('Lieu stratégique')
    print('· bus lines: hidden by default, official colour, stops, invalid colour neutralised')
    assert pg.evaluate('__L.bus.length') == 0
    pg.locator('.layer-row', has_text='Ligne 1').click()
    bus = pg.evaluate("__L.bus.map(x => ({kind: x.kind, color: x.o.color}))")
    assert bus == [{'kind': 'line', 'color': '#0055A4'}, {'kind': 'stop', 'color': '#0055A4'}, {'kind': 'stop', 'color': '#0055A4'}], bus
    pg.evaluate("__L.bus.find(x => x.kind === 'stop').openPopup()"); expect(pg.locator('#fake-pop')).to_contain_text('Ligne 1')
    pg.locator('.layer-row', has_text='Ligne 2').click()
    assert 'javascript' not in json.dumps(pg.evaluate("__L.bus.map(x => x.o.color)"))
    pg.get_by_role('button', name='Tout masquer').click(); assert pg.evaluate('__L.bus.length') == 0
    b.close()
assert not errs, errs
print('OK')
