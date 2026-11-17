const express = require('express');
const { db, transaction } = require('../db');
const {
  erreur,
  toId,
  valider,
  inserer,
  mettreAJour,
  paginer,
  ordonner,
  lireDate,
  motif,
  bools,
  listeIds,
  utilisateursInconnus,
} = require('../utils');
const {
  acteur,
  acteurOptionnel,
  trouver,
  roleGroupe,
  roleEvenement,
  evenementOuvert,
  evenementLecture,
  evenementMembre,
  evenementOrga,
} = require('../droits');

const router = express.Router();

const BOOLS = ['billetterie_active', 'shopping_active', 'covoiturage_actif'];

const champsModifiables = {
  nom: { type: 'string', requis: true, max: 150 },
  description: { type: 'string', max: 5000 },
  date_debut: { type: 'date', requis: true },
  date_fin: { type: 'date', requis: true },
  lieu: { type: 'string', requis: true, max: 255 },
  photo_couverture: { type: 'url' },
  visibilite: { type: 'enum', valeurs: ['public', 'prive'], defaut: 'public' },
  billetterie_active: { type: 'bool', defaut: 0 },
  shopping_active: { type: 'bool', defaut: 0 },
  covoiturage_actif: { type: 'bool', defaut: 0 },
};

const champsCreation = {
  ...champsModifiables,
  groupe_id: { type: 'int', min: 1 },
};

function vueEvenement(id, user) {
  const e = db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM evenement_membres WHERE evenement_id = e.id AND role = 'organisateur') AS nb_organisateurs,
        (SELECT COUNT(*) FROM evenement_membres WHERE evenement_id = e.id AND role = 'participant') AS nb_participants
       FROM evenements e WHERE e.id = ?`
    )
    .get(id);
  const vue = bools(e, BOOLS);
  vue.mon_role = user ? roleEvenement(id, user.id) : null;
  return vue;
}

function verifierCoherence(e, groupe) {
  if (Date.parse(e.date_fin) <= Date.parse(e.date_debut)) {
    throw erreur(400, 'Données invalides', ['date_fin doit être postérieure à date_debut']);
  }
  if (e.billetterie_active && e.visibilite !== 'public') {
    throw erreur(400, 'La billetterie est réservée aux événements publics');
  }
  if (groupe && groupe.type !== 'public' && e.visibilite === 'public') {
    throw erreur(400, "Un événement d'un groupe privé ou secret doit être privé");
  }
}

function invitationGroupe(evenementId, groupeId) {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO evenement_membres (evenement_id, user_id, role)
       SELECT ?, user_id, 'participant' FROM groupe_membres WHERE groupe_id = ?`
    )
    .run(evenementId, groupeId);
  return Number(info.changes);
}

router.post('/evenements', (req, res) => {
  const user = acteur(req);
  const donnees = valider(req.body, champsCreation);
  const organisateurs = listeIds(req.body.organisateurs, 'organisateurs');
  const membres = listeIds(req.body.membres, 'membres');
  const inviter = req.body.inviter_groupe === true;
  if (req.body.inviter_groupe !== undefined && typeof req.body.inviter_groupe !== 'boolean') {
    throw erreur(400, 'inviter_groupe doit être true ou false');
  }

  let groupe = null;
  if (donnees.groupe_id) {
    groupe = db.prepare('SELECT * FROM groupes WHERE id = ?').get(donnees.groupe_id);
    if (!groupe) throw erreur(400, 'groupe_id inconnu');
    const role = roleGroupe(groupe.id, user.id);
    if (!role) throw erreur(403, 'Vous devez être membre du groupe pour y créer un événement');
    if (role !== 'admin' && !groupe.membres_peuvent_creer_evenements) {
      throw erreur(403, 'Les membres ne sont pas autorisés à créer des événements dans ce groupe');
    }
    if (groupe.type !== 'public' && req.body.visibilite === undefined) donnees.visibilite = 'prive';
  } else if (inviter) {
    throw erreur(400, 'inviter_groupe nécessite un groupe_id');
  }
  verifierCoherence(donnees, groupe);

  const inconnus = utilisateursInconnus([...new Set([...organisateurs, ...membres])]);
  if (inconnus.length) throw erreur(400, 'Utilisateurs inconnus', inconnus);

  const id = transaction(() => {
    const evenementId = inserer('evenements', { ...donnees, createur_id: user.id });
    const ajout = db.prepare(
      'INSERT OR IGNORE INTO evenement_membres (evenement_id, user_id, role) VALUES (?, ?, ?)'
    );
    ajout.run(evenementId, user.id, 'organisateur');
    for (const o of organisateurs) ajout.run(evenementId, o, 'organisateur');
    for (const m of membres) ajout.run(evenementId, m, 'participant');
    if (inviter) invitationGroupe(evenementId, groupe.id);
    return evenementId;
  });
  res.status(201).location(`/evenements/${id}`).json(vueEvenement(id, user));
});

