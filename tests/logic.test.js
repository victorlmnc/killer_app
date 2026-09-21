// node tests/logic.test.js
const assert = require('node:assert');
const L = require('../js/logic.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const P = ids => ids.map(id => ({ id, name: id.toUpperCase(), year: '3A', td: 'TD1' }));
const link = (r, a, b, c = 'sur') => ({ id: `${r}:${a}>${b}`, round_id: r, hunter_id: a, target_id: b, confidence: c });
const apply = (s, plan) => { s.links = s.links.filter(l => !plan.remove.includes(l)); plan.add.forEach((l, i) => s.links.push({ id: 'n' + Math.random(), ...l })); };
const base = () => ({ players: P(['a', 'b', 'c', 'd', 'e', 'f']), rounds: [{ id: 'r0', position: 0 }], links: [], kills: [] });

t('la cible actuelle saute les morts', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'c', 'd', 'rumeur')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }, { round_id: 'r0', killer_id: 'a', victim_id: 'c' }];
  const r = L.resolveTarget(s, 'r0', 'a');
  assert.equal(r.id, 'd'); assert.deepEqual(r.via, ['b', 'c']); assert.equal(r.confidence, 'rumeur');
  assert.equal(L.resolveHunter(s, 'r0', 'd').id, 'a');
});
t('piste perdue après un mort', () => {
  const s = base(); s.links = [link('r0', 'a', 'b')]; s.kills = [{ round_id: 'r0', victim_id: 'b' }];
  const r = L.resolveTarget(s, 'r0', 'a'); assert.equal(r.id, null); assert.deepEqual(r.via, ['b']);
  const f = L.fragments(s, 'r0', 'current');
  assert.equal(f.fragments.length, 1); assert.deepEqual(f.fragments[0].tail.via, ['b']);
});
t('fragments : chaîne ouverte, boucle fermée, non placés', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r0', 'd', 'e'), link('r0', 'e', 'd')];
  const f = L.fragments(s, 'r0', 'current');
  assert.deepEqual(f.fragments.map(x => x.ids.join('')), ['abc', 'de']);
  assert.equal(f.fragments[1].closed, true); assert.deepEqual(f.unplaced, ['f']);
});
t('dernier survivant : pas de boucle infinie', () => {
  const s = base(); s.players = P(['a', 'b']); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'a')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }];
  const r = L.resolveTarget(s, 'r0', 'a'); assert.equal(r.id, null); assert.equal(r.closed, true);
});
t('définir une cible accroche le lien au dernier mort connu', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c')];
  s.kills = [{ round_id: 'r0', victim_id: 'b' }, { round_id: 'r0', victim_id: 'c' }];
  const plan = L.planSetTarget(s, 'r0', 'a', 'e'); assert.equal(plan.anchorId, 'c'); assert.equal(plan.viaDead, true);
  apply(s, plan);
  assert.equal(L.resolveTarget(s, 'r0', 'a').id, 'e');
  assert.equal(s.links.length, 3, 'la chaîne complète est conservée');
});
t('définir une cible remplace les liens contradictoires', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'c', 'd')];
  const plan = L.planSetTarget(s, 'r0', 'a', 'd'); assert.equal(plan.remove.length, 2); apply(s, plan);
  assert.equal(L.resolveTarget(s, 'r0', 'a').id, 'd'); assert.equal(L.resolveTarget(s, 'r0', 'c').id, null);
  assert.equal(L.planSetTarget(s, 'r0', 'a', 'd').noop, true);
  assert.ok(L.planSetTarget(s, 'r0', 'a', 'a').error);
});
t('insérer un mort entre un joueur et sa cible', () => {
  const s = base(); s.links = [link('r0', 'a', 'c')]; s.kills = [{ round_id: 'r0', victim_id: 'b' }];
  apply(s, L.planSetTarget(s, 'r0', 'a', 'b'));
  assert.equal(L.resolveTarget(s, 'r0', 'a').id, 'c'); assert.deepEqual(L.resolveTarget(s, 'r0', 'a').via, ['b']);
  assert.deepEqual(L.fragments(s, 'r0', 'complete').fragments[0].ids, ['a', 'b', 'c']);
});
t('reroll : les anciennes boucles restent consultables', () => {
  const s = base(); s.rounds.push({ id: 'r1', position: 1 });
  s.links = [link('r0', 'a', 'b'), link('r0', 'b', 'c'), link('r1', 'c', 'a')];
  s.kills = [{ round_id: 'r0', killer_id: 'a', victim_id: 'b' }, { round_id: 'r1', killer_id: 'c', victim_id: 'a' }];
  assert.equal(L.currentRound(s).id, 'r1');
  assert.deepEqual([...L.deadSet(s, 'r0')], ['b']);          // dans l'archive, a est encore vivant
  assert.deepEqual(L.fragments(s, 'r0', 'current').fragments[0].ids, ['a', 'c']);
  const now = L.fragments(s, 'r1', 'complete');
  assert.ok(!now.fragments.some(f => f.ids.includes('b')), 'b est mort avant le reroll');
  assert.deepEqual(now.fragments[0].ids, ['c', 'a']);
});
t('stats, classement avec ex aequo, points', () => {
  const s = base(); s.links = [link('r0', 'a', 'b'), link('r0', 'c', 'd')];
  s.kills = [{ round_id: 'r0', killer_id: 'e', victim_id: 'f' }, { round_id: 'r0', victim_id: 'b' }];
  const st = L.stats(s); assert.equal(st.alive, 4); assert.equal(st.dead, 2); assert.equal(st.unattributed, 1);
  assert.equal(st.knownTargets, 1); assert.equal(st.coverage, 0.25);
  s.kills.push({ round_id: 'r0', killer_id: 'a', victim_id: 'c' }, { round_id: 'r0', killer_id: 'a', victim_id: 'd' });
  assert.deepEqual(L.leaderboard(s).map(r => r.label), ['1er', '2ème']);
  assert.equal(L.killPoints({ difficulty: 'difficile', bonus: 2, firstBlood: true, mates: 1 }), 11);
});
t("import : collage Excel, seuls les inscrits sont gardés", () => {
  const txt = 'Joue au Killer ?\tNom\tAnnée\tDépartement\tTD\tPoints\nOUI\tDUPONT Léa\t3A\tSTI\tTD1\t45812\nNON\tMARTIN Paul\t4A\tMRI\tTD2\t\n\tDURAND Zoé\t2A\tSTI\tTD3\t';
  const r = L.parseImport(txt); assert.equal(r.rows.length, 1); assert.equal(r.skipped, 2);
  assert.deepEqual(r.rows[0], { name: 'DUPONT Léa', year: '3A', dept: 'STI', td: 'TD1', points: 0 });
  const csv = L.parseImport('Nom;Année\n"LE GALL; Yann";5A'); assert.equal(csv.rows[0].name, 'LE GALL; Yann');
  assert.equal(L.parseImport('VALJEAN Jean\nJAVERT Paul').rows.length, 2);
});
console.log(`\n${n} tests OK`);
