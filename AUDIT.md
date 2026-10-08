# Audit de QG Killer — octobre 2026

Audit en lecture seule. Aucune requête n'a été envoyée à la base de production.
Preuves : lecture du code ; calculs jetables en mémoire (`node -e`, avec `js/logic.js`) pour BUG-01, BUG-02, BUG-05 et SEC-09.
Les tests existants passaient au dernier lancement : 40 tests unitaires, 4 suites Playwright.

## 1. Résumé

La base est saine. Toutes les tables ont la RLS. Un compte doit avoir un email confirmé et figurer dans `accounts`. Tout l'affichage passe par des nœuds texte (pas de XSS trouvé). Les photos sont privées, avec des URLs signées. Le relais iCal vérifie l'appartenance à l'équipe.

Les faiblesses sont surtout de deux ordres :
- des contrôles « administrateur » appliqués seulement dans l'interface ;
- une gestion d'erreurs qui masque les échecs d'écriture, ce qui fait diverger les points et l'état affiché.

**Les 3 problèmes les plus urgents :**
1. **SEC-01** (à vérifier dans la console Supabase). Si la confirmation d'email est désactivée, n'importe qui peut créer un compte avec l'adresse d'un coéquipier autorisé qui ne s'est pas encore inscrit, et obtenir son rôle.
2. **SEC-02.** Vider la partie, restaurer une sauvegarde ou vider le journal sont réservés à l'admin dans l'interface, mais la RLS autorise tout membre à faire les mêmes suppressions via l'API. Une session de membre volée ou malveillante peut tout effacer, journal compris.
3. **BUG-03.** Les erreurs d'écriture sont avalées (`guard`). Si l'écriture d'un kill échoue (conflit, coupure réseau), les points du killer peuvent quand même être ajoutés. Hors ligne, des changements non enregistrés restent affichés et partent dans la copie hors ligne.

## 2. Tableau récapitulatif

| ID | Titre | Catégorie | Sévérité | Fichier | Effort |
|---|---|---|---|---|---|
| SEC-01 | Prise de rôle si la confirmation d'email est désactivée | Sécurité / Auth | 🔴 (à vérifier) | supabase/schema.sql:40 | S |
| SEC-02 | Actions « admin » (vider, restaurer, vider le journal) non protégées côté serveur | Sécurité / RLS | 🟠 | supabase/schema.sql:230 | M |
| SEC-03 | supabase-js chargé depuis un CDN sans version figée ni SRI, et sans CSP | Sécurité / Supply chain | 🟠 | js/store.js:468, js/geo.js:10, index.html | S |
| SEC-04 | « Fin de partie » laisse 14 jours de sauvegardes et les copies hors ligne | Données perso | 🟡 | js/store.js:320, schema.sql:275 | M |
| SEC-05 | Se déconnecter hors ligne rouvre aussitôt la copie hors ligne | Données perso | 🟡 (probable) | js/store.js:477 | S |
| SEC-06 | Compte retiré de l'équipe : garde son rôle en session et sa copie hors ligne | Auth | 🔵 | js/store.js:105, js/app.js:56 | S |
| SEC-07 | Journal falsifiable : `actor` / `author` fournis par le client, journal supprimable par tout membre | Sécurité / Traçabilité | 🔵 | js/store.js:166, schema.sql:230 | M |
| SEC-08 | Sauvegarde JSON piégée : réglages acceptés tels quels (`geocoder_url`, clé `__proto__`) | Imports | 🔵 | js/logic.js:579, js/store.js:43 | S |
| SEC-09 | Export CSV : injection de formules (`=`, `+`, `-`, `@`) | Exports | 🔵 | js/logic.js:503 | S |
| SEC-10 | Relais `edt` : pas de timeout, taille lue avant contrôle, port libre, redirection suivie avant contrôle | Edge function | 🔵 | supabase/functions/edt/index.ts:38-45 | S |
| SEC-11 | Fonctions SQL sans `search_path` fixé (`is_member`, `can_edit`, `is_admin`, `protect_account`) | Sécurité SQL | 🔵 | supabase/schema.sql:46-48, 250 | S |
| SEC-12 | Email de l'admin dans d'anciens commits publics (connu, choix assumé) | Dépôt | 🔵 info | historique git | — |
| BUG-01 | Fusion d'un joueur mystère vers « Quelqu'un d'autre… » : conflit de liens, informations perdues | Chaîne | 🟡 | js/logic.js:682, js/actions.js:1107 | S |
| BUG-02 | Bonus « N heures » faux d'1 h lors du changement d'heure | Dates | 🟡 | js/logic.js:887 | S |
| BUG-03 | Erreurs d'écriture avalées : points sans kill, état local faux après une coupure | Synchronisation | 🟠 | js/store.js:109, js/actions.js:267 | M |
| BUG-04 | Points en lecture-modification-écriture : mises à jour perdues entre coéquipiers | Synchronisation | 🟡 | js/actions.js:269 (et tous les `points: p.points + …`) | M |
| BUG-05 | Supprimer un reroll vide les armes des fiches créées pendant ce reroll | Rerolls | 🔵 | js/logic.js:606 | S |
| BUG-06 | Remplacement de lien non atomique (suppression puis insertion) | Chaîne | 🔵 | js/actions.js:17 | M |
| BUG-07 | Mode démo : supprimer un joueur laisse ses infos et bonus orphelins | Données locales | 🔵 | js/store.js:139 | S |
| UX-01 | Suppression d'une arme ou d'un lieu sans confirmation | UX | 🔵 | js/views/lists.js:117, js/views/map.js:138 | S |
| UX-02 | Choisir « Killer/Cible inconnu(e) » supprime un lien sans confirmation ni journal | UX | 🔵 | js/actions.js:743 | S |
| UX-03 | Données de démo en anglais dans l'interface française | UX | 🔵 | js/seed.js | S |
| QUAL-01 | `actions.js` de 1 456 lignes ; re-rendu complet à chaque changement | Maintenabilité / Perf | 🔵 | js/actions.js, js/app.js | L |
| QUAL-02 | Zones sans tests : RLS (SQL), relais `edt`, chemin Supabase de `restore` / `purge` | Tests | 🔵 | tests/ | M |