router.get('/evenements', (req, res) => {
  const user = acteurOptionnel(req);
  const q = motif(req.query.q);
  const lieu = motif(req.query.lieu);
  const visibilite = req.query.visibilite === undefined ? null : req.query.visibilite;
  if (visibilite !== null && !['public', 'prive'].includes(visibilite)) {
    throw erreur(400, 'visibilite invalide (public, prive)');
  }
  const statut = req.query.statut === undefined ? null : req.query.statut;
  if (statut !== null && !['brouillon', 'publie'].includes(statut)) {
    throw erreur(400, 'statut invalide (brouillon, publie)');
  }
  const dateMin = req.query.date_min === undefined ? null : lireDate(req.query.date_min, 'date_min');
  const dateMax = req.query.date_max === undefined ? null : lireDate(req.query.date_max, 'date_max');
  const groupeId = req.query.groupe_id === undefined ? null : toId(req.query.groupe_id, 'groupe_id');

  const sql =
    `SELECT e.id, e.nom, e.description, e.date_debut, e.date_fin, e.lieu, e.photo_couverture,
       e.visibilite, e.statut, e.groupe_id,
       (SELECT COUNT(*) FROM evenement_membres WHERE evenement_id = e.id) AS nb_membres
     FROM evenements e
     WHERE ((e.visibilite = 'public' AND e.statut = 'publie')
            OR e.id IN (SELECT evenement_id FROM evenement_membres WHERE user_id = ?))
     AND (? IS NULL OR e.nom LIKE ? OR e.description LIKE ?)
     AND (? IS NULL OR e.lieu LIKE ?)
     AND (? IS NULL OR e.visibilite = ?)
     AND (? IS NULL OR e.statut = ?)
     AND (? IS NULL OR e.date_debut >= ?)
     AND (? IS NULL OR e.date_debut <= ?)
     AND (? IS NULL OR e.groupe_id = ?)` +
    ordonner(req, { date_debut: 'e.date_debut', nom: 'e.nom', created_at: 'e.created_at', nb_membres: 'nb_membres' }, 'date_debut');
  res.json(
    paginer(req, sql, [
      user ? user.id : 0,
      q, q, q,
      lieu, lieu,
      visibilite, visibilite,
      statut, statut,
      dateMin, dateMin,
      dateMax, dateMax,
      groupeId, groupeId,
    ])
  );
});

router.get('/evenements/:id', (req, res) => {
  const { evt, user } = evenementLecture(req, toId(req.params.id));
  res.json(vueEvenement(evt.id, user));
});

function modifier(partiel) {
  return (req, res) => {
    const { evt, user } = evenementOrga(req, toId(req.params.id));
    const donnees = valider(req.body, champsModifiables, partiel);
    const fusion = { ...evt, ...donnees };
    const groupe = evt.groupe_id ? trouver('groupes', evt.groupe_id, 'Groupe') : null;
    verifierCoherence(fusion, groupe);
    if (evt.billetterie_active && !fusion.billetterie_active) {
      const vendus = db.prepare('SELECT COUNT(*) AS n FROM billets WHERE evenement_id = ?').get(evt.id).n;
      if (vendus > 0) throw erreur(409, 'Impossible de désactiver la billetterie : des billets ont déjà été vendus');
    }
    mettreAJour('evenements', evt.id, donnees);
    res.json(vueEvenement(evt.id, user));
  };
}

