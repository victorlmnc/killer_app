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
  s.players[4].year = '4A'; s.players[5].year = '';
  s.kills = [{ round_id: 'r0', killer_id: 'e', victim_id: 'f' }, { round_id: 'r0', victim_id: 'b' }];
  const st = L.stats(s); assert.equal(st.alive, 4); assert.equal(st.dead, 2); assert.equal(st.unattributed, 1);
  assert.equal(st.knownTargets, 1); assert.equal(st.coverage, 0.25); assert.deepEqual(st.killsByYear, { '3A': 0, '4A': 1, '?': 0 });
  s.kills.push({ round_id: 'r0', killer_id: 'a', victim_id: 'c' }, { round_id: 'r0', killer_id: 'a', victim_id: 'd' });
  assert.deepEqual(L.leaderboard(s).map(r => r.rank), [1, 2]);
  assert.equal(L.killPoints({ difficulty: 'difficile', bonus: 2, firstBlood: true, mates: 1 }), 11);
});
t('admin eliminations appear in the leaderboard without becoming players', () => {
  const s = base();
  s.kills = [{ round_id: 'r0', victim_id: 'a', admin_reason: 'cheating' }, { round_id: 'r0', victim_id: 'b', admin_reason: 'other' }, { round_id: 'r0', victim_id: 'c', killer_id: 'd' }];
  const board = L.leaderboard(s);
  assert.deepEqual(board.map(row => [row.admin ? 'Admin' : row.id, row.kills, row.rank]), [['Admin', 2, 1], ['d', 1, 2]]);
  assert.equal(L.stats(s).unattributed, 0);
  assert.equal(s.players.some(p => p.name === 'Admin'), false);
  s.players = Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i }));
  s.kills = s.players.flatMap(p => [{ killer_id: p.id, victim_id: p.id + '-a' }, { killer_id: p.id, victim_id: p.id + '-b' }]);
  s.kills.push({ victim_id: 'admin-victim', admin_reason: 'other' });
  const extendedBoard = L.leaderboard(s);
  assert.equal(extendedBoard[13].admin, true); assert.equal(extendedBoard[13].rank, 14);
});
t('general ranking keeps living players unplaced and orders eliminations latest to earliest', () => {
  const s = base();
  s.kills = [
    { victim_id: 'b', happened_at: '2026-01-01T10:00:00Z' },
    { victim_id: 'c', happened_at: '2026-01-02T10:00:00Z' },
    { victim_id: 'd', admin_reason: 'cheating', happened_at: '2026-01-03T10:00:00Z' }
  ];
  assert.deepEqual(L.generalRanking(s).map(r => [r.id, r.alive, r.rank]), [
    ['a', true, null], ['e', true, null], ['f', true, null],
    ['d', false, 4], ['c', false, 5], ['b', false, 6]
  ]);
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
t('stats: information gathered on every player outside the alliance', () => {
  const s = base();
  Object.assign(s.players[0], { address: '1 rue X', lat: 1, lng: 2, photo_path: 'p.jpg', weapons: 'Banane', address_type: 'residence' });
  Object.assign(s.players[1], { address: '2 rue Y', year: '' });
  Object.assign(s.players[2], { address: '3 rue Z', is_ally: true });
  Object.assign(s.players[3], { address: '4 rue W' }); s.kills = [{ victim_id: 'd' }];
  const c = L.stats(s).collected;
  assert.equal(c.total, 5, 'allies are left out, the dead are counted');
  assert.deepEqual([c.address, c.located, c.photo, c.cls, c.weapons], [3, 1, 1, 4, 1]);
  assert.deepEqual(c.byYear, { '3A': { total: 4, address: 2 }, '?': { total: 1, address: 1 } });
  assert.deepEqual(c.housing, { residence: 1, normale: 2 });
});
t('weapons: catalogue suggestions and merge renaming', () => {
  const W = ['Écocup', 'Banane', 'Bananier', 'Tronçonneuse', 'Lacet'].map(name => ({ name }));
  const names = (q, ex) => L.matchWeapons(q, W, ex).map(m => m.weapon.name + ':' + m.how);
  assert.deepEqual(names('eco-cup'), ['Écocup:exact']);
  assert.deepEqual(names('ecocups'), ['Écocup:exact'], 'a plural is the same weapon');
  assert.deepEqual(names('ban'), ['Banane:prefix', 'Bananier:prefix']);
  assert.deepEqual(names('ban', ['banane']), ['Bananier:prefix'], 'weapons already picked are left out');
  assert.deepEqual(names('tronconeuse'), ['Tronçonneuse:close'], 'a typo still finds the weapon');
  assert.deepEqual(names('ecu'), [], 'short queries do not guess');
  assert.equal(L.renameWeapon('Eco cup, Lacet', 'ecocup', 'Écocup'), 'Écocup, Lacet');
  assert.equal(L.renameWeapon('Ecocup, Écocup', 'ecocup', 'Écocup'), 'Écocup', 'duplicates collapse');
  assert.equal(L.renameWeapon('Lacet', 'ecocup', 'Écocup'), null);
});
t('timetable: iCal parsing, class in progress and next one', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:b', 'DTSTART:20260929T060000Z', 'DTEND:20260929T080000Z', 'SUMMARY:Maths - CM',
    'LOCATION:Amphi A\\, bât. 1', 'DESCRIPTION:Enseignant : X\\nGroupe : 2A TP5', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a', 'DTSTART;TZID=Europe/Paris:20261005T100000', 'DTEND;TZID=Europe/Paris:20261005T120000',
    'SUMMARY:Physique très longue', ' suite', 'END:VEVENT', 'BEGIN:VEVENT', 'SUMMARY:no date', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const ev = L.parseIcs(ics);
  assert.equal(ev.length, 2, 'an event without a date is ignored');
  const b = ev.find(e => e.uid === 'b'), a = ev.find(e => e.uid === 'a');
  assert.equal(b.start.toISOString(), '2026-09-29T06:00:00.000Z');
  assert.equal(b.location, 'Amphi A, bât. 1'); assert.equal(b.description, 'Enseignant : X\nGroupe : 2A TP5');
  assert.equal(a.summary, 'Physique très longuesuite', 'folded lines are joined');
  assert.equal(L.parisParts(a.start).hh, 10, 'times without Z are Paris times');
  let s = L.scheduleAt(ev, new Date('2026-09-29T07:00:00Z'));
  assert.equal(s.current.uid, 'b'); assert.equal(s.next.uid, 'a');
  s = L.scheduleAt(ev, new Date('2026-10-10T00:00:00Z')); assert.equal(s.current, null); assert.equal(s.next, null);
  assert.equal(b.subject, '', 'no "Matière" line: no subject');
});
t('timetable layers: HyperPlanning names, who each layer applies to, merge', () => {
  assert.deepEqual(L.calendarScope('<STI 3A><TD>TD1'), { year: '3A', dept: 'STI', field: 'td', value: 'TD1' });
  assert.deepEqual(L.calendarScope('<2A>'), { year: '2A', dept: '', field: '', value: '' });
  assert.deepEqual(L.calendarScope('<MRI 2A><TP>TP3'), { year: '2A', dept: 'MRI', field: 'tp', value: 'TP3' });
  assert.equal(L.calendarScope('<2A><Groupe>G1').field, 'lang_group');
  assert.equal(L.calendarScope('plain name'), null);
  assert.deepEqual(L.calendarScope('STI 3A', ['MRI', 'STI']), { year: '3A', dept: 'STI', field: '', value: '' }, 'a promotion export has no brackets');
  // 4th year: MRI is split into GP / SA / ME ("MRI 4A - GP"), ERE into options
  assert.deepEqual(L.calendarScope('MRI 4A - GP', ['MRI', 'STI']), { year: '4A', dept: 'MRI', field: 'any', value: 'GP' });
  assert.deepEqual(L.calendarScope('<ERE 4A><OPTIONS>IGR'), { year: '4A', dept: 'ERE', field: 'option', value: 'IGR' });
  const gp = { url: 'x', year: '4A', dept: 'MRI', field: 'any', value: 'GP' };
  assert.ok(L.calendarMatches(gp, { year: '4A', dept: 'MRI', td: 'TD GP' }) && L.calendarMatches(gp, { year: '4A', dept: 'MRI', option: 'GP' }), 'GP written as a TD or an option');
  assert.ok(!L.calendarMatches(gp, { year: '4A', dept: 'MRI', td: 'TD SA' }) && !L.calendarMatches(gp, { year: '4A', dept: 'STI', td: 'GP' }));
  const hol = L.parseIcs('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261024\nDTEND;VALUE=DATE:20261102\nSUMMARY:Vacances\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261026T080000Z\nDTEND:20261026T100000Z\nSUMMARY:Rattrapage\nEND:VEVENT');
  assert.equal(hol[0].allDay, true); assert.equal(hol[1].allDay, false);
  assert.equal(L.scheduleAt(hol, new Date('2026-10-26T09:00:00Z')).current.summary, 'Rattrapage', 'a class beats a holiday');
  assert.equal(L.scheduleAt(hol, new Date('2026-10-27T09:00:00Z')).current.summary, 'Vacances');
  // 2nd year (STPI): the promotion name holds no department; departments come from the game
  const D = ['MRI', 'STI'];
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - COURS>COURS 2A STPI BOURGES', D), { year: '2A', dept: '', field: '', value: '' });
  assert.deepEqual(L.calendarScope('<COURS 2A STPI BOURGES>', D), { year: '2A', dept: '', field: '', value: '' });
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - P.O>MRI', D), { year: '2A', dept: 'MRI', field: '', value: '' });
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - P.O TD>TD 1 MRI', D), { year: '2A', dept: 'MRI', field: 'td', value: 'TD 1 MRI' });
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - P.O TP>TP STI 3', D), { year: '2A', dept: 'STI', field: 'tp', value: 'TP STI 3' });
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - TD>TD 1', D), { year: '2A', dept: '', field: 'td', value: 'TD 1' });
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - LV>Espagnol débutant G1', D), { year: '2A', dept: '', field: 'lang_group', value: 'Espagnol débutant G1' });
  assert.deepEqual(L.calendarScope('<STPI 2A><BOURGES - P.O TD>TD 1 MRI'), { year: '2A', dept: 'MRI', field: 'td', value: 'TD 1 MRI' }, 'real name, even without known departments');
  assert.deepEqual(L.calendarScope('<STI 3A><TD>TD1', D), { year: '3A', dept: 'STI', field: 'td', value: 'TD1' });
  // group names: same group whatever the spaces, the order of the words or leading zeros
  assert.equal(L.groupKey('TD 1 MRI'), L.groupKey('MRI td01')); assert.notEqual(L.groupKey('TD 1'), L.groupKey('TD 1 MRI'));
  const mri = { year: '2A', dept: 'MRI', td: 'TD 2, TD1 MRI', tp: 'TP5, TP MRI 1', lang_group: 'G3' };
  const layers = [{ url: 'po', year: '2A', dept: 'MRI' }, { url: 'potd', year: '2A', dept: 'MRI', field: 'td', value: 'TD 1 MRI' }, { url: 'td1', year: '2A', field: 'td', value: 'TD 1' },
    { url: 'td2', year: '2A', field: 'td', value: 'TD 2' }, { url: 'potp', year: '2A', dept: 'MRI', field: 'tp', value: 'TP MRI 1' }, { url: 'sti', year: '2A', dept: 'STI' }];
  assert.deepEqual(L.calendarsFor(mri, layers).map(c => c.url), ['po', 'potd', 'td2', 'potp'], 'MRI TD 1 is not the general TD 1');
  assert.equal(L.calendarLabel('<STI 3A><TD>TD1'), 'STI 3A · TD1'); assert.equal(L.calendarLabel('<2A>'), '2A');
  const ics = 'BEGIN:VCALENDAR\r\nX-WR-CALNAME;LANGUAGE=fr:HYP - <STI 3A><TD>TD1 - du 24 août au 13 décembre \r\n 2026\r\nEND:VCALENDAR';
  assert.equal(L.icsCalendarName(ics), '<STI 3A><TD>TD1');
  const cals = [{ url: 'a', year: '2A' }, { url: 'b', year: '2A', dept: 'MRI' }, { url: 'c', year: '2A', field: 'td', value: 'TD2' },
    { url: 'd', year: '2A', field: 'lang_group', value: 'G1' }, { url: 'e', year: '3A', field: 'lang_group', value: 'G1' }, { url: '', year: '2A' }];
  const p = { year: '2A', dept: 'MRI', td: 'TD2', tp: 'TP1', lang_group: 'G1, G4' };
  assert.deepEqual(L.calendarsFor(p, cals).map(c => c.url), ['a', 'b', 'c', 'd'], 'every layer of the year, not the 3A G1, not without a link');
  assert.deepEqual(L.calendarsFor({ year: '2A', dept: 'STI', td: 'TD1' }, cals).map(c => c.url), ['a']);
  const e = (h, s) => ({ start: new Date(Date.UTC(2026, 8, 29, h)), end: new Date(Date.UTC(2026, 8, 29, h + 1)), summary: s });
  assert.deepEqual(L.mergeEvents([[e(10, 'Maths'), e(8, 'CM')], [e(8, 'CM'), e(9, 'TP')]]).map(x => x.summary), ['CM', 'TP', 'Maths'], 'sorted, a class in two layers kept once');
  const hp = L.parseIcs('BEGIN:VEVENT\nDTSTART:20260929T060000Z\nDTEND:20260929T070000Z\nSUMMARY:TD1 - EPS - M. X\nDESCRIPTION:TD : TD1\\nMatière : EPS\\nEnseignant : M. X\\n\nEND:VEVENT');
  assert.deepEqual([hp[0].subject, hp[0].teacher], ['EPS', 'M. X']);
});
t('timetable: a whole-promotion export keeps the groups of each player', () => {
  const ev = (uid, summary, desc) => 'BEGIN:VEVENT\nUID:' + uid + '\nDTSTART:20260929T060000Z\nDTEND:20260929T070000Z\nSUMMARY:' + summary + '\nDESCRIPTION:' + desc + '\nEND:VEVENT';
  const list = L.parseIcs([ev('a', 'Amphi', 'Matière : Réseaux'), ev('b', 'TD 1 - Java', 'TD : TD 1\\nMatière : Java'), ev('c', 'TD 2 - Java', 'TD : TD 2\\nMatière : Java'),
    ev('d', 'TD 1, TD 2 - Projet', 'TD : TD 1, TD 2\\nMatière : Projet'), ev('e', 'G 1, G1 - Anglais', 'TD : G 1, G1\\nMatière : Anglais'), ev('f', 'G5 - Anglais', 'TD : G5\\nMatière : Anglais'),
    ev('g', 'TP 1 - Réseau', 'TD : TP 1\\nMatière : Réseau'), ev('h', 'COURS - Rentrée', 'TD : COURS, COURS\\nMatière : Rentrée'),
    ev('COURSANNULE-1', 'Annulation : TD 1 - Java', 'Annulation : \\nTD : TD 1\\nMatière : Java')].join('\n'));
  assert.deepEqual(list.find(e => e.uid === 'e').groups, ['G 1', 'G1']);
  const keep = p => list.filter(e => L.eventForPlayer(e, p)).map(e => e.uid).sort().join('');
  assert.equal(keep({ td: 'TD1', tp: 'TP1', lang_group: 'G1' }), 'abdegh', 'own TD, TP and language group, common classes; not the cancelled one');
  assert.equal(keep({ td: 'TD 2', tp: 'TP2', lang_group: 'G5' }), 'acdfh');
  assert.equal(L.isPromotionView(list), true, 'TD 1, TD 2, G1, G5, TP 1: the whole promotion');
  const kind = uid => L.classKind(list.find(e => e.uid === uid));
  assert.deepEqual(['b', 'e', 'g', 'h'].map(kind), ['td', 'td', 'tp', 'event'], 'TD, language group, TP, whole promotion');
  assert.equal(L.classKind({ groups: [], teacher: 'M. X' }), 'cm', 'no group but a teacher: a lecture');
  assert.equal(L.classKind({ groups: [], teacher: '' }), 'event'); assert.equal(L.classKind({ allDay: true }), 'event');
  // 2nd year: classes for the whole promotion ("COURS 2A STPI BOURGES") and for a department ("MRI")
  assert.equal(L.classKind({ groups: ['COURS 2A STPI BOURGES'], teacher: 'M. X' }), 'cm'); assert.equal(L.classKind({ groups: ['COURS 2A STPI BOURGES'], teacher: '' }), 'event');
  assert.equal(L.classKind({ groups: ['MRI'], teacher: 'M. X' }), 'cm'); assert.equal(L.classKind({ groups: ['TD 1 MRI'], teacher: 'M. X' }), 'td');
  assert.ok(L.eventForPlayer({ groups: ['MRI'] }, { dept: 'MRI' }) && !L.eventForPlayer({ groups: ['MRI'] }, { dept: 'STI' }), 'department classes follow the department');
  assert.equal(L.parseIcs('BEGIN:VEVENT\nDTSTART:20260929T060000Z\nDESCRIPTION:Matière : X\\nEnseignants : M. A, M. B\nEND:VEVENT')[0].teacher, 'M. A, M. B');
  assert.equal(L.isPromotionView(list.filter(e => e.uid === 'b')), false);
});
t('shop bonuses: timing, window, status, backup', () => {
  assert.deepEqual(L.bonusTiming({ start: 'next_day', hours: 24 }), { start: 'next_day', hours: 24 });
  assert.deepEqual(L.bonusTiming({ description: 'Active from 00:10 the day after purchase, for 24 hours.' }), { start: 'next_day', hours: 24 }, 'older items: from the description');
  assert.deepEqual(L.bonusTiming({ description: 'Désactive les notifications pendant 2 heures. Actif immédiatement.' }), { start: 'now', hours: 2 });
  const w = L.bonusWindow({ start: 'next_day', hours: 24 }, '2026-09-28T19:30:00Z');   // 21:30 in Paris
  assert.deepEqual([w.starts.toISOString(), w.ends.toISOString()], ['2026-09-28T22:10:00.000Z', '2026-09-29T22:10:00.000Z'], '00:10 the next day, Paris time');
  assert.equal(L.bonusWindow({ start: 'now', hours: 0 }, '2026-09-28T19:30:00Z').ends, null, 'one-off');
  const b = { player_id: 'a', starts_at: '2026-09-28T22:10:00Z', ends_at: '2026-09-29T22:10:00Z' };
  assert.deepEqual(['2026-09-28T20:00:00Z', '2026-09-29T08:00:00Z', '2026-09-30T08:00:00Z'].map(d => L.bonusStatus(b, new Date(d))), ['upcoming', 'active', 'over']);
  assert.equal(L.bonusStatus({ starts_at: '2026-09-28T19:30:00Z', ends_at: null }, new Date('2026-09-28T19:31:00Z')), 'over', 'a one-off is used at once');
  assert.equal(L.currentBonuses({ bonuses: [b, { player_id: 'b', starts_at: b.starts_at, ends_at: b.ends_at }] }, 'a', new Date('2026-09-29T08:00:00Z')).length, 1);
  const s = base(); s.bonuses = [{ id: 'x', player_id: 'a', name: 'Immunité', price: 3, starts_at: b.starts_at, ends_at: null }, { id: 'y', player_id: 'gone', name: 'X' }];
  const r = L.readBackup(JSON.stringify(L.makeBackup(s)), { uuid: () => '00000000-0000-4000-8000-' + String(Math.random()).slice(2, 14).padEnd(12, '0') });
  assert.equal(r.data.bonuses.length, 1, 'a bonus of an unknown player is dropped'); assert.equal(r.data.bonuses[0].ends_at, null);
  assert.equal(r.data.bonuses[0].player_id, r.data.players.find(p => p.name === 'A').id, 'follows the player id');
});
t('danger alerts for the alliance', () => {
  const s = base(); s.players[0].is_ally = true;                                   // a is ours
  s.links = [link('r0', 'f', 'a'), link('r0', 'a', 'b')];                          // f hunts a, a hunts b
  s.settings = { shop: [{ name: 'Super Coupe-Gorge', price: 8 }, { name: 'Coupe-Gorge', price: 6 }] };
  const now = new Date('2026-09-29T10:00:00Z');
  assert.deepEqual(L.dangerAlerts(s, now), []);
  s.players[5].points = 9; assert.deepEqual(L.dangerAlerts(s, now).map(x => x.kind), ['rich'], 'the hunter can afford the strongest bonus');
  s.bonuses = [{ player_id: 'f', name: 'Coupe-Gorge', starts_at: '2026-09-28T22:10:00Z', ends_at: '2026-09-29T22:10:00Z' },
    { player_id: 'b', name: 'Immunité', starts_at: '2026-09-28T22:10:00Z', ends_at: '2026-09-29T22:10:00Z' }];
  s.players[5].status = 'dangerous';
  const a = L.dangerAlerts(s, now);
  assert.deepEqual(a.map(x => x.level + ':' + x.kind), ['high:cutthroat', 'warn:dangerous', 'info:immune'], 'a bought cut-throat replaces the "rich" warning');
  assert.equal(a[0].otherId, 'f'); assert.equal(a[2].otherId, 'b');
  s.players[1].is_ally = true;
  assert.ok(!L.dangerAlerts(s, now).some(x => x.kind === 'immune'), 'hunting an ally (tanking): their immunity does not matter');
});
t('moments to catch a target', () => {
  const at = (h, m) => new Date(Date.UTC(2026, 9, 5, h - 2, m));   // Monday 5 Oct 2026, Paris time (UTC+2)
  const cls = (h1, m1, h2, m2, where) => ({ start: at(h1, m1), end: at(h2, m2), location: where });
  const target = [cls(8, 0, 9, 20, 'SA2.04'), cls(9, 30, 10, 50, 'SA2.04'), cls(14, 0, 15, 20, 'SA1.01'), cls(21, 0, 22, 0, 'SA1.01')];
  const mine = [cls(8, 0, 12, 0, 'SA2.10'), cls(15, 30, 16, 30, 'SA1.05')];
  const w = L.killWindows(target, mine, at(7, 0), 1);
  const show = x => L.parisParts(x.at).hh + ':' + String(L.parisParts(x.at).mi).padStart(2, '0') + ' ' + x.kind + (x.near ? ' near' : '');
  assert.deepEqual(w.map(show), ['8:00 arrives near', '14:00 arrives near', '15:20 leaves near'],
    'arriving at 8:00 like me counts (corridors); not while I am in the middle of a class (10:50), not the break between two classes in the same room, not after 20:00');
  assert.equal(L.killWindows(target, [], at(7, 0), 1).length, 4, 'no timetable of mine: every arrival and exit before 20:00');
  assert.equal(L.building('SA2.04'), 'SA2', 'building and floor'); assert.equal(L.building('SA1.01'), 'SA1'); assert.equal(L.building('Amphi Imperialis'), 'AMPHI');
});
t('Paris time whatever the time zone of the phone', () => {
  const p = L.parisParts(new Date('2026-09-28T11:40:00Z'));
  assert.deepEqual([p.hh, p.mi, p.wd], [13, 40, 0], 'summer time: UTC+2, a Monday');
  assert.equal(L.parisParts(new Date('2026-12-01T11:40:00Z')).hh, 12, 'winter time: UTC+1');
  assert.equal(L.parisDate(2026, 8, 28, 13, 40).toISOString(), '2026-09-28T11:40:00.000Z');
  assert.equal(L.parisDate(2026, 8, 30 + 2, 0, 0).toISOString(), '2026-10-01T22:00:00.000Z', 'day overflow: 32 Sept = 2 Oct');
  assert.equal(L.parisDay(new Date('2026-09-28T22:30:00Z')), '2026-9-29', 'already the next day in Paris');
  assert.equal(L.parseIcs('BEGIN:VEVENT\nDTSTART;TZID=Europe/Paris:20261005T100000\nEND:VEVENT')[0].start.toISOString(), '2026-10-05T08:00:00.000Z', 'iCal local times are Paris times');
});
t('backup: round trip, demo ids remapped, dangling references dropped', () => {
  let k = 0; const uuid = () => `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
  const s = base(); s.links = [link('r0', 'a', 'b', 'bogus'), link('r0', 'b', 'zz'), link('rX', 'c', 'd')];
  s.kills = [{ id: 'k1', round_id: 'r0', killer_id: 'gone', victim_id: 'b', points: '3' }, { id: 'k2', victim_id: 'b' }];
  s.events = [{ id: 'e1', text: 'kill', details: { kill_id: 'k1', victim_id: 'b', victim: 'B' } }];
  s.settings = { game_name: 'Test' };
  const r = L.readBackup(JSON.stringify(L.makeBackup(s, '2026-01-01T00:00:00.000Z')), { uuid, now: 'NOW' });
  assert.equal(r.meta.name, 'Test'); assert.equal(r.data.players.length, 6);
  const id = old => r.data.players.find(p => p.name === old.toUpperCase()).id;
  assert.ok(r.data.players.every(p => /^0{8}-/.test(p.id) && p.points === 0 && p.photo_path === null && p.created_at === 'NOW'));
  assert.equal(r.data.links.length, 1, 'links to unknown players or rounds are dropped');
  assert.deepEqual([r.data.links[0].hunter_id, r.data.links[0].target_id, r.data.links[0].confidence], [id('a'), id('b'), 'sur']);
  assert.equal(r.data.kills.length, 1, 'one kill per victim');
  assert.deepEqual([r.data.kills[0].killer_id, r.data.kills[0].victim_id, r.data.kills[0].points], [null, id('b'), 3]);
  assert.equal(r.data.events[0].details.kill_id, r.data.kills[0].id); assert.equal(r.data.events[0].details.victim_id, id('b'));
  const keep = '11111111-2222-4333-8444-555555555555';
  assert.equal(L.readBackup({ players: [{ id: keep, name: 'X' }] }, { uuid }).data.players[0].id, keep, 'real UUIDs are kept');
  assert.ok(L.readBackup('{').error); assert.ok(L.readBackup('{"format":"other","players":[]}').error); assert.ok(L.readBackup('[]').error);
});
console.log(`\n${n} tests OK`);
