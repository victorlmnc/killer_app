# QG Killer

Le tableur de l'alliance, en version web : un dashboard, la chaîne qui se met à jour toute seule,
les fiches joueurs avec photo, la carte des adresses, les armes, le shop, les classes. Pensé pour le téléphone, partagé en temps réel.

Site 100 % statique (HTML, CSS, JS sans étape de build) + Supabase pour la base, le login et les photos.

## Essayer tout de suite

Ouvre `index.html` dans un navigateur. Tant que `js/config.js` est vide, l'app tourne en **mode démo** :
une partie fictive (personnages de romans), stockée uniquement dans ton navigateur.

## Mise en ligne, 15 minutes

### 1. Supabase
1. Crée un projet (région Europe).
2. **SQL Editor > New query** : colle `supabase/schema.sql`, **remplace l'adresse e-mail du premier admin** en haut du fichier, puis Run.
3. **Authentication > Sign In / Providers > Email** : laisse **Confirm email activé**. C'est lui qui empêche
   quelqu'un de créer un compte avec l'adresse d'un membre.
4. **Authentication > URL Configuration** : mets l'adresse du site (étape 3) dans *Site URL* et *Redirect URLs*.
5. **Project Settings > API** : copie *Project URL* et la clé *anon public* dans `js/config.js`.

La clé `anon` est publique par nature, ce sont les règles RLS du schéma qui protègent les données :
sans compte confirmé **et** présent dans la liste d'accès, on ne lit rien. Ne mets jamais la clé `service_role` dans le dépôt.

### 2. GitHub
Pousse ce dossier à la racine du dépôt. Le `.gitignore` bloque les Excel, CSV et sauvegardes : aucune donnée
de la partie ne doit être commitée, tout vit dans Supabase.

### 3. GitHub Pages
**Settings > Pages > Deploy from a branch > main / (root)**. Le site arrive sur `https://<pseudo>.github.io/<depot>/`.
Pages sur un dépôt privé demande GitHub Pro (gratuit avec le Student Developer Pack). Un dépôt public convient
aussi : le code ne contient aucune donnée. Netlify, Vercel ou Cloudflare Pages marchent pareil, sans configuration.

### 4. Premier lancement
1. Crée ton compte sur le site avec l'adresse admin, confirme l'e-mail, connecte-toi.
2. **Paramètres > Qui a accès** : ajoute les adresses de tes coéquipiers. Ils créent ensuite leur compte eux-mêmes.
3. **Armes > Charger la liste** : les 120 armes des années précédentes, triées facile / difficile.
4. **Joueurs > Importer** : copie-colle les lignes depuis Excel (en-têtes compris).
5. Ouvre la fiche de chaque membre de l'alliance et touche « Membre de l'alliance ».
6. Sur téléphone : menu du navigateur > « Ajouter à l'écran d'accueil ».

## Comment marche la chaîne

On ne saisit que des faits : **« X chasse Y »** (avec une fiabilité : sûr, probable, rumeur) et **« Y est mort, tué par X »**.
Tout le reste est calculé :

- La **chaîne actuelle** est déduite de la chaîne complète en sautant les morts, puisque le contrat d'un mort revient à son killer.
  Plus besoin de tenir deux feuilles à la main.
- Enregistrer un kill donne les points au killer, lui transmet les armes de la victime et affiche sa nouvelle cible.
  Si on ne savait pas que X chassait Y, le kill complète la chaîne.
- Un **reroll** archive la boucle telle qu'elle était (vivants et morts de l'époque) et en ouvre une nouvelle.
- Un lien qui en contredit un autre demande confirmation avant de le remplacer.
- Le dashboard montre qui chasse chaque membre de l'alliance, et le shop qui a assez de points pour un coupe-gorge.

## Ce qui entre dans la base

La base contient les **inscrits au jeu**, pas l'annuaire de l'école : l'import ignore les lignes dont la colonne
« Joue au Killer ? » n'est pas à OUI.
Les photos sont recadrées et recompressées dans le navigateur avant envoi (les métadonnées EXIF, dont le GPS, disparaissent),
stockées dans un bucket privé et affichées via des liens signés d'une heure.

**Paramètres > Fin de partie > Effacer la partie** supprime fiches, photos, chaînes, kills et journal pour tout le monde.
À faire le jour où le jeu se termine ; le catalogue d'armes, le shop et les réglages restent pour l'année suivante.

## La carte

L'onglet **Map** affiche un point par joueur qui a une adresse ; les joueurs sans adresse n'y figurent pas, et ceux qui
partagent une résidence sont regroupés sous un même point (le chiffre indique combien). Toucher un point donne le nom,
l'adresse et un bouton vers la fiche. Filtres : tous, vivants, cibles de l'alliance, killers de l'alliance.

- **Calques**, comme sur uMap : adresses normales, colocs, immeubles, résidences étudiantes, lieux stratégiques. Chacun a son
  pictogramme et s'affiche ou se masque d'un toucher ; le choix est retenu sur l'appareil. Le type de logement se règle sur la
  fiche du joueur (ou via une colonne « Type » à l'import) ; une adresse contenant « résidence » est classée toute seule.
- **Lieux stratégiques** : des endroits, pas des personnes (RU, salle de sport, arrêt de bus…). « Ajouter un lieu stratégique »,
  puis une adresse ou un toucher sur la carte. Ils survivent à l'effacement de fin de partie.
- **Lignes de bus** : lance une fois `python3 tools/build_bus.py` à la racine du dépôt, puis pousse `data/bus.js`. Le script
  télécharge le GTFS officiel AggloBus (transport.data.gouv.fr, licence ODbL) et en tire les tracés, les couleurs officielles
  et les arrêts. Chaque ligne s'affiche ou se masque séparément. À relancer quand le réseau change, en général à la rentrée.
- Quand on saisit ou modifie une adresse sur une fiche, elle est localisée automatiquement. Après un import, le bouton
  « Localiser ces adresses » de l'onglet Map traite tout le lot.
- Une adresse introuvable (résidence sans numéro, faute de frappe) se corrige sur la fiche, ou se place à la main :
  « Placer sur la carte », puis un toucher à l'endroit voulu.
- Le géocodage passe par le service public de la Géoplateforme IGN (`data.geopf.fr`, successeur de l'API Adresse).
  Seul le texte de l'adresse lui est envoyé, jamais le nom du joueur. Le fond de carte vient d'OpenStreetMap, et Leaflet
  est chargé depuis cdnjs à l'ouverture de l'onglet.
- Pour une autre ville, change `map_center` dans `js/seed.js` (centre de la carte et priorité du géocodage).

## Code

```
index.html            point d'entrée
css/app.css           styles, thèmes clair et sombre
js/config.js          URL + clé anon Supabase (vide = mode démo)
js/seed.js            armes, shop, barème, partie fictive de démo
js/logic.js           logique pure : chaîne dérivée, fragments, stats, import
js/store.js           données : adaptateur Supabase + adaptateur local, temps réel, photos
js/ui.js              petits helpers d'interface (dialogues, toasts, avatars)
js/geo.js             géocodage des adresses, chargement de Leaflet
js/actions.js         lier, kill, reroll, fiche joueur, import
js/views/*.js         une vue par onglet
supabase/schema.sql   tables, RLS, bucket photos, temps réel (relançable : il migre une base existante)
tools/build_bus.py    GTFS AggloBus -> data/bus.js (calque des lignes de bus)
tests/logic.test.js   node tests/logic.test.js
```

Le prix des bonus, le barème, les années, les couleurs et les départements se modifient dans l'app, pas dans le code.