## 3. Détail des problèmes

### SEC-01 — Prise de rôle si la confirmation d'email est désactivée 🔴 (à vérifier)
- **Emplacement :** `supabase/schema.sql:40-45` (`my_role` exige `email_confirmed_at is not null`), `js/store.js:426` (`signUp` ouvert à tous).
- **Description :** tout repose sur la confirmation de l'email. Quand l'option « Confirm email » est désactivée dans Supabase (Authentication > Providers > Email), Supabase remplit `email_confirmed_at` dès l'inscription.
- **Impact :** quelqu'un qui connaît l'adresse d'un coéquipier autorisé mais pas encore inscrit (format prenom.nom@insa-cvl.fr facile à deviner) crée le compte et lit toute la partie avec ce rôle. Si l'adresse est celle d'un membre, il peut aussi écrire.
- **Reproduction (sur un projet de test, jamais en production) :** désactiver la confirmation, ajouter `x@test.fr` dans `accounts`, s'inscrire avec `x@test.fr` → `my_role()` renvoie le rôle.
- **Correctif :**
  - vérifier que « Confirm email » est activé ;
  - en complément, n'accepter que les comptes créés après leur ajout à l'équipe : `where u.created_at >= a.created_at`, ou mieux, un lien « invitation » de l'admin ;
  - désactiver les inscriptions publiques et inviter depuis le tableau de bord Supabase.
- **Confiance :** à vérifier (dépend de la configuration du projet, pas visible dans le dépôt).

### SEC-02 — Actions « admin » non protégées côté serveur 🟠
- **Emplacement :** `supabase/schema.sql:225-232`. La policy `write` (`for all … using (can_edit())`) s'applique à toutes les tables de jeu, y compris `events`. Côté client, `store.purge` (`js/store.js:320`), `store.restore`, `store.clearEvents` et `act.saveScoring` testent seulement `isAdmin()`.
- **Impact :** un membre, ou quelqu'un qui a volé sa session sur un téléphone partagé, peut via l'API :
  - supprimer tous les joueurs, liens et kills, comme « Fin de partie » ;
  - vider le journal pour effacer ses traces ;
  - modifier les points de n'importe qui.

  Les sauvegardes de nuit limitent la perte, mais pas l'effacement des traces.
- **Preuve :** lecture des policies. La seule restriction admin côté serveur concerne `settings`, `accounts` et `game_backups`.
- **Correctif :**
  - `events` en ajout seul pour les membres : policy `insert` avec `can_edit()`, et `update`/`delete` avec `is_admin()` ;
  - interdire aux membres le `delete` en masse : policies `delete` séparées, limitées à `is_admin()` pour `rounds`, et éventuellement `players` ;
  - déplacer « vider la partie » et « restaurer » dans des fonctions `security definer` réservées aux admins.
