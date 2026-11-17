const express = require('express');
const { db, transaction } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner } = require('../utils');
const { trouver, evenementLecture, evenementOrga, evenementOuvert, exigerOption } = require('../droits');

const router = express.Router();

const champsType = {
  nom: { type: 'string', requis: true, max: 100 },
  montant: { type: 'nombre', requis: true, min: 0 },
  quantite: { type: 'int', requis: true, min: 1, max: 1000000 },
};

const champsBillet = {
  type_billet_id: { type: 'int', requis: true, min: 1 },
  nom: { type: 'string', requis: true, max: 100 },
  prenom: { type: 'string', requis: true, max: 100 },
  email: { type: 'email', requis: true },
  adresse: { type: 'string', requis: true, max: 255 },
  code_postal: { type: 'string', requis: true, max: 20 },
  ville: { type: 'string', requis: true, max: 100 },
  pays: { type: 'string', requis: true, max: 100 },
};

const SQL_TYPE =
  `SELECT t.*, (SELECT COUNT(*) FROM billets WHERE type_billet_id = t.id) AS vendus,
     t.quantite - (SELECT COUNT(*) FROM billets WHERE type_billet_id = t.id) AS restants
   FROM types_billets t`;

function vueType(id) {
  return db.prepare(`${SQL_TYPE} WHERE t.id = ?`).get(id);
}

function contexteType(req, typeId, lecture) {
  const type = trouver('types_billets', typeId, 'Type de billet');
  const ctx = lecture ? evenementLecture(req, type.evenement_id) : evenementOrga(req, type.evenement_id);
  return { type, ...ctx };
}

router.post('/evenements/:id/types-billets', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  if (evt.visibilite !== 'public') throw erreur(409, 'La billetterie est réservée aux événements publics');
  exigerOption(evt, 'billetterie_active', 'La billetterie');
  const donnees = valider(req.body, champsType);
  const id = inserer('types_billets', { ...donnees, evenement_id: evt.id });
  res.status(201).location(`/types-billets/${id}`).json(vueType(id));
});

router.get('/evenements/:id/types-billets', (req, res) => {
  const { evt } = evenementLecture(req, toId(req.params.id));
  exigerOption(evt, 'billetterie_active', 'La billetterie');
  const sql = `${SQL_TYPE} WHERE t.evenement_id = ?` + ordonner(req, { montant: 't.montant', nom: 't.nom', id: 't.id' }, 'id');
  res.json(paginer(req, sql, [evt.id]));
});

router.get('/types-billets/:id', (req, res) => {
  const { type } = contexteType(req, toId(req.params.id), true);
  res.json(vueType(type.id));
});

function modifierType(partiel) {
  return (req, res) => {
    const { type } = contexteType(req, toId(req.params.id), false);
    const donnees = valider(req.body, champsType, partiel);
    const vendus = vueType(type.id).vendus;
    if (donnees.quantite !== undefined && donnees.quantite < vendus) {
      throw erreur(409, `La quantité ne peut pas être inférieure aux billets déjà vendus (${vendus})`);
    }
    mettreAJour('types_billets', type.id, donnees);
    res.json(vueType(type.id));
  };
}

router.put('/types-billets/:id', modifierType(false));
router.patch('/types-billets/:id', modifierType(true));

router.delete('/types-billets/:id', (req, res) => {
  const { type } = contexteType(req, toId(req.params.id), false);
  if (vueType(type.id).vendus > 0) throw erreur(409, 'Suppression impossible : des billets de ce type ont été vendus');
  db.prepare('DELETE FROM types_billets WHERE id = ?').run(type.id);
  res.status(204).end();
});

router.post('/evenements/:id/billets', (req, res) => {
  const evt = trouver('evenements', toId(req.params.id), 'Événement');
  if (!evenementOuvert(evt)) throw erreur(404, 'Événement introuvable');
  exigerOption(evt, 'billetterie_active', 'La billetterie');
  const donnees = valider(req.body, champsBillet);
  const type = db
    .prepare('SELECT * FROM types_billets WHERE id = ? AND evenement_id = ?')
    .get(donnees.type_billet_id, evt.id);
  if (!type) throw erreur(400, "Ce type de billet n'existe pas pour cet événement");

  const id = transaction(() => {
    const deja = db.prepare('SELECT 1 FROM billets WHERE evenement_id = ? AND email = ?').get(evt.id, donnees.email);
    if (deja) throw erreur(409, 'Un seul billet par personne pour cet événement');
    if (vueType(type.id).restants <= 0) throw erreur(409, 'Billets épuisés pour ce type');
    return inserer('billets', { ...donnees, evenement_id: evt.id });
  });
  const billet = db.prepare('SELECT * FROM billets WHERE id = ?').get(id);
  res
    .status(201)
    .location(`/billets/${id}`)
    .json({ ...billet, type_billet: type.nom, montant: type.montant });
});

router.get('/evenements/:id/billets', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  const typeId = req.query.type_billet_id === undefined ? null : toId(req.query.type_billet_id, 'type_billet_id');
  const sql =
    `SELECT b.*, t.nom AS type_billet, t.montant FROM billets b JOIN types_billets t ON t.id = b.type_billet_id
     WHERE b.evenement_id = ? AND (? IS NULL OR b.type_billet_id = ?)` +
    ordonner(req, { date_achat: 'b.date_achat', nom: 'b.nom' }, 'date_achat');
  res.json(paginer(req, sql, [evt.id, typeId, typeId]));
});

router.get('/billets/:id', (req, res) => {
  const billet = trouver('billets', toId(req.params.id), 'Billet');
  evenementOrga(req, billet.evenement_id);
  const type = trouver('types_billets', billet.type_billet_id, 'Type de billet');
  res.json({ ...billet, type_billet: type.nom, montant: type.montant });
});

router.delete('/billets/:id', (req, res) => {
  const billet = trouver('billets', toId(req.params.id), 'Billet');
  evenementOrga(req, billet.evenement_id);
  db.prepare('DELETE FROM billets WHERE id = ?').run(billet.id);
  res.status(204).end();
});

module.exports = router;
