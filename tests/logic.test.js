// node tests/logic.test.js
const assert = require('node:assert');
const L = require('../js/logic.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const P = ids => ids.map(id => ({ id, name: id.toUpperCase(), year: '3A', td: 'TD1' }));
const link = (r, a, b, c = 'sur') => ({ id: `${r}:${a}>${b}`, round_id: r, hunter_id: a, target_id: b, confidence: c });
const apply = (s, plan) => { s.links = s.links.filter(l => !plan.remove.includes(l)); plan.add.forEach((l, i) => s.links.push({ id: 'n' + Math.random(), ...l })); };
const base = () => ({ players: P(['a', 'b', 'c', 'd', 'e', 'f']), rounds: [{ id: 'r0', position: 0 }], links: [], kills: [] });

t('current target skips the dead', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'c', 'd', 'rumeur')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }, { round_id: 'r0', killer_id: 'a', victim_id: 'c' }];
  const r = L.resolveTarget(s, 'r0', 'a');
  assert.equal(r.id, 'd'); assert.deepEqual(r.via, ['b', 'c']); assert.equal(r.confidence, 'rumeur');
  assert.equal(L.resolveHunter(s, 'r0', 'd').id, 'a');
});
t('trail lost after a death', () => {
  const s = base(); s.links = [link('r0', 'a', 'b')]; s.kills = [{ round_id: 'r0', victim_id: 'b' }];
  const r = L.resolveTarget(s, 'r0', 'a'); assert.equal(r.id, null); assert.deepEqual(r.via, ['b']);
  const f = L.fragments(s, 'r0', 'current');
  assert.equal(f.fragments.length, 1); assert.deepEqual(f.fragments[0].tail.via, ['b']);
});
t('fragments: open chain, closed loop, unplaced', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'd', 'e'), link('r0', 'e', 'd')];
  const f = L.fragments(s, 'r0', 'current');
  assert.deepEqual(f.fragments.map(x => x.ids.join('')), ['abc', 'de']);
  assert.equal(f.fragments[1].closed, true); assert.deepEqual(f.unplaced, ['f']);
});
t('last survivor: no infinite loop', () => {
  const s = base(); s.players = P(['a', 'b']); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'a')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }];
  const r = L.resolveTarget(s, 'r0', 'a'); assert.equal(r.id, null); assert.equal(r.closed, true);
});
t('setting a target attaches the link behind the last known dead player', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c')];
  s.kills = [{ round_id: 'r0', victim_id: 'b' }, { round_id: 'r0', victim_id: 'c' }];
  const plan = L.planSetTarget(s, 'r0', 'a', 'e'); assert.equal(plan.anchorId, 'c'); assert.equal(plan.viaDead, true);
  apply(s, plan);
  assert.equal(L.resolveTarget(s, 'r0', 'a').id, 'e');
  assert.equal(s.links.length, 3, 'the complete chain is preserved');
});
t('setting a target replaces contradicting links', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'c', 'd')];
  const plan = L.planSetTarget(s, 'r0', 'a', 'd'); assert.equal(plan.remove.length, 2); apply(s, plan);
  assert.equal(L.resolveTarget(s, 'r0', 'a').id, 'd'); assert.equal(L.resolveTarget(s, 'r0', 'c').id, null);
  assert.equal(L.planSetTarget(s, 'r0', 'a', 'd').noop, true);
  assert.ok(L.planSetTarget(s, 'r0', 'a', 'a').error);
});
t('inserting a dead player between a player and their target', () => {
  const s = base(); s.links = [link('r0', 'a', 'c')]; s.kills = [{ round_id: 'r0', victim_id: 'b' }];
  apply(s, L.planSetTarget(s, 'r0', 'a', 'b'));
  assert.equal(L.resolveTarget(s, 'r0', 'a').id, 'c'); assert.deepEqual(L.resolveTarget(s, 'r0', 'a').via, ['b']);
  assert.deepEqual(L.fragments(s, 'r0', 'complete').fragments[0].ids, ['a', 'b', 'c']);
});
t('reroll: earlier rounds stay readable', () => {
  const s = base(); s.rounds.push({ id: 'r1', position: 1 });
  s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r1', 'c', 'a')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }, { round_id: 'r1', killer_id: 'c', victim_id: 'a' }];
  assert.equal(L.currentRound(s).id, 'r1');
  assert.deepEqual([...L.deadSet(s, 'r0')], ['b']);          // in the archive, a is still alive
  assert.deepEqual(L.fragments(s, 'r0', 'current').fragments[0].ids, ['a', 'c']);
  const now = L.fragments(s, 'r1', 'complete');
  assert.ok(!now.fragments.some(f => f.ids.includes('b')), 'b died before the reroll');
  assert.deepEqual(now.fragments[0].ids, ['c', 'a']);
});
t('stats, leaderboard with ties, points', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'c', 'd')];
  s.kills = [{ round_id: 'r0', killer_id: 'e', victim_id: 'f' }, { round_id: 'r0', victim_id: 'b' }];
  const st = L.stats(s); assert.equal(st.alive, 4); assert.equal(st.dead, 2); assert.equal(st.unattributed, 1);
  assert.equal(st.knownTargets, 1); assert.equal(st.coverage, 0.25);
  s.kills.push({ round_id: 'r0', killer_id: 'a', victim_id: 'c' }, { round_id: 'r0', killer_id: 'a', victim_id: 'd' });
  assert.deepEqual(L.leaderboard(s).map(r => r.rank), [1, 2]);
  assert.equal(L.killPoints({ difficulty: 'difficile', bonus: 2, firstBlood: true, mates: 1 }), 11);
});
t('incomplete sheets include missing addresses for living players', () => {
  const s = base();
  s.players.forEach(p => Object.assign(p, { year: '3A', td: 'TD1', photo_path: 'photo.jpg', address: '12 rue Test' }));
  s.players[0].address = '';
  s.players[1].is_ally = true;
  s.players[1].photo_path = '';
  assert.deepEqual(L.stats(s).incomplete.map(p => p.id), ['a']);
});
t('language groups split on commas and ignore empty or repeated values', () => {
  assert.deepEqual(L.languageGroups('G6, Japonais'), ['G6', 'Japonais']);
  assert.deepEqual(L.languageGroups(' G6 ,, Japonais, G6 '), ['G6', 'Japonais']);
  assert.deepEqual(L.languageGroups(' , '), []);
  assert.deepEqual(L.languageGroupBuckets('G6, Japonais, G12, Italien'), { english: ['G6', 'G12'], other: ['Japonais', 'Italien'] });
  assert.deepEqual(L.languageGroupBuckets('Groupe Japonais'), { english: [], other: ['Groupe Japonais'] });
});
t('import: pasted spreadsheet with a header row, column mapping, row filter', () => {
  const txt = 'Plays?\tName\tYear\tDept\tTD\tPoints\nyes\tDOE Jane\t3\tA\tTD1\t45812\nno\tROE Paul\t4\tB\tTD2\t\n\tPOE Zoe\t2\tA\tTD3\t';
  const table = L.parseTable(txt), map = L.guessMapping(table);
  assert.deepEqual(map, ['', 'name', 'year', 'dept', 'td', 'points']);
  const r = L.mapRows(table, map, { column: 0, value: 'YES' }); assert.equal(r.rows.length, 1); assert.equal(r.skipped, 2);
  assert.deepEqual(r.rows[0], { name: 'DOE Jane', year: '3', dept: 'A', td: 'TD1', points: 0 });
  assert.equal(L.parseImport('Nom;Année\n"LE GALL; Yann";5').rows[0].name, 'LE GALL; Yann');            // French headers, quoted cells
  assert.equal(L.parseImport('VALJEAN Jean\nJAVERT Paul').rows.length, 2);                               // no header: first column is the name
  assert.equal(L.parseImport('Nom\tAdresse\nDUPONT Léa\t12 rue Moyenne').rows[0].address, '12 rue Moyenne');
  const csv = L.toCsv(['a', 'b'], [['x;y', 'q"uote']]); assert.equal(csv, 'a;b\r\n"x;y";"q""uote"');
});
t('map: no address or no coordinates means no marker, same point = one marker', () => {
  const ps = [{ id: 'a', name: 'B', address: 'Résidence X', lat: 47.1, lng: 2.4 }, { id: 'b', name: 'A', address: 'Résidence X', lat: 47.1, lng: 2.4 },
    { id: 'c', name: 'C', address: '', lat: 47.2, lng: 2.5 }, { id: 'd', name: 'D', address: '3 rue Y', lat: null, lng: null }, { id: 'e', name: 'E', address: '5 rue Z', lat: 47.3, lng: 2.6 }];
  const pl = L.places(ps); assert.equal(pl.length, 2);
  assert.deepEqual(pl[0].players.map(p => p.name), ['A', 'B']); assert.equal(pl[1].players[0].id, 'e');
  assert.equal(L.parseImport('Nom\tAdresse\nDUPONT Léa\t12 rue Moyenne, Bourges').rows[0].address, '12 rue Moyenne, Bourges');
});
t('map: housing types, a shared marker takes the most collective type, type import', () => {
  const ps = [{ id: 'a', name: 'A', address: 'x', address_type: 'coloc', lat: 1, lng: 1 }, { id: 'b', name: 'B', address: 'x', address_type: 'immeuble', lat: 1, lng: 1 },
    { id: 'c', name: 'C', address: 'y', lat: 2, lng: 2 }];
  const pl = L.places(ps); assert.equal(pl[0].type, 'immeuble'); assert.equal(pl[1].type, 'normale');
  assert.equal(L.addressType('Student residences'), 'residence'); assert.equal(L.addressType('COLOC'), 'coloc'); assert.equal(L.addressType('n importe quoi'), 'normale');
  const r = L.parseImport('Nom\tAdresse\tType\nA\t3 rue X\tColoc\nB\tRésidence du Lac\t\nC\t\tImmeuble').rows;
  assert.deepEqual(r.map(x => x.address_type), ['coloc', 'residence', undefined]);
});
const chain = (s, mode = 'current') => L.fragments(s, 'r0', mode).fragments.map(f => f.ids.join('') + (f.closed ? '*' : '')).sort().join(' ');
const move = (s, seg, dest, mode = 'current') => { const plan = L.planMove(s, 'r0', mode, seg, dest); if (!plan.noop) apply(s, plan); return plan; };
t('drag: reordering inside a fragment behaves like a list', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'c', 'd')];
  move(s, ['c'], { after: 'a', before: 'b' }); assert.equal(chain(s), 'acbd');
  move(s, ['d'], { before: 'a' }); assert.equal(chain(s), 'dacb');
  assert.ok(move(s, ['a'], { after: 'd', before: 'c' }).noop, 'dropping at the same place is a no-op');
  assert.ok(move(s, ['a', 'c'], { after: 'a' }).noop);
});
t('drag: part of a fragment into another, a whole fragment, the tray', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'd', 'e')];
  move(s, ['b', 'c'], { after: 'd', before: 'e' }); assert.equal(chain(s), 'dbce');     // a is left alone
  assert.deepEqual(L.fragments(s, 'r0', 'current').unplaced.sort(), ['a', 'f']);
  move(s, ['d', 'b', 'c', 'e'], { after: 'a' }); assert.equal(chain(s), 'adbce');       // whole fragment attached behind a
  move(s, ['f'], { after: 'e' }); assert.equal(chain(s), 'adbcef');                     // from the tray
  move(s, ['b'], { tray: true }); assert.equal(chain(s), 'adcef');                       // to the tray: the gap closes
  assert.ok(L.fragments(s, 'r0', 'current').unplaced.includes('b'));
  assert.ok(move(s, ['b'], { tray: true }).noop);
  const rumeur = base(); rumeur.links = [link('r0', 'a', 'b', 'rumeur'), link('r0', 'b', 'c')];
  move(rumeur, ['b'], { tray: true }); assert.equal(rumeur.links[0].confidence, 'rumeur', 'the bridge keeps the weakest confidence');
  const two = base(); move(two, ['a'], { before: 'b' }); assert.equal(chain(two), 'ab'); // two players from the tray
  assert.equal(two.links[0].confidence, 'sur');
});
t('drag: intermediate dead players follow the contract rule', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'd', 'e')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }];
  assert.equal(chain(s), 'ac de');
  move(s, ['f'], { after: 'a', before: 'c' });                                          // a → b† → f → c
  assert.equal(chain(s), 'afc de'); assert.deepEqual(L.resolveTarget(s, 'r0', 'a').via, ['b']);
  assert.equal(chain(s, 'complete'), 'abfc de', 'the complete chain keeps the dead player in place');
  move(s, ['c'], { after: 'e' }); assert.equal(chain(s), 'af dec');
});
t('drag: closed loop, and complete-chain mode', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'c', 'a')];
  assert.equal(chain(s), 'abc*');
  move(s, ['b'], { tray: true }); assert.equal(chain(s), 'ac*');
  move(s, ['a', 'c'], { after: 'd' }); assert.equal(chain(s), 'dac');                   // the loop opens when moved
  const c = base(); c.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c')]; c.kills = [{ round_id: 'r0', victim_id: 'b' }];
  move(c, ['b'], { after: 'c' }, 'complete'); assert.equal(chain(c, 'complete'), 'acb');
});
t('arrow: raw links behind a derived edge are reachable', () => {
  const s = base(); s.links = [link('r0', 'a', 'b', 'probable'), link('r0', 'b', 'c')]; s.kills = [{ round_id: 'r0', victim_id: 'b' }];
  const e = L.fragments(s, 'r0', 'current').fragments[0].edges[0];
  assert.deepEqual(e.links.map(l => l.id), ['r0:a>b', 'r0:b>c']); assert.equal(e.confidence, 'probable');
  assert.equal(L.fragments(s, 'r0', 'complete').fragments[0].edges[0].links.length, 1);
});
console.log(`\n${n} tests OK`);