- **Confiance :** confirmé.

### SEC-03 — Scripts CDN sans version figée ni SRI, sans CSP 🟠
- **Emplacement :**
  - `js/store.js:468` charge `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` : version flottante, sans `integrity` ;
  - `js/geo.js:10` charge Leaflet depuis cdnjs, version figée mais sans SRI ;
  - `index.html` n'a aucune CSP.
- **Impact :** une version compromise de supabase-js, ou un CDN compromis, s'exécute avec la session de l'utilisateur. Il peut lire et exfiltrer toute la base (cibles, adresses, photos). La version flottante change aussi sans prévenir.
- **Correctif :**
  - figer la version (`@supabase/supabase-js@2.x.y/dist/umd/supabase.min.js`) et ajouter `integrity` + `crossorigin` (SRI aussi pour Leaflet) ;
  - mieux encore, copier ces fichiers dans le dépôt ;
  - ajouter une CSP en `<meta>`, du type `default-src 'self'; script-src 'self' cdn.jsdelivr.net cdnjs.cloudflare.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://data.geopf.fr; img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline' fonts.googleapis.com cdnjs.cloudflare.com; font-src fonts.gstatic.com`. Le style inline est utilisé par `h()`.
- **Confiance :** confirmé.

### SEC-04 — « Fin de partie » incomplète 🟡
- **Emplacement :** `js/store.js:320-336`, `supabase/schema.sql:275-296`.
- **Description :** la purge supprime les tables de jeu et les photos des joueurs. Elle laisse :
  - `game_backups` : jusqu'à 14 jours de sauvegardes complètes (noms, adresses, notes, chemins de photos) ;
  - les avatars ;
  - les liens iCal dans `settings` ;
  - la copie hors ligne `killer.cache.v1` des autres appareils, tant qu'ils ne se reconnectent pas.
- **Impact :** des données personnelles d'étudiants restent conservées après la fin annoncée du jeu.
- **Correctif :**
  - une fonction `purge_backups()` admin, appelée par « Fin de partie » ;
  - proposer de supprimer les avatars ;
  - dire clairement dans la confirmation ce qui reste.
- **Confiance :** confirmé.

### SEC-05 — Déconnexion hors ligne qui rouvre la copie 🟡 (probable)
- **Emplacement :** `js/store.js:475-478`. Sur l'événement `SIGNED_OUT`, si `!navigator.onLine`, la copie hors ligne est rouverte au lieu d'être effacée par `dropCache()`.
- **Impact :** sur un téléphone partagé, « Se déconnecter » sans réseau laisse toutes les données visibles.
- **Correctif :** distinguer une déconnexion volontaire (drapeau posé par `store.auth.signOut`, qui appelle `dropCache()`) d'une session expirée hors ligne.
- **Confiance :** probable (dépend du comportement de `signOut` hors ligne dans supabase-js, à tester en mode avion).

### SEC-06 — Compte retiré pendant qu'il est connecté 🔵
- **Emplacement :** `js/store.js:105` (`refreshRole` ne change rien si le compte n'est plus listé), `js/app.js:56` (`notMember` n'appelle pas `dropCache`).
- **Impact :**
  - la personne retirée garde l'interface et les données déjà chargées jusqu'au rechargement (ses écritures échouent côté serveur) ;
  - elle garde la copie hors ligne sur son appareil, que l'app rouvrira hors ligne.
- **Correctif :** dans `refreshRole`, si `me` est introuvable, passer `role = null` et revenir à l'écran « pas dans l'équipe » ; appeler `dropCache()` dans `notMember`.
- **Confiance :** confirmé (lecture).

### SEC-07 — Journal falsifiable 🔵
- **Emplacement :** `js/store.js:166-169`. `actor` vient de `displayName()` côté client, comme `intel.author`. La RLS ne lie pas ces champs au compte connecté.
- **Impact :** un membre peut écrire « Arsène » comme auteur d'une info, ou supprimer des entrées du journal (voir SEC-02).
- **Correctif :** colonne `actor_email` remplie par un trigger (`auth.email()`), et journal en ajout seul.
- **Confiance :** confirmé.