router.put('/evenements/:id', modifier(false));
router.patch('/evenements/:id', modifier(true));

router.delete('/evenements/:id', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  db.prepare('DELETE FROM evenements WHERE id = ?').run(evt.id);
  res.status(204).end();
});

router.post('/evenements/:id/publier', (req, res) => {
  const { evt, user } = evenementOrga(req, toId(req.params.id));
  if (evt.statut === 'publie') throw erreur(409, "L'événement est déjà publié");
  db.prepare("UPDATE evenements SET statut = 'publie' WHERE id = ?").run(evt.id);
  res.json(vueEvenement(evt.id, user));
});

router.post('/evenements/:id/depublier', (req, res) => {
  const { evt, user } = evenementOrga(req, toId(req.params.id));
  if (evt.statut === 'brouillon') throw erreur(409, "L'événement est déjà en brouillon");
  db.prepare("UPDATE evenements SET statut = 'brouillon' WHERE id = ?").run(evt.id);
  res.json(vueEvenement(evt.id, user));
});

function listerMembres(roleFixe) {
  return (req, res) => {
    const { evt } = evenementLecture(req, toId(req.params.id));
    const role = roleFixe || (req.query.role === undefined ? null : req.query.role);
    if (role !== null && !['organisateur', 'participant'].includes(role)) {
      throw erreur(400, 'role invalide (organisateur, participant)');
    }
    const sql =
      `SELECT u.id, u.nom, u.prenom, u.photo_profil, em.role, em.created_at AS depuis
       FROM evenement_membres em JOIN users u ON u.id = em.user_id
       WHERE em.evenement_id = ? AND (? IS NULL OR em.role = ?)
       ORDER BY em.role, u.nom`;
    res.json(paginer(req, sql, [evt.id, role, role]));
  };
}

router.get('/evenements/:id/membres', listerMembres(null));
router.get('/evenements/:id/organisateurs', listerMembres('organisateur'));
router.get('/evenements/:id/participants', listerMembres('participant'));

router.post('/evenements/:id/membres', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  const donnees = valider(req.body, {
    user_id: { type: 'int', requis: true, min: 1 },
    role: { type: 'enum', valeurs: ['organisateur', 'participant'], defaut: 'participant' },
  });
  trouver('users', donnees.user_id, 'Utilisateur');
  if (roleEvenement(evt.id, donnees.user_id)) throw erreur(409, 'Cet utilisateur est déjà membre de l\'événement');
  db.prepare('INSERT INTO evenement_membres (evenement_id, user_id, role) VALUES (?, ?, ?)').run(
    evt.id,
    donnees.user_id,
    donnees.role
  );
  res.status(201).json({ evenement_id: evt.id, user_id: donnees.user_id, role: donnees.role });
});

router.post('/evenements/:id/rejoindre', (req, res) => {
  const user = acteur(req);
  const evt = trouver('evenements', toId(req.params.id), 'Événement');
  if (!evenementOuvert(evt)) throw erreur(403, "Cet événement n'est pas ouvert à l'inscription libre");
  if (roleEvenement(evt.id, user.id)) throw erreur(409, "Vous participez déjà à l'événement");
  db.prepare('INSERT INTO evenement_membres (evenement_id, user_id, role) VALUES (?, ?, ?)').run(evt.id, user.id, 'participant');
  res.status(201).json({ evenement_id: evt.id, user_id: user.id, role: 'participant' });
});

function nbOrganisateurs(evenementId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM evenement_membres WHERE evenement_id = ? AND role = 'organisateur'")
    .get(evenementId).n;
}

router.patch('/evenements/:id/membres/:userId', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  const userId = toId(req.params.userId, 'userId');
  const donnees = valider(req.body, { role: { type: 'enum', valeurs: ['organisateur', 'participant'], requis: true } });
  const actuel = roleEvenement(evt.id, userId);
  if (!actuel) throw erreur(404, "Membre introuvable dans cet événement");
  if (actuel === 'organisateur' && donnees.role === 'participant' && nbOrganisateurs(evt.id) === 1) {
    throw erreur(409, 'Un événement doit garder au moins un organisateur');
  }
  db.prepare('UPDATE evenement_membres SET role = ? WHERE evenement_id = ? AND user_id = ?').run(donnees.role, evt.id, userId);
  res.json({ evenement_id: evt.id, user_id: userId, role: donnees.role });
});

