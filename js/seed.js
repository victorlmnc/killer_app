/* Données de départ : tout ce qui n'est PAS personnel (armes, shop, barème, couleurs).
   Aucun nom d'élève ici : les joueurs ne vivent que dans la base Supabase, derrière le login. */
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
    {"name": "Super Coupe Gorge", "price": 8, "description": "Le super coupe-gorge vous permet de tuer votre cible sans qu'elle ne puisse être sauvée par d’autres joueurs ou par l’immunité. La seule chose qui peut sauver votre victime est son intelligence et sa capacité à courir vite. Attention : Ce bonus ne permet pas de passer outre les trêves applicables à votre cible. Ce bonus est activé le lendemain de l’achat à 00:10 et est valable pendant 24h."},
    {"name": "Coupe Gorge", "price": 6, "description": "Le coupe-gorge vous permet de tuer votre cible sans qu'elle ne puisse être sauvée par d’autres joueurs, sauf si votre victime possède une immunité active en même temps. Attention : Ce bonus ne permet pas de passer outre les trêves applicables à votre cible. Ce bonus est activé le lendemain de l’achat à 00:10 et est valable pendant 24h."},
    {"name": "Révélation", "price": 3, "description": "La révélation permet de connaître votre killer actuel. Attention : Une fois la fenêtre montrant votre killer fermée dans l’application, il ne sera plus possible de le revoir à moins de repayer le bonus. Ce bonus est actif immédiatement après l’achat."},
    {"name": "Brouilleur", "price": 1, "description": "Le brouilleur permet à un joueur de désactiver les notifications et messages (kills et bonus) pour tous les joueurs pendant 2 heures. Le brouilleur est cumulable : si un autre brouilleur est activé pendant qu'un autre est déjà en cours, le minuteur est remis à zéro, et toutes les notifications (y compris celle signalant l’achat du brouilleur) seront libérées à la fin du dernier brouilleur. Ce bonus prend effet immédiatement après l’achat. La seule limite est qu’il ne peut pas être activé entre le moment où un kill est effectué et le scan de la carte par le joueur ayant réalisé le kill (aucun problème si des coéquipiers avec lui l’activent à ce moment-là)."},
    {"name": "Immunité", "price": 3, "description": "L’immunité vous permet d’être protégé contre les kills pendant 24 heures. Vous pourrez continuer à jouer normalement, mais vous ne pourrez pas être tué, à moins que votre killer n'achète un super Coupe-Gorge. Ce bonus est activé le lendemain de l’achat à 00:10 et est valable pendant 24h."}
  ];

  var POINT_RULES = [
    { label: 'Arme facile', points: '1' }, { label: 'Arme difficile', points: '3' },
    { label: 'Arme facile + vidéo', points: '2 à 4' }, { label: 'Arme difficile + vidéo', points: '4 à 6' },
    { label: 'Arme facile + kill avec Orion', points: '3 à 5' }, { label: 'Arme difficile + kill avec Orion', points: '5 à 7' },
    { label: 'First blood', points: '+5' }, { label: 'Multi-kill', points: '+1 par coéquipier' }
  ];

  K.seed = {
    weapons: WEAPONS,
    settings: {
      game_name: 'Killer 2027',
      school_total: 441,
      official_players: 0,
      years: [{ name: '2A', color: '#5B9BD5' }, { name: '3A', color: '#6FAE5A' }, { name: '4A', color: '#D9A520' }, { name: '5A', color: '#D9605F' }],
      depts: ['MRI', 'STI', 'ERE'],
      map_center: { lat: 47.0833, lng: 2.4 }, // Bourges : centre de la carte et priorité du géocodage
      links: [{ label: 'Règles du jeu', url: 'https://killer-insa.github.io/public/regles/index.html' }],
      shop: SHOP,
      point_rules: POINT_RULES
    }
  };

  /* ---------- Partie fictive pour le mode démo (personnages de romans, aucun élève réel) ---------- */
  var CAST = ['VALJEAN Jean', 'JAVERT Émile', 'THÉNARDIER Éponine', 'PONTMERCY Marius', 'RASTIGNAC Eugène', 'BOVARY Emma',
    'SOREL Julien', 'LUPIN Arsène', 'DANTÈS Edmond', 'DE WINTER Milady', 'BERGERAC Cyrano', 'ROBIN Roxane', 'NEMO Pierre',
    'PASSEPARTOUT Jean', 'AROUET Candide', 'ALMAVIVA Figaro', 'LESCAUT Manon', 'DUROY Georges', 'RAQUIN Thérèse',
    'MACQUART Gervaise', 'LANTIER Étienne', 'COUPEAU Anna', 'GRANDET Eugénie', 'GORIOT Delphine', 'MEAULNES Augustin',
    'DE GALAIS Yvonne', 'SWANN Charles', 'DE CRÉCY Odette', 'ROULETABILLE Joseph', 'FROLLO Claude', 'GRINGOIRE Pierre',
    'HERREJON Mercédès', 'MORREL Maximilien', 'DE VILLEFORT Valentine', 'SCAPIN Léandre', 'POQUELIN Agnès',
    'JOURDAIN Lucile', 'MAUPIN Madeleine', 'ARONNAX Pierre', 'LAND Édouard', 'DE RÊNAL Louise', 'DE LA MOLE Mathilde'];

  K.seed.demo = function () {
    var n = 0, uid = function () { return 'demo-' + (++n); };
    var years = ['2A', '3A', '4A', '5A'], depts = ['MRI', 'STI'], streets = ['rue Moyenne', 'avenue de Dun', 'rue de Turly', 'boulevard Lahitolle', 'rue Jean Baffier', 'avenue Ernest Renan', 'rue Barbès', 'rue d\'Auron'];
    // Adresses inventées pour des personnages de roman ; deux résidences partagées pour montrer le regroupement des points.
    function home(i) {
      if (i % 5 === 4) return { address: '', lat: null, lng: null };
      if (i % 7 === 3) return { address: 'Résidence des Tanneurs, Bourges', lat: 47.08712, lng: 2.39105 };
      if (i % 9 === 5) return { address: 'Résidence du Lac, Bourges', lat: 47.06655, lng: 2.41240 };
      var a = { address: (3 + (i * 7) % 90) + ' ' + streets[i % streets.length] + ', Bourges' };
      if (i % 11 === 6) { a.lat = null; a.lng = null; return a; } // pas encore localisée
      a.lat = +(47.0833 + Math.sin(i * 2.4) * 0.016).toFixed(5); a.lng = +(2.4 + Math.cos(i * 1.7) * 0.026).toFixed(5);
      return a;
    }
    var players = CAST.map(function (name, i) {
      var y = years[i % 4];
      var hm = home(i);
      return { id: uid(), name: name, address: hm.address, lat: hm.lat, lng: hm.lng, year: y, dept: depts[(i >> 1) % 2], td: 'TD' + (1 + (i % 3)), tp: y === '5A' ? '' : 'TP' + (1 + (i % 5)),
        option: '', lang_group: 'G' + (1 + (i % 6)), notes: '', weapons: '', points: 0,
        is_ally: i === 7 || i === 8 || i === 10 || i === 12, photo_path: null };
    });
    var easy = WEAPONS.filter(function (w) { return w[1] === 'facile'; }), hard = WEAPONS.filter(function (w) { return w[1] === 'difficile'; });
    players.forEach(function (p, i) { if (i % 3 !== 1) p.weapons = easy[(i * 7) % easy.length][0] + ', ' + hard[(i * 5) % hard.length][0]; });

    var r0 = { id: uid(), name: 'Boucle initiale', position: 0 }, r1 = { id: uid(), name: 'Reroll 1', position: 1 };
    var links = [], kills = [], P = players, conf = ['sur', 'sur', 'probable', 'sur', 'rumeur'];
    function L(round, a, b, c) { links.push({ id: uid(), round_id: round.id, hunter_id: P[a].id, target_id: P[b].id, confidence: c || 'sur', source: '' }); }
    function X(round, a, b, weapon, pts, daysAgo) {
      kills.push({ id: uid(), round_id: round.id, killer_id: a == null ? null : P[a].id, victim_id: P[b].id, weapon: weapon, points: pts, note: '',
        happened_at: new Date(Date.now() - daysAgo * 864e5).toISOString() });
      if (a != null) P[a].points += pts;
    }
    // Boucle initiale : trois fragments connus
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]].forEach(function (e, i) { L(r0, e[0], e[1], conf[i % 5]); });
    [[14, 15], [15, 16], [16, 17], [17, 18]].forEach(function (e) { L(r0, e[0], e[1]); });
    [[25, 26], [26, 27]].forEach(function (e) { L(r0, e[0], e[1], 'probable'); });
    X(r0, 0, 1, 'Banane', 6, 12); X(r0, 0, 2, 'Arrosoir', 3, 11); X(r0, 14, 15, 'Lacet', 1, 11); X(r0, null, 30, '', 0, 10);
    X(r0, 5, 6, 'Chaise', 4, 9); X(r0, 25, 26, 'Briquet', 1, 9); X(r0, null, 33, '', 0, 8); X(r0, 16, 17, 'Cravate', 1, 8);
    // Reroll 1 : la boucle actuelle
    [[7, 20], [20, 8], [8, 0], [0, 22]].forEach(function (e) { L(r1, e[0], e[1]); });
    [[10, 35], [35, 12], [12, 28]].forEach(function (e, i) { L(r1, e[0], e[1], i === 2 ? 'rumeur' : 'sur'); });
    [[38, 3], [3, 10]].forEach(function (e) { L(r1, e[0], e[1], 'probable'); });
    [[40, 41], [41, 24]].forEach(function (e) { L(r1, e[0], e[1]); });
    X(r1, 7, 20, 'Écocup', 2, 3); X(r1, 40, 41, 'Tronçonneuse', 5, 2); X(r1, null, 19, '', 0, 1);

    var now = Date.now();
    var events = ['LUPIN Arsène a éliminé LANTIER Étienne (Écocup)', 'Lien ajouté : BERGERAC Cyrano chasse POQUELIN Agnès', 'Nouvelle boucle : Reroll 1']
      .map(function (t, i) { return { id: uid(), text: t, actor: 'démo', created_at: new Date(now - (i + 1) * 36e5 * 7).toISOString() }; });

    var settings = JSON.parse(JSON.stringify(K.seed.settings));
    settings.game_name = 'Killer (démo)'; settings.official_players = 48;
    return { players: players, rounds: [r0, r1], links: links, kills: kills, events: events, settings: settings,
      weapons: WEAPONS.map(function (w) { return { id: uid(), name: w[0], difficulty: w[1] }; }), members: [] };
  };
})();
