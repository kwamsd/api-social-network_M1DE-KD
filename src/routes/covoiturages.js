const express = require('express');
const { db } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner, motif } = require('../utils');
const { trouver, evenementLecture, evenementMembre, exigerOption } = require('../droits');

const router = express.Router();

const champs = {
  lieu_depart: { type: 'string', requis: true, max: 255 },
  heure_depart: { type: 'date', requis: true },
  prix: { type: 'nombre', requis: true, min: 0 },
  places: { type: 'int', requis: true, min: 1, max: 20 },
  ecart_max_minutes: { type: 'int', min: 0, max: 1440, defaut: 0 },
};

const SQL_COVOIT =
  `SELECT c.*, u.nom AS conducteur_nom, u.prenom AS conducteur_prenom,
     (SELECT COUNT(*) FROM covoiturage_passagers WHERE covoiturage_id = c.id) AS nb_passagers,
     c.places - (SELECT COUNT(*) FROM covoiturage_passagers WHERE covoiturage_id = c.id) AS places_restantes
   FROM covoiturages c JOIN users u ON u.id = c.user_id`;

function vue(id) {
  const covoiturage = db.prepare(`${SQL_COVOIT} WHERE c.id = ?`).get(id);
  const passagers = db
    .prepare(
      `SELECT u.id, u.nom, u.prenom FROM covoiturage_passagers p JOIN users u ON u.id = p.user_id
       WHERE p.covoiturage_id = ? ORDER BY p.created_at`
    )
    .all(id);
  return { ...covoiturage, passagers };
}

function contexte(req, covoiturageId) {
  const covoiturage = trouver('covoiturages', covoiturageId, 'Covoiturage');
  const ctx = evenementMembre(req, covoiturage.evenement_id);
  exigerOption(ctx.evt, 'covoiturage_actif', 'Le covoiturage');
  return { covoiturage, ...ctx };
}

router.post('/evenements/:id/covoiturages', (req, res) => {
  const { evt, user } = evenementMembre(req, toId(req.params.id));
  exigerOption(evt, 'covoiturage_actif', 'Le covoiturage');
  const donnees = valider(req.body, champs);
  const deja = db.prepare('SELECT 1 FROM covoiturages WHERE evenement_id = ? AND user_id = ?').get(evt.id, user.id);
  if (deja) throw erreur(409, 'Vous proposez déjà un covoiturage pour cet événement');
  const id = inserer('covoiturages', { ...donnees, evenement_id: evt.id, user_id: user.id });
  res.status(201).location(`/covoiturages/${id}`).json(vue(id));
});

router.get('/evenements/:id/covoiturages', (req, res) => {
  const { evt } = evenementLecture(req, toId(req.params.id));
  exigerOption(evt, 'covoiturage_actif', 'Le covoiturage');
  const lieu = motif(req.query.lieu_depart);
  let prixMax = null;
  if (req.query.prix_max !== undefined) {
    prixMax = Number(req.query.prix_max);
    if (!Number.isFinite(prixMax) || prixMax < 0) throw erreur(400, 'prix_max invalide');
  }
  if (req.query.places_dispo !== undefined && !['true', 'false'].includes(req.query.places_dispo)) {
    throw erreur(400, 'places_dispo doit être true ou false');
  }
  const seulementLibres = req.query.places_dispo === 'true' ? 1 : null;
  const sql =
    `SELECT * FROM (${SQL_COVOIT} WHERE c.evenement_id = ?) AS t
     WHERE (? IS NULL OR t.lieu_depart LIKE ?) AND (? IS NULL OR t.prix <= ?) AND (? IS NULL OR t.places_restantes > 0)` +
    ordonner(req, { heure_depart: 't.heure_depart', prix: 't.prix', places_restantes: 't.places_restantes' }, 'heure_depart');
  res.json(paginer(req, sql, [evt.id, lieu, lieu, prixMax, prixMax, seulementLibres]));
});

router.get('/covoiturages/:id', (req, res) => {
  const covoiturage = trouver('covoiturages', toId(req.params.id), 'Covoiturage');
  const { evt } = evenementLecture(req, covoiturage.evenement_id);
  exigerOption(evt, 'covoiturage_actif', 'Le covoiturage');
  res.json(vue(covoiturage.id));
});

function modifier(partiel) {
  return (req, res) => {
    const { covoiturage, user } = contexte(req, toId(req.params.id));
    if (covoiturage.user_id !== user.id) throw erreur(403, 'Seul le conducteur peut modifier son covoiturage');
    const donnees = valider(req.body, champs, partiel);
    const passagers = vue(covoiturage.id).nb_passagers;
    if (donnees.places !== undefined && donnees.places < passagers) {
      throw erreur(409, `Le nombre de places ne peut pas être inférieur aux passagers déjà inscrits (${passagers})`);
    }
    mettreAJour('covoiturages', covoiturage.id, donnees);
    res.json(vue(covoiturage.id));
  };
}

router.put('/covoiturages/:id', modifier(false));
router.patch('/covoiturages/:id', modifier(true));

router.delete('/covoiturages/:id', (req, res) => {
  const { covoiturage, user, role } = contexte(req, toId(req.params.id));
  if (covoiturage.user_id !== user.id && role !== 'organisateur') {
    throw erreur(403, 'Réservé au conducteur ou aux organisateurs');
  }
  db.prepare('DELETE FROM covoiturages WHERE id = ?').run(covoiturage.id);
  res.status(204).end();
});

router.post('/covoiturages/:id/reservations', (req, res) => {
  const { covoiturage, user } = contexte(req, toId(req.params.id));
  if (covoiturage.user_id === user.id) throw erreur(400, 'Le conducteur ne peut pas réserver sa propre voiture');
  const deja = db
    .prepare('SELECT 1 FROM covoiturage_passagers WHERE covoiturage_id = ? AND user_id = ?')
    .get(covoiturage.id, user.id);
  if (deja) throw erreur(409, 'Vous avez déjà une place dans ce covoiturage');
  if (vue(covoiturage.id).places_restantes <= 0) throw erreur(409, 'Covoiturage complet');
  db.prepare('INSERT INTO covoiturage_passagers (covoiturage_id, user_id) VALUES (?, ?)').run(covoiturage.id, user.id);
  res.status(201).json(vue(covoiturage.id));
});

router.delete('/covoiturages/:id/reservations', (req, res) => {
  const { covoiturage, user } = contexte(req, toId(req.params.id));
  const info = db
    .prepare('DELETE FROM covoiturage_passagers WHERE covoiturage_id = ? AND user_id = ?')
    .run(covoiturage.id, user.id);
  if (!info.changes) throw erreur(404, "Vous n'avez pas de place dans ce covoiturage");
  res.status(204).end();
});

module.exports = router;
