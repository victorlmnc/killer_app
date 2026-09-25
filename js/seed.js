/* Seed data: everything that is not personal (weapon catalogue, shop, scoring, colours) and a fictional demo game.
   Player names only exist in the database, behind the login; the demo uses characters from 19th-century novels. */
(function () {
  'use strict';
  var K = (window.K = window.K || {});

  var WEAPONS = [
    ["5eme Tome Harry Potter", "difficile"],
    ["8.6", "facile"],
    ["Ancien pain du ru", "difficile"],
    ["Arrosoir", "difficile"],
    ["Aspirateur", "difficile"],
    ["Autocollant A", "facile"],
    ["Bac à glaçons", "facile"],
    ["Bague", "facile"],
    ["Balance", "difficile"],
    ["Balle de ping pong", "facile"],
    ["Banane", "facile"],
    ["Boite à pizza", "facile"],
    ["Boîte de kapla", "difficile"],
    ["Bonnet de Noël", "facile"],
    ["Bouilloire", "facile"],
    ["Boule de pétanque", "facile"],
    ["Briquet", "facile"],
    ["Brosse à cheveux", "facile"],
    ["Brosse à dents", "facile"],
    ["Caddie Carrefour", "difficile"],
    ["café", "facile"],
    ["Cafetière", "difficile"],
    ["Caisse à savon", "difficile"],
    ["Cape vador", "difficile"],
    ["Carte d'identité", "facile"],
    ["Casque audio", "facile"],
    ["Cerceau", "difficile"],
    ["Chaise", "difficile"],
    ["Charbon", "facile"],
    ["Chaudron", "difficile"],
    ["Chocolat", "facile"],
    ["Ciseaux", "facile"],
    ["Citrouille", "facile"],
    ["Cloche", "difficile"],
    ["Contravention", "difficile"],
    ["Coupe-ongle", "facile"],
    ["Coussin", "difficile"],
    ["Couverture de survie", "facile"],
    ["Cravate", "facile"],
    ["Danseuse hawaïenne", "difficile"],
    ["Dock de Switch", "facile"],
    ["DockdeSwitch", "facile"],
    ["Écocup", "facile"],
    ["Éponge", "facile"],
    ["Étendoir", "difficile"],
    ["Flûte", "difficile"],
    ["flyerpépite", "facile"],
    ["Gilet fluo", "facile"],
    ["Gilet violet du H5", "difficile"],
    ["Guirlande", "difficile"],
    ["guitare", "difficile"],
    ["Imprimante", "difficile"],
    ["Jeu de cartes", "facile"],
    ["kebab", "difficile"],
    ["Lacet", "facile"],
    ["Lampe de bureau", "difficile"],
    ["Lego", "facile"],
    ["Livre", "facile"],
    ["Luge", "difficile"],
    ["Lunettes", "facile"],
    ["Lunettes de soleil", "facile"],
    ["Magnet département", "facile"],
    ["Marteau", "facile"],
    ["matelas", "difficile"],
    ["Mégaphone", "difficile"],
    ["Miel", "facile"],
    ["Ordinateur fixe", "difficile"],
    ["Panneau bourges", "difficile"],
    ["Pasteisdenata", "difficile"],
    ["PatateDouce", "difficile"],
    ["Patin à glace", "difficile"],
    ["pelle", "difficile"],
    ["Permis de conduire", "facile"],
    ["Photo dédicacée de Maki", "difficile"],
    ["Photodugala", "facile"],
    ["Pierre", "facile"],
    ["PileAAA", "facile"],
    ["Plancha", "difficile"],
    ["Plaquedecuisson", "difficile"],
    ["Plateau du ru", "difficile"],
    ["Plot de l'AS", "difficile"],
    ["Poele", "facile"],
    ["porte", "difficile"],
    ["Poubelle de bureau", "facile"],
    ["quatre-quart", "difficile"],
    ["Queue de billard", "difficile"],
    ["Règle de 1M", "difficile"],
    ["Rouleau de peinture", "difficile"],
    ["Rouleau de sopalin", "facile"],
    ["Saucisson", "facile"],
    ["Savon de marseille", "facile"],
    ["Serpillère", "difficile"],
    ["Souris de PC", "facile"],
    ["T-shirt cerbère", "facile"],
    ["T-shirt Kraken", "facile"],
    ["T-shirt Minotaure", "facile"],
    ["T-shirt phoenix", "facile"],
    ["T-shirt Sphinx", "facile"],
    ["Table", "difficile"],
    ["Télévision", "difficile"],
    ["Ticket de parking", "facile"],
    ["ticketdecaisse", "facile"],
    ["Tournevis", "facile"],
    ["Trèfle à 4 feuilles", "difficile"],
    ["Tronçonneuse", "difficile"],
    ["Tuyau d'arrosage", "difficile"],
    ["valise", "difficile"],
    ["vase", "facile"],
    ["vibromasseur", "difficile"],
    ["vinyle", "difficile"],
    ["Wiimote", "difficile"],
    ["Glaçon", "difficile"],
    ["Assiette Creuse", "facile"],
    ["Spatule", "facile"],
    ["Couche", "difficile"],
    ["Compote", "facile"],
    ["baguetteschinoises", "facile"],
    ["dockdeswitch2", "difficile"],
    ["lettredamour", "difficile"],
    ["equerre", "facile"]
  ];

  var SHOP = [
      {
          "name": "Super Coupe-Gorge",
          "price": 8,
          "description": "Your target cannot be saved by other players or by an immunity. Active from 00:10 the day after purchase, for 24 hours. Does not override truces."
      },
      {
          "name": "Coupe-Gorge",
          "price": 6,
          "description": "Your target cannot be saved by other players, unless they have an active immunity. Active from 00:10 the day after purchase, for 24 hours. Does not override truces."
      },
      {
          "name": "Révélation",
          "price": 3,
          "description": "Reveals who is currently hunting you. Once the window is closed it cannot be reopened without buying the bonus again. Active immediately."
      },
      {
          "name": "Brouilleur",
          "price": 1,
          "description": "Disables kill and bonus notifications for every player for 2 hours. Stacks: a new jammer resets the timer. Active immediately."
      },
      {
          "name": "Immunité",
          "price": 3,
          "description": "You cannot be killed for 24 hours, except by a Super Coupe-Gorge. Active from 00:10 the day after purchase."
      }
  ];

  var POINT_RULES = [
    { label: 'Easy weapon', points: '1' }, { label: 'Hard weapon', points: '3' },
    { label: 'Easy weapon + video', points: '2 to 4' }, { label: 'Hard weapon + video', points: '4 to 6' },
    { label: 'Easy weapon + kill witnessed by the organiser', points: '3 to 5' }, { label: 'Hard weapon + kill witnessed by the organiser', points: '5 to 7' },
    { label: 'First blood', points: '+5' }, { label: 'Multi-kill', points: '+1 per teammate' }
  ];

  K.seed = {
    weapons: WEAPONS,
    settings: {
      game_name: 'Killer',
      school_total: 0,
      official_players: 0,
      years: [{ name: '1', color: '#5B9BD5' }, { name: '2', color: '#6FAE5A' }, { name: '3', color: '#D9A520' }, { name: '4', color: '#D9605F' }, { name: '5', color: '#9B6BD9' }],
      depts: [],
      map_center: { lat: 48.8566, lng: 2.3522 },
      geocoder_url: '',
      links: [],
      shop: SHOP,
      point_rules: POINT_RULES
    }
  };

  /* ---------- Demo game ---------- */
  var CAST = ['VALJEAN Jean', 'JAVERT Émile', 'THÉNARDIER Éponine', 'PONTMERCY Marius', 'RASTIGNAC Eugène', 'BOVARY Emma',
    'SOREL Julien', 'LUPIN Arsène', 'DANTÈS Edmond', 'DE WINTER Milady', 'BERGERAC Cyrano', 'ROBIN Roxane', 'NEMO Pierre',
    'PASSEPARTOUT Jean', 'AROUET Candide', 'ALMAVIVA Figaro', 'LESCAUT Manon', 'DUROY Georges', 'RAQUIN Thérèse',
    'MACQUART Gervaise', 'LANTIER Étienne', 'COUPEAU Anna', 'GRANDET Eugénie', 'GORIOT Delphine', 'MEAULNES Augustin',
    'DE GALAIS Yvonne', 'SWANN Charles', 'DE CRÉCY Odette', 'ROULETABILLE Joseph', 'FROLLO Claude', 'GRINGOIRE Pierre',
    'HERREJON Mercédès', 'MORREL Maximilien', 'DE VILLEFORT Valentine', 'SCAPIN Léandre', 'POQUELIN Agnès',
    'JOURDAIN Lucile', 'MAUPIN Madeleine', 'ARONNAX Pierre', 'LAND Édouard', 'DE RÊNAL Louise', 'DE LA MOLE Mathilde'];

  K.seed.demo = function () {
    var n = 0, uid = function () { return 'demo-' + (++n); };
    var years = ['2', '3', '4', '5'], depts = ['A', 'B'];
    var streets = ['rue de la Paix', 'avenue de la République', 'rue des Écoles', 'boulevard Voltaire', 'rue Pasteur', 'avenue Jean Jaurès', 'rue Victor Hugo', 'rue du Port'];
    // Made-up addresses; two shared residences show how markers are grouped.
    function home(i) {
      if (i % 5 === 4) return { address: '', lat: null, lng: null, address_type: 'normale' };
      if (i % 7 === 3) return { address: 'Résidence des Tanneurs', lat: 47.08712, lng: 2.39105, address_type: 'residence' };
      if (i % 9 === 5) return { address: 'Résidence du Lac', lat: 47.06655, lng: 2.41240, address_type: 'residence' };
      if (i % 8 === 0) return { address: '14 rue du Port', lat: 47.07410, lng: 2.39520, address_type: 'coloc' };
      var a = { address: (3 + (i * 7) % 90) + ' ' + streets[i % streets.length], address_type: i % 6 === 1 ? 'immeuble' : 'normale' };
      if (i % 11 === 6) { a.lat = null; a.lng = null; return a; }
      a.lat = +(47.0833 + Math.sin(i * 2.4) * 0.016).toFixed(5); a.lng = +(2.4 + Math.cos(i * 1.7) * 0.026).toFixed(5);
      return a;
    }
    var players = CAST.map(function (name, i) {
      var y = years[i % 4], hm = home(i);
      return { id: uid(), name: name, address: hm.address, address_type: hm.address_type, lat: hm.lat, lng: hm.lng, year: y, dept: depts[(i >> 1) % 2], td: 'TD' + (1 + (i % 3)), tp: y === '5' ? '' : 'TP' + (1 + (i % 5)),
        option: i % 4 >= 2 ? ['Option A', 'Option B', 'Option C'][i % 3] : '', lang_group: 'G' + (1 + (i % 6)), notes: '', weapons: '', points: 0,
        is_ally: i === 7 || i === 8 || i === 10 || i === 12, photo_path: null };
    });
    var easy = WEAPONS.filter(function (w) { return w[1] === 'facile'; }), hard = WEAPONS.filter(function (w) { return w[1] === 'difficile'; });
    players.forEach(function (p, i) { if (i % 3 !== 1) p.weapons = easy[(i * 7) % easy.length][0] + ', ' + hard[(i * 5) % hard.length][0]; });

    var r0 = { id: uid(), name: 'Initial loop', position: 0 }, r1 = { id: uid(), name: 'Reroll 1', position: 1 };
    var links = [], kills = [], P = players, conf = ['sur', 'sur', 'probable', 'sur', 'rumeur'];
    function L(round, a, b, c) { links.push({ id: uid(), round_id: round.id, hunter_id: P[a].id, target_id: P[b].id, confidence: c || 'sur', source: '' }); }
    function X(round, a, b, weapon, pts, daysAgo) {
      kills.push({ id: uid(), round_id: round.id, killer_id: a == null ? null : P[a].id, victim_id: P[b].id, weapon: weapon, points: pts, note: '', happened_at: new Date(Date.now() - daysAgo * 864e5).toISOString() });
      if (a != null) P[a].points += pts;
    }
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]].forEach(function (e, i) { L(r0, e[0], e[1], conf[i % 5]); });
    [[14, 15], [15, 16], [16, 17], [17, 18]].forEach(function (e) { L(r0, e[0], e[1]); });
    [[25, 26], [26, 27]].forEach(function (e) { L(r0, e[0], e[1], 'probable'); });
    X(r0, 0, 1, 'Banane', 6, 12); X(r0, 0, 2, 'Arrosoir', 3, 11); X(r0, 14, 15, 'Lacet', 1, 11); X(r0, null, 30, '', 0, 10);
    X(r0, 5, 6, 'Chaise', 4, 9); X(r0, 25, 26, 'Briquet', 1, 9); X(r0, null, 33, '', 0, 8); X(r0, 16, 17, 'Cravate', 1, 8);
    [[7, 20], [20, 8], [8, 0], [0, 22]].forEach(function (e) { L(r1, e[0], e[1]); });
    [[10, 35], [35, 12], [12, 28]].forEach(function (e, i) { L(r1, e[0], e[1], i === 2 ? 'rumeur' : 'sur'); });
    [[38, 3], [3, 10]].forEach(function (e) { L(r1, e[0], e[1], 'probable'); });
    [[40, 41], [41, 24]].forEach(function (e) { L(r1, e[0], e[1]); });
    X(r1, 7, 20, 'Écocup', 2, 3); X(r1, 40, 41, 'Tronçonneuse', 5, 2); X(r1, null, 19, '', 0, 1);

    var now = Date.now();
    var k1 = kills.filter(function (k) { return k.victim_id === P[20].id; })[0]; k1.note = 'Outside the canteen at 12:40, he was alone. Video sent to the organiser.';
    links.filter(function (l) { return l.hunter_id === P[10].id; })[0].source = 'Seen on his phone during a lecture';
    links.filter(function (l) { return l.hunter_id === P[12].id; })[0].source = 'Heard from a 3rd year, unverified';
    var events = [
      { text: 'LUPIN Arsène eliminated LANTIER Étienne (Écocup)', details: { type: 'kill', kill_id: k1.id, killer_id: P[7].id, victim_id: P[20].id, killer: P[7].name, victim: P[20].name, weapon: 'Écocup', points: 2, note: k1.note } },
      { text: 'Link added: BERGERAC Cyrano hunts POQUELIN Agnès', details: { type: 'link', hunter_id: P[10].id, target_id: P[35].id, hunter: P[10].name, target: P[35].name, confidence: 'sur', source: 'Seen on his phone during a lecture' } },
      { text: 'New round: Reroll 1', details: null }
    ].map(function (e, i) { return { id: uid(), text: e.text, details: e.details, actor: 'Arsène', created_at: new Date(now - (i + 1) * 36e5 * 7).toISOString() }; });

    var settings = JSON.parse(JSON.stringify(K.seed.settings));
    settings.game_name = 'Killer (demo)'; settings.official_players = 48; settings.school_total = 440; settings.depts = ['A', 'B'];
    settings.map_center = { lat: 47.0833, lng: 2.4 };
    return { players: players, rounds: [r0, r1], links: links, kills: kills, events: events, settings: settings,
      spots: [{ id: uid(), name: 'Campus gate', note: 'Everybody walks through it between classes.', address: '', lat: 47.0822, lng: 2.4163 },
        { id: uid(), name: 'Canteen', note: 'Busy between 12:00 and 13:00.', address: '', lat: 47.0809, lng: 2.4149 }],
      weapons: WEAPONS.map(function (w) { return { id: uid(), name: w[0], difficulty: w[1] }; }),
      members: [{ email: 'demo@local', name: 'Demo', role: 'admin', tabs: null, avatar_path: null }] };
  };
})();
