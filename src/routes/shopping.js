const express = require('express');
const { db } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner, motif } = require('../utils');
const { trouver, evenementLecture, evenementMembre, exigerOption } = require('../droits');

const router = express.Router();

const champs = {
  nom: { type: 'string', requis: true, max: 150 },
  quantite: { type: 'int', requis: true, min: 1, max: 10000 },
  heure_arrivee: { type: 'heure', requis: true },
};

function nomPris(evenementId, nom, sauf) {
  const ligne = db.prepare('SELECT id FROM shopping WHERE evenement_id = ? AND nom = ?').get(evenementId, nom);
  return ligne && ligne.id !== sauf;
}

function contexteItem(req, itemId) {
  const item = trouver('shopping', itemId, 'Élément');
  const ctx = evenementMembre(req, item.evenement_id);
  exigerOption(ctx.evt, 'shopping_active', 'La shopping list');
  return { item, ...ctx };
}

router.post('/evenements/:id/shopping', (req, res) => {
  const { evt, user } = evenementMembre(req, toId(req.params.id));
  exigerOption(evt, 'shopping_active', 'La shopping list');
  const donnees = valider(req.body, champs);
  if (nomPris(evt.id, donnees.nom)) throw erreur(409, 'Cet élément est déjà dans la liste de cet événement');
  const id = inserer('shopping', { ...donnees, evenement_id: evt.id, user_id: user.id });
  res.status(201).location(`/shopping/${id}`).json(trouver('shopping', id, 'Élément'));
});

router.get('/evenements/:id/shopping', (req, res) => {
  const { evt } = evenementLecture(req, toId(req.params.id));
  exigerOption(evt, 'shopping_active', 'La shopping list');
  const q = motif(req.query.q);
  const userId = req.query.user_id === undefined ? null : toId(req.query.user_id, 'user_id');
  const sql =
    `SELECT s.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom FROM shopping s JOIN users u ON u.id = s.user_id
     WHERE s.evenement_id = ? AND (? IS NULL OR s.nom LIKE ?) AND (? IS NULL OR s.user_id = ?)` +
    ordonner(req, { nom: 's.nom', heure_arrivee: 's.heure_arrivee', quantite: 's.quantite' }, 'heure_arrivee');
  res.json(paginer(req, sql, [evt.id, q, q, userId, userId]));
});

router.get('/shopping/:id', (req, res) => {
  const item = trouver('shopping', toId(req.params.id), 'Élément');
  const { evt } = evenementLecture(req, item.evenement_id);
  exigerOption(evt, 'shopping_active', 'La shopping list');
  res.json(item);
});

function modifier(partiel) {
  return (req, res) => {
    const { item, user, role } = contexteItem(req, toId(req.params.id));
    if (item.user_id !== user.id && role !== 'organisateur') {
      throw erreur(403, "Réservé à l'auteur de l'élément ou aux organisateurs");
    }
    const donnees = valider(req.body, champs, partiel);
    if (donnees.nom && nomPris(item.evenement_id, donnees.nom, item.id)) {
      throw erreur(409, 'Cet élément est déjà dans la liste de cet événement');
    }
    mettreAJour('shopping', item.id, donnees);
    res.json(trouver('shopping', item.id, 'Élément'));
  };
}

router.put('/shopping/:id', modifier(false));
router.patch('/shopping/:id', modifier(true));

router.delete('/shopping/:id', (req, res) => {
  const { item, user, role } = contexteItem(req, toId(req.params.id));
  if (item.user_id !== user.id && role !== 'organisateur') {
    throw erreur(403, "Réservé à l'auteur de l'élément ou aux organisateurs");
  }
  db.prepare('DELETE FROM shopping WHERE id = ?').run(item.id);
  res.status(204).end();
});

module.exports = router;
