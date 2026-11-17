const express = require('express');
const { db } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner, motif } = require('../utils');
const { acteur, trouver } = require('../droits');

const router = express.Router();

const champs = {
  nom: { type: 'string', requis: true, max: 100 },
  prenom: { type: 'string', requis: true, max: 100 },
  email: { type: 'email', requis: true },
  telephone: { type: 'string', max: 30 },
  ville: { type: 'string', max: 100 },
  photo_profil: { type: 'url' },
};

function emailPris(email, sauf) {
  const ligne = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  return ligne && ligne.id !== sauf;
}

router.post('/utilisateurs', (req, res) => {
  const donnees = valider(req.body, champs);
  if (emailPris(donnees.email)) throw erreur(409, 'Un utilisateur avec cet email existe déjà');
  const id = inserer('users', donnees);
  res.status(201).location(`/utilisateurs/${id}`).json(trouver('users', id, 'Utilisateur'));
});

router.get('/utilisateurs', (req, res) => {
  const q = motif(req.query.q);
  const ville = motif(req.query.ville);
  const sql =
    `SELECT * FROM users WHERE (? IS NULL OR nom LIKE ? OR prenom LIKE ? OR email LIKE ?)` +
    ` AND (? IS NULL OR ville LIKE ?)` +
    ordonner(req, { nom: 'nom', prenom: 'prenom', email: 'email', created_at: 'created_at' }, 'nom');
  res.json(paginer(req, sql, [q, q, q, q, ville, ville]));
});

router.get('/utilisateurs/:id', (req, res) => {
  res.json(trouver('users', toId(req.params.id), 'Utilisateur'));
});

function modifier(partiel) {
  return (req, res) => {
    const id = toId(req.params.id);
    const user = acteur(req);
    trouver('users', id, 'Utilisateur');
    if (user.id !== id) throw erreur(403, 'Vous ne pouvez modifier que votre propre profil');
    const donnees = valider(req.body, champs, partiel);
    if (donnees.email && emailPris(donnees.email, id)) {
      throw erreur(409, 'Un utilisateur avec cet email existe déjà');
    }
    mettreAJour('users', id, donnees);
    res.json(trouver('users', id, 'Utilisateur'));
  };
}

router.put('/utilisateurs/:id', modifier(false));
router.patch('/utilisateurs/:id', modifier(true));

router.delete('/utilisateurs/:id', (req, res) => {
  const id = toId(req.params.id);
  const user = acteur(req);
  trouver('users', id, 'Utilisateur');
  if (user.id !== id) throw erreur(403, 'Vous ne pouvez supprimer que votre propre compte');
  const groupeSeul = db
    .prepare(
      `SELECT gm.groupe_id FROM groupe_membres gm
       WHERE gm.user_id = ? AND gm.role = 'admin'
       AND (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = gm.groupe_id AND role = 'admin') = 1`
    )
    .get(id);
  if (groupeSeul) {
    throw erreur(409, `Vous êtes le seul administrateur du groupe ${groupeSeul.groupe_id}, nommez un autre administrateur ou supprimez le groupe`);
  }
  const eventSeul = db
    .prepare(
      `SELECT em.evenement_id FROM evenement_membres em
       WHERE em.user_id = ? AND em.role = 'organisateur'
       AND (SELECT COUNT(*) FROM evenement_membres WHERE evenement_id = em.evenement_id AND role = 'organisateur') = 1`
    )
    .get(id);
  if (eventSeul) {
    throw erreur(409, `Vous êtes le seul organisateur de l'événement ${eventSeul.evenement_id}, nommez un autre organisateur ou supprimez l'événement`);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.status(204).end();
});

router.get('/utilisateurs/:id/groupes', (req, res) => {
  const id = toId(req.params.id);
  trouver('users', id, 'Utilisateur');
  const moi = req.get('x-user-id') ? acteur(req).id : 0;
  const sql =
    `SELECT g.id, g.nom, g.type, gm.role FROM groupe_membres gm JOIN groupes g ON g.id = gm.groupe_id
     WHERE gm.user_id = ? AND (g.type != 'secret' OR g.id IN (SELECT groupe_id FROM groupe_membres WHERE user_id = ?))
     ORDER BY g.nom`;
  res.json(paginer(req, sql, [id, moi]));
});

router.get('/utilisateurs/:id/evenements', (req, res) => {
  const id = toId(req.params.id);
  trouver('users', id, 'Utilisateur');
  const moi = req.get('x-user-id') ? acteur(req).id : 0;
  const sql =
    `SELECT e.id, e.nom, e.date_debut, e.date_fin, e.lieu, e.visibilite, e.statut, em.role
     FROM evenement_membres em JOIN evenements e ON e.id = em.evenement_id
     WHERE em.user_id = ?
     AND ((e.visibilite = 'public' AND e.statut = 'publie')
          OR e.id IN (SELECT evenement_id FROM evenement_membres WHERE user_id = ?))
     ORDER BY e.date_debut`;
  res.json(paginer(req, sql, [id, moi]));
});

module.exports = router;
