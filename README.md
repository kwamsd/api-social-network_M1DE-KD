# My Social Networks API

TP Api et Web services, M1 Data Engineering et IA.
Kwameh DHEGBO

C'est une API REST qui permet de gérer des utilisateurs, des groupes, des événements, des fils de discussion, des albums photo, des sondages, une billetterie, une shopping list et du covoiturage (le bonus).

## Documentation Postman

- Collection : `postman/My-Social-Networks-API.postman_collection.json`
- Lien public de la doc : **https://documenter.getpostman.com/view/39026092/2sBYHbrbNd**

La collection contient toutes les routes avec l'url, l'explication, le body à envoyer, les données retournées et les codes d'erreur. Chaque requête a un test sur le code de retour et enregistre les ids dans des variables, donc on peut lancer les dossiers dans l'ordre avec le Runner de Postman.

## Installation

Il faut Node.js 22.13 ou plus (j'utilise le module `node:sqlite` qui est intégré à Node, donc pas besoin d'installer une base de données).

```bash
npm install
npm start
```

L'API tourne sur http://localhost:3000 (on peut changer avec la variable `PORT`).
La base est un fichier `data.db` créé tout seul au premier lancement.

## Comment ça marche

Il n'y a pas de connexion avec mot de passe, ce n'était pas demandé. Pour savoir qui fait une action, on envoie l'id de l'utilisateur dans le header `x-user-id`.

Exemple :

```bash
curl -X POST http://localhost:3000/utilisateurs -H "Content-Type: application/json" \
  -d '{"nom":"Dhegbo","prenom":"Kwameh","email":"kwameh@example.com"}'

curl -X POST http://localhost:3000/groupes -H "Content-Type: application/json" \
  -H "x-user-id: 1" -d '{"nom":"Ma promo","type":"public"}'
```

Les listes sont paginées (`page`, `limit`) et on peut trier avec `tri` et `ordre`. Elles renvoient `{ data, page, limit, total, pages }`.

Les erreurs ont toujours la forme `{ "erreur": "message", "details": [...] }`.

| Code | Sens |
|------|------|
| 200 / 201 / 204 | ok / créé / supprimé |
| 400 | données invalides |
| 401 | header `x-user-id` manquant ou inconnu |
| 403 | pas le droit de faire ça |
| 404 | introuvable (ou invisible, comme un groupe secret) |
| 409 | conflit (doublon, plus de places, règle du sujet) |

## Les routes

CRUDS = créer, lire, modifier, supprimer, rechercher.

| Ressource | Routes |
|-----------|--------|
| Utilisateurs | `/utilisateurs` (CRUDS), `/utilisateurs/:id/groupes`, `/utilisateurs/:id/evenements` |
| Groupes | `/groupes` (CRUDS), `/groupes/:id/membres` (liste, ajout, rôle, retrait), `/groupes/:id/rejoindre`, `/groupes/:id/evenements` |
| Événements | `/evenements` (CRUDS), `/evenements/:id/publier`, `/depublier`, `/membres`, `/organisateurs`, `/participants`, `/rejoindre`, `/inviter-groupe`, `/partage`, `/resume` |
| Fils de discussion | `/fils` (CRUDS), `/fils/:id/messages`, `/messages/:id`, `/messages/:id/commentaires`, `/commentaires/:id` |
| Albums photo | `/evenements/:id/albums`, `/albums/:id`, `/albums/:id/photos`, `/photos/:id`, `/photos/:id/commentaires`, `/commentaires-photos/:id` |
| Sondages | `/evenements/:id/sondages`, `/sondages/:id`, `/sondages/:id/questions`, `/sondages/:id/reponses`, `/sondages/:id/resultats` |
| Billetterie | `/evenements/:id/types-billets`, `/types-billets/:id`, `/evenements/:id/billets`, `/billets/:id` |
| Shopping list | `/evenements/:id/shopping`, `/shopping/:id` |
| Covoiturage | `/evenements/:id/covoiturages`, `/covoiturages/:id`, `/covoiturages/:id/reservations` |

Le détail de chaque route (méthode, body, réponse) est dans la doc Postman.

## Les règles que j'ai mises en place

Utilisateurs
- Un email ne peut être utilisé qu'une fois.
- On ne modifie ou supprime que son propre compte.
- Un utilisateur qui est le seul admin d'un groupe ou le seul organisateur d'un événement ne peut pas supprimer son compte.

Groupes
- Types : public, privé, secret. Un groupe secret est invisible pour ceux qui n'en font pas partie.
- Le créateur est administrateur. Un groupe garde toujours au moins un administrateur.
- Les paramètres "les membres peuvent publier" et "les membres peuvent créer des événements" sont respectés.

Événements
- Création en 3 étapes : 1) `POST /evenements` (brouillon), 2) `PATCH /evenements/:id` pour les options, 3) `POST /evenements/:id/publier`.
- Le créateur est organisateur, un événement garde toujours au moins un organisateur.
- Dans un groupe, on peut inviter tous les membres d'un coup (`inviter_groupe` à la création ou `/inviter-groupe`).
- Un événement d'un groupe privé ou secret est forcément privé.
- Le partage vers les réseaux sociaux ne marche que pour un événement public (et un groupe public).
- La date de fin doit être après la date de début.

Fils de discussion
- Un fil est lié à un groupe ou à un événement, pas les deux.
- Dans un groupe, si les membres n'ont pas le droit de publier, seuls les admins écrivent. Tous les membres peuvent commenter.

Albums, sondages
- Un album appartient à un événement, seuls les organisateurs le créent, les membres de l'événement mettent et commentent les photos.
- Un sondage a 1 ou plusieurs questions, chaque question a au moins 2 réponses et un participant n'en choisit qu'une. Il répond à toutes les questions en une fois, et il peut modifier sa réponse.

Billetterie
- Seulement pour les événements publics avec `billetterie_active`.
- Quantité limitée par type de billet, un seul billet par email et par événement.
- Pas besoin d'avoir un compte pour acheter un billet. On ne peut pas supprimer un type de billet déjà vendu.

Shopping list et covoiturage
- Il faut activer l'option sur l'événement (`shopping_active`, `covoiturage_actif`).
- Un élément de la shopping list est unique par événement (sans tenir compte des majuscules).
- Covoiturage : un trajet par membre et par événement, on peut réserver une place tant qu'il en reste.

## Choix et limites

- Pas de mot de passe ni de token, c'est le header `x-user-id` qui fait office d'identification (TP de 3h).
- Les photos sont des urls, il n'y a pas d'upload de fichier.
- Les dates sont au format ISO 8601, par exemple `2026-12-18T19:00:00Z`.
- Une personne qui n'est pas autorisée à voir un événement privé ou un groupe secret reçoit un 404 pour ne pas révéler qu'il existe.

## Structure

```
src/
  app.js          configuration express et gestion des erreurs
  server.js       lancement du serveur
  db.js           création des tables sqlite
  utils.js        validation, pagination, erreurs
  droits.js       vérification des droits (membre, admin, organisateur)
  routes/         un fichier par ressource
postman/          collection postman
```
