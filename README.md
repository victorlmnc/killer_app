# QG Killer

Application web permettant de suivre une partie de "Killer" en tant que joueur : un dashboard, la chaîne qui se met à jour toute seule, les fiches joueurs, une carte intéractive, les armes, le shop, les classes. Pensé pour fonctionner sur le téléphone et partagé en temps réel.

Site 100 % statique (HTML, CSS, JS sans étape de build) + Supabase pour la base, le login et les images.

## Premier lancement - Comment utiliser l'application ?
**Étape 1 :** Créer un compte sur le site avec l'adresse admin enregistré sur supabase, confirmer l'e-mail, se connecter.  
**Étape 2 :** **Paramètres > L'équipe** : ajouter les adresses et les noms des coéquipiers de ton alliance. Ils créent ensuite leur compte eux-mêmes. Il n'y a qu'un niveau d'accès : chaque membre peut tout faire, y compris changer son nom affiché.  
**Étape 3 :** **Armes > Charger la liste** : les 120 armes des années précédentes, triées par difficulté (facile / difficile).  
**Étape 4 :** **Joueurs > Importer** : Possibiltié d'importer une liste de joueurs, il suffit de copier-coller les lignes depuis un Excel (en-têtes compris). Ou ajouter manuellement chaque joueur.  
**Étape 5 :** Ouvrir la fiche de chaque membre de l'alliance et toucher « Membre de l'alliance ». Sur téléphone : menu du navigateur > « Ajouter à l'écran d'accueil ».

## Comment marche la chaîne ?

On ne saisit que des faits : **« X chasse Y »** (avec une fiabilité : sûr, probable, rumeur) et **« Y est mort, tué par X »**. Tout le reste est calculé :

- La **chaîne actuelle** est déduite de la chaîne complète en sautant les morts, puisque le contrat d'un mort revient à son killer.
- Enregistrer un kill donne les points au killer, lui transmet les armes de la victime et affiche sa nouvelle cible.
  Si on ne savait pas que X chassait Y, le kill complète la chaîne.
- Un **reroll** archive la boucle telle qu'elle était (vivants et morts de l'époque) et en ouvre une nouvelle.

- Sur la page **Chaîne**, tout se fait au glisser-déposer (souris, ou appui long sur téléphone). Une bulle déposée à droite d'un joueur devient sa cible, à gauche son chasseur, entre deux joueurs elle s'insère. « Avec la suite » (ou la touche Maj) emmène tout le bout de chaîne, la poignée ⠿ le fragment entier, le bac en bas sort un joueur de la chaîne. La chaîne se comporte comme une liste : retirer un joueur referme le trou. Les nouveaux liens sont « sûrs » par défaut.
- Cliquer une **flèche** (ou l'étiquette Sûr / Probable / Rumeur d'une fiche) règle la fiabilité et la source, ou coupe le lien.
  La source s'affiche au survol.
- Sur une fiche d'un joueur, les zones « Sa cible » et « Son killer » sont des menus déroulants qui ne proposent que les joueurs encore libres.
- Le dashboard montre qui chasse chaque membre de l'alliance, et le shop qui a assez de points pour un coupe-gorge.

## Ce qui entre dans la base de donnée

La base de donnée contient les **inscrits au jeu**. Les images sont recadrées et recompressées dans le navigateur avant envoi (les métadonnées EXIF, dont le GPS, disparaissent), stockées dans un bucket privé et affichées via des liens signés d'une heure.

A faire à la fin d'une partie : **Paramètres > Données > Télécharger une sauvegarde** si on souhaite garder une copie de l'ensemble des données de la partie (format json) puis **Paramètres > Fin de partie > Effacer la partie** supprime fiches, images, chaînes, kills et journal pour tout le monde. Le catalogue d'armes, le shop et les réglages restent pour la prochaine partie,l'année suivante.

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
js/store.js           données : adaptateur Supabase + adaptateur local, temps réel, images
js/ui.js              petits helpers d'interface (dialogues, toasts, avatars)
js/geo.js             géocodage des adresses, chargement de Leaflet
js/actions.js         lier, kill, reroll, fiche joueur, import
js/views/*.js         une vue par onglet
supabase/schema.sql   tables, RLS, bucket photos, temps réel
tools/build_bus.py    GTFS AggloBus -> data/bus.js (calque des lignes de bus)
tests/logic.test.js   node tests/logic.test.js
```

Le prix des bonus, le barème, les années, les couleurs et les départements se modifient dans l'app, pas dans le code.