### SEC-08 — Sauvegarde JSON piégée 🔵
- **Emplacement :** `js/logic.js:579` (`data.settings = raw.settings` sans filtrage), `js/store.js:43` (`withDefaults` copie toutes les clés, y compris `__proto__`).
- **Impact :** un admin qui importe un fichier reçu de l'extérieur avec « catalogue et réglages » peut :
  - envoyer toutes les adresses géocodées à un serveur tiers (`geocoder_url`) ;
  - modifier le prototype de l'objet `settings`.

  Les liens utiles passent bien par `safeUrl`.
- **Correctif :** liste blanche des clés de réglages à la lecture, suppression de `__proto__` / `constructor`, et affichage de `geocoder_url` dans l'aperçu de l'import.
- **Confiance :** confirmé (lecture). L'impact réel suppose qu'un admin importe un fichier piégé.

### SEC-09 — Injection de formules dans l'export CSV 🔵
- **Emplacement :** `js/logic.js:503` (`csvCell`).
- **Preuve :** `L.toCsv(['Name'], [['=HYPERLINK("http://evil","x")'], ['+1+1'], ['@SUM(A1)']])` sort les cellules telles quelles.
- **Impact :** un nom ou une note qui commence par `=` (par exemple un CSV de l'école importé) s'exécute comme formule dans Excel ou LibreOffice à l'ouverture.
- **Correctif :** préfixer d'une apostrophe toute cellule qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot.
- **Confiance :** confirmé.

### SEC-10 — Robustesse du relais `edt` 🔵
- **Emplacement :** `supabase/functions/edt/index.ts:38-45`.
- **Ce qui est déjà correct :** la vérification d'appartenance (`my_role`), `https` obligatoire et la liste d'hôtes, qui résiste aux `@`, aux sous-domaines et aux IP.
- **Les points faibles :**
  - `redirect: "follow"` : la requête vers la cible de redirection part avant le contrôle d'hôte (SSRF « aveugle » limitée à ce que le serveur de l'école redirige) ;
  - le port n'est pas restreint (`https://edt.insa-cvl.fr:8443/` est accepté) ;
  - `res.text()` lit tout le corps avant le contrôle de taille ;
  - pas de timeout.
- **Correctif :** `redirect: "manual"`, puis suivre au plus 3 redirections en revérifiant chaque hôte ; refuser `target.port` non vide ; lire le flux avec un plafond ; `AbortSignal.timeout(10000)`.
- **Confiance :** confirmé (lecture). L'impact est faible.

### SEC-11 — `search_path` non fixé 🔵
- **Emplacement :** `supabase/schema.sql:46-48` (`is_member`, `can_edit`, `is_admin`), `:250` (`protect_account`). Les fonctions sensibles (`my_role`, `take_backup`) sont correctes.
- **Correctif :** ajouter `set search_path = public` (le linter Supabase le signale).
- **Confiance :** confirmé, risque faible.

### SEC-12 — Email dans l'historique git 🔵 (information)
- L'email de l'admin apparaît dans d'anciennes versions de `schema.sql` et comme auteur de 36 commits.
- Choix assumé : on ne réécrit pas l'historique. Aucune clé `service_role` ni aucun lien iCal privé trouvés dans l'historique.

### BUG-01 — Fusion d'un joueur mystère : conflit de liens 🟡
- **Emplacement :** `js/logic.js:682` (`mysteryMerge` ne déduplique que les liens identiques), `js/actions.js:1107` (« Quelqu'un d'autre… » contourne le filtre des candidats).
- **Preuve :** mystère `m→x`, fusion vers `b` qui chasse déjà `y` → liens résultants `b→x, b→y`, soit deux cibles pour un même chasseur dans la boucle.
- **Impact :** en base, la contrainte `unique (round_id, hunter_id)` fait échouer la mise à jour. `guard` avale l'erreur, puis la fiche mystère est supprimée : son lien disparaît en cascade et l'information est perdue. En mode démo, on obtient une chaîne incohérente.
- **Correctif :** dans `mysteryMerge`, détecter les conflits de chasseur ou de cible et les montrer dans la confirmation (« B chasse déjà Y : garder lequel ? »). Ne supprimer la fiche mystère que si toutes les mises à jour ont réussi.
- **Confiance :** confirmé.