router.delete('/evenements/:id/membres/:userId', (req, res) => {
  const { evt, user, role } = evenementMembre(req, toId(req.params.id));
  const userId = toId(req.params.userId, 'userId');
  if (userId !== user.id && role !== 'organisateur') {
    throw erreur(403, 'Seul un organisateur peut retirer un autre membre');
  }
  const cible = roleEvenement(evt.id, userId);
  if (!cible) throw erreur(404, "Membre introuvable dans cet événement");
  if (cible === 'organisateur' && nbOrganisateurs(evt.id) === 1) {
    throw erreur(409, "Le dernier organisateur ne peut pas quitter l'événement");
  }
  db.prepare('DELETE FROM evenement_membres WHERE evenement_id = ? AND user_id = ?').run(evt.id, userId);
  res.status(204).end();
});

router.post('/evenements/:id/inviter-groupe', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  if (!evt.groupe_id) throw erreur(400, "Cet événement n'est lié à aucun groupe");
  const invites = invitationGroupe(evt.id, evt.groupe_id);
  res.json({ evenement_id: evt.id, groupe_id: evt.groupe_id, nouveaux_participants: invites });
});

router.get('/evenements/:id/partage', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  if (!evenementOuvert(evt)) throw erreur(403, 'Seuls les événements publics et publiés peuvent être partagés');
  if (evt.groupe_id) {
    const groupe = trouver('groupes', evt.groupe_id, 'Groupe');
    if (groupe.type !== 'public') throw erreur(403, 'Le partage est réservé aux groupes publics');
  }
  const lien = `${req.protocol}://${req.get('host')}/evenements/${evt.id}`;
  const url = encodeURIComponent(lien);
  const texte = encodeURIComponent(evt.nom);
  res.json({
    evenement_id: evt.id,
    lien,
    reseaux: {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      x: `https://twitter.com/intent/tweet?url=${url}&text=${texte}`,
      whatsapp: `https://wa.me/?text=${texte}%20${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    },
  });
});

router.get('/evenements/:id/resume', (req, res) => {
  const { evt } = evenementLecture(req, toId(req.params.id));
  const compte = (sql) => db.prepare(sql).get(evt.id).n;
  const vendus = compte('SELECT COUNT(*) AS n FROM billets WHERE evenement_id = ?');
  const capacite = compte('SELECT COALESCE(SUM(quantite), 0) AS n FROM types_billets WHERE evenement_id = ?');
  res.json({
    evenement_id: evt.id,
    nom: evt.nom,
    organisateurs: compte("SELECT COUNT(*) AS n FROM evenement_membres WHERE evenement_id = ? AND role = 'organisateur'"),
    participants: compte("SELECT COUNT(*) AS n FROM evenement_membres WHERE evenement_id = ? AND role = 'participant'"),
    fils: compte('SELECT COUNT(*) AS n FROM fils WHERE evenement_id = ?'),
    albums: compte('SELECT COUNT(*) AS n FROM albums WHERE evenement_id = ?'),
    photos: compte('SELECT COUNT(*) AS n FROM photos WHERE album_id IN (SELECT id FROM albums WHERE evenement_id = ?)'),
    sondages: compte('SELECT COUNT(*) AS n FROM sondages WHERE evenement_id = ?'),
    billetterie: {
      active: !!evt.billetterie_active,
      billets_vendus: vendus,
      places_restantes: capacite - vendus,
      recette: compte(
        'SELECT COALESCE(SUM(t.montant), 0) AS n FROM billets b JOIN types_billets t ON t.id = b.type_billet_id WHERE b.evenement_id = ?'
      ),
    },
    shopping_items: compte('SELECT COUNT(*) AS n FROM shopping WHERE evenement_id = ?'),
    covoiturages: compte('SELECT COUNT(*) AS n FROM covoiturages WHERE evenement_id = ?'),
  });
});

module.exports = router;