### BUG-02 — Bonus faux d'1 h au changement d'heure 🟡
- **Emplacement :** `js/logic.js:887-891`. La fin est calculée par `starts + heures × 3600 s`, en heures réelles.
- **Preuve :** un bonus de 24 h « à partir de 00:10 le lendemain », acheté le 24/10/2026, se termine le 25/10 à 23:10 au lieu du 26/10 à 00:10.
- **Impact :** une immunité affichée comme terminée 1 h trop tôt peut pousser un allié à tuer une cible encore immunisée (kill invalide). À l'heure d'été, c'est l'inverse : l'immunité dure 1 h de trop.
- **Correctif :** pour les durées multiples de 24 h, calculer la fin en heure de Paris : `parisDate(p.y, p.m, p.d + jours, p.hh, p.mi)`.
- **Confiance :** confirmé.

### BUG-03 — Erreurs d'écriture avalées 🟠
- **Emplacement :** `js/store.js:109-116` (`guard` affiche un toast puis résout la promesse), `js/store.js:118-124` (`insert` renvoie la ligne même en cas d'échec), `js/actions.js:267-272` (le kill et les points du killer sont écrits en parallèle).
- **Impact :**
  1. Deux coéquipiers enregistrent la mort du même joueur : le second kill est refusé (`victim_id unique`), mais les points du second killer sont quand même ajoutés.
  2. Si le réseau coupe en pleine session, l'écriture échoue et le rechargement (`loadAll`) échoue aussi. Le changement reste affiché comme enregistré, et `saveCache` l'écrit dans la copie hors ligne.
  3. Les enchaînements (`recordKill`, `mergeMystery`, `deleteRound`) continuent après un échec partiel.
- **Correctif :**
  - `guard` doit rejeter la promesse après le toast ;
  - les actions à plusieurs étapes doivent écrire le kill d'abord, puis les points, et s'arrêter en cas d'erreur ;
  - en cas d'échec réseau, annuler l'état optimiste (garder une copie) et passer en mode « hors ligne » ;
  - à terme, une fonction SQL `record_kill(...)` transactionnelle.
- **Confiance :** confirmé (lecture). Le scénario 1 est probable en usage réel.

### BUG-04 — Mises à jour de points perdues 🟡
- **Emplacement :** tous les `store.update('players', id, { points: (p.points || 0) + … })` : `js/actions.js:269` (kill), annulation de kill, `editKill`, `applySettle`, `saveScoring`, achats en boutique.
- **Impact :** deux écritures quasi simultanées sur le même joueur partent de la même valeur, et la dernière écrase l'autre.
- **Correctif :** une fonction SQL `add_points(player_id, delta)` qui fait `update … set points = points + delta`, ou des points calculés à partir des kills et achats plutôt que stockés.
- **Confiance :** probable (raisonnement).

### BUG-05 — Supprimer un reroll vide les armes des fiches créées pendant ce reroll 🔵
- **Emplacement :** `js/logic.js:606`. `undoRoundPlan` remplace les armes de tout le monde par l'historique, `|| ''` pour les absents.
- **Preuve :** le joueur `n`, créé pendant le reroll avec « Lacet », obtient `{"weapons": ""}`.
- **Correctif :** ne restaurer que les joueurs qui existaient au moment du reroll (`p.created_at < round.created_at`), ou ceux présents dans `held_weapons`, en plus de ceux qui n'avaient pas d'arme mais existaient déjà.
- **Confiance :** confirmé.

### BUG-06 — Remplacement de lien non atomique 🔵
- **Emplacement :** `js/actions.js:17-20` (`applyPlan` : suppressions puis insertions séparées).
- **Impact :** avec deux modifications concurrentes, l'ancien lien est supprimé, le nouveau est refusé par la contrainte d'unicité, et l'information est perdue.
- **Correctif :** une fonction SQL `set_target(round, hunter, target, …)` dans une transaction.
- **Confiance :** probable.

### BUG-07 — Mode démo : orphelins après suppression d'un joueur 🔵
- **Emplacement :** `js/store.js:139-146`. La cascade locale ne traite que `links` et `kills`, pas `intel`, `bonuses` ni `accounts.player_id`. En base, les clés étrangères s'en chargent.
- **Correctif :** ajouter ces tables dans la cascade locale.
- **Confiance :** confirmé (lecture).

### UX-01 — Suppression sans confirmation 🔵
- **Emplacement :** `js/views/lists.js:117` (arme du catalogue), `js/views/map.js:138` (lieu stratégique).
- **Correctif :** `ui.confirm` comme ailleurs.

### UX-02 — Choisir « Killer/Cible inconnu(e) » supprime un lien sans prévenir 🔵
- **Emplacement :** `js/actions.js:743`. Le lien est supprimé sans confirmation ni entrée dans le journal, contrairement à la suppression depuis la fenêtre du lien (`:73`).
- **Correctif :** même confirmation et même entrée de journal que `:73`.

### UX-03 — Démo en anglais 🔵
- **Emplacement :** `js/seed.js` : notes, lieux et intel de démo (« Busy between 12:00 and 13:00 », « Canteen »…) dans une interface en français.
- **Correctif :** textes de démo en français.

### QUAL-01 — Taille et re-rendus 🔵
- `js/actions.js` fait 1 456 lignes et mélange chaîne, kills, fiche, partage, mystères, import et sauvegarde.
- Chaque `store.emit()` reconstruit toute la vue (`js/app.js`, abonnement `store.on`). Chaque événement temps réel recharge la table entière (`js/store.js:95-103`).
- `act.isDead` recalcule `deadSet` pour chaque joueur dans les filtres, en O(joueurs × kills). Ça reste acceptable pour environ 400 joueurs.
- **Correctif :**
  - découper `actions.js` par domaine : `kills.js`, `sheet.js`, `homes.js`, `backup.js` ;
  - calculer `deadSet` une fois par rendu ;
  - appliquer les `payload.new/old` du temps réel au lieu de recharger la table.

### QUAL-02 — Zones sans tests 🔵
- Pas de test des policies RLS. On pourrait jouer le schéma dans un Postgres local, puis faire `set role authenticated` avec différents emails.
- Pas de test du relais `edt`.
- `restore` et `purge` en mode Supabase ne sont testés que par un script hors dépôt.

## 4. Points positifs (à ne pas casser)

- **Rendu :** `h()` (`js/ui.js:8`) n'insère que des nœuds texte. Les seuls `innerHTML` sont des SVG statiques. Les couleurs passent par `hex()` et les URLs par `ui.safeUrl` avant tout `href`.
- **RLS :** activée sur toutes les tables. `my_role()` est `security definer`, avec `search_path` fixé, retirée à `anon`, et exige un email confirmé. Les observateurs ne peuvent rien écrire. Le trigger `protect_account` empêche un membre de changer son rôle ou ses onglets.
- **Photos :** bucket privé (1 Mo, JPEG/GIF), URLs signées d'1 h, recadrage par canvas qui supprime les métadonnées EXIF (GPS).
- **Relais `edt` :** appartenance vérifiée, `https` et liste d'hôtes stricte.
- **Import de sauvegarde :** colonnes en liste blanche, ids remappés, références orphelines retirées, valeurs énumérées validées.
- **Géocodeur :** n'envoie que l'adresse (jamais le nom), avec `no-referrer`.
- **Mode hors ligne :** réellement en lecture seule (`canEdit()` faux).
- **Rôles :** les permissions sont centralisées dans `store.insert/update/remove`.
- **Sauvegardes :** sauvegardes de nuit, et 40 tests unitaires + 4 suites Playwright qui couvrent les parcours principaux.

## 5. Plan de correction recommandé

1. **Configuration Supabase (sans code) :** vérifier SEC-01 (confirmation d'email, inscriptions).
2. **Lot « serveur », un seul passage du schéma :**
   - SEC-02 et SEC-07 : journal en ajout seul, suppressions en masse et restauration réservées aux admins via des fonctions `security definer` ;
   - SEC-11 : `search_path` ;
   - SEC-04 : purge des sauvegardes ;
   - préparer `add_points` et `record_kill` pour BUG-03 et BUG-04.
3. **Lot « intégrité des écritures » :** BUG-03 (`guard` qui rejette, ordre des écritures, retour arrière de l'état optimiste), puis BUG-04 et BUG-06 avec les fonctions SQL du lot 2.
4. **Lot « chargement » :** SEC-03 (versions figées, SRI, CSP).
5. **Lot « session et appareil » :** SEC-05, SEC-06.
6. **Petits correctifs isolés :** BUG-02 (heure d'été), BUG-01 (conflits de fusion), BUG-05, BUG-07, SEC-08, SEC-09, SEC-10.
7. **UX :** UX-01, UX-02, UX-03.
8. **Qualité :** QUAL-02 (tests RLS et `edt`) avant QUAL-01 (découpage), pour ne rien casser pendant le découpage.
