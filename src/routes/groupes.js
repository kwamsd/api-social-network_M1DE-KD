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
  motif,
  bools,
  listeIds,
  utilisateursInconnus,
} = require('../utils');
const { acteur, acteurOptionnel, trouver, roleGroupe, groupeLecture, groupeMembre, groupeAdmin } = require('../droits');

const router = express.Router();

const BOOLS = ['membres_peuvent_publier', 'membres_peuvent_creer_evenements'];

const champs = {
  nom: { type: 'string', requis: true, max: 100 },
  description: { type: 'string', max: 2000 },
  icone: { type: 'url' },
  photo_couverture: { type: 'url' },
  type: { type: 'enum', valeurs: ['public', 'prive', 'secret'], defaut: 'public' },
  membres_peuvent_publier: { type: 'bool', defaut: 1 },
  membres_peuvent_creer_evenements: { type: 'bool', defaut: 0 },
};

function vueGroupe(id, user) {
  const g = db
    .prepare(
      `SELECT g.*,
        (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = g.id) AS nb_membres,
        (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = g.id AND role = 'admin') AS nb_admins
       FROM groupes g WHERE g.id = ?`
    )
    .get(id);
  const vue = bools(g, BOOLS);
  vue.mon_role = user ? roleGroupe(id, user.id) : null;
  return vue;
}

router.post('/groupes', (req, res) => {
  const user = acteur(req);
  const donnees = valider(req.body, champs);
  const membres = listeIds(req.body.membres, 'membres').filter((id) => id !== user.id);
  const inconnus = utilisateursInconnus(membres);
  if (inconnus.length) throw erreur(400, 'Utilisateurs inconnus dans membres', inconnus);
  const id = transaction(() => {
    const groupeId = inserer('groupes', donnees);
    const ajout = db.prepare('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)');
    ajout.run(groupeId, user.id, 'admin');
    for (const m of membres) ajout.run(groupeId, m, 'membre');
    return groupeId;
  });
  res.status(201).location(`/groupes/${id}`).json(vueGroupe(id, user));
});

router.get('/groupes', (req, res) => {
  const user = acteurOptionnel(req);
  const q = motif(req.query.q);
  const type = req.query.type === undefined ? null : req.query.type;
  if (type !== null && !['public', 'prive', 'secret'].includes(type)) {
    throw erreur(400, 'type invalide (public, prive, secret)');
  }
  const sql =
    `SELECT g.id, g.nom, g.description, g.icone, g.type,
       (SELECT COUNT(*) FROM groupe_membres WHERE groupe_id = g.id) AS nb_membres
     FROM groupes g
     WHERE (g.type != 'secret' OR g.id IN (SELECT groupe_id FROM groupe_membres WHERE user_id = ?))
     AND (? IS NULL OR g.nom LIKE ? OR g.description LIKE ?)
     AND (? IS NULL OR g.type = ?)` +
    ordonner(req, { nom: 'g.nom', created_at: 'g.created_at', nb_membres: 'nb_membres' }, 'nom');
  res.json(paginer(req, sql, [user ? user.id : 0, q, q, q, type, type]));
});

router.get('/groupes/:id', (req, res) => {
  const { g, user } = groupeLecture(req, toId(req.params.id));
  res.json(vueGroupe(g.id, user));
});

function modifier(partiel) {
  return (req, res) => {
    const { g, user } = groupeAdmin(req, toId(req.params.id));
    const donnees = valider(req.body, champs, partiel);
    mettreAJour('groupes', g.id, donnees);
    res.json(vueGroupe(g.id, user));
  };
}

router.put('/groupes/:id', modifier(false));
router.patch('/groupes/:id', modifier(true));

router.delete('/groupes/:id', (req, res) => {
  const { g } = groupeAdmin(req, toId(req.params.id));
  db.prepare('DELETE FROM groupes WHERE id = ?').run(g.id);
  res.status(204).end();
});

router.get('/groupes/:id/membres', (req, res) => {
  const { g } = groupeLecture(req, toId(req.params.id), { contenu: true });
  const role = req.query.role === undefined ? null : req.query.role;
  if (role !== null && !['admin', 'membre'].includes(role)) throw erreur(400, 'role invalide (admin, membre)');
  const sql =
    `SELECT u.id, u.nom, u.prenom, u.photo_profil, gm.role, gm.created_at AS depuis
     FROM groupe_membres gm JOIN users u ON u.id = gm.user_id
     WHERE gm.groupe_id = ? AND (? IS NULL OR gm.role = ?)
     ORDER BY gm.role, u.nom`;
  res.json(paginer(req, sql, [g.id, role, role]));
});

router.post('/groupes/:id/membres', (req, res) => {
  const { g } = groupeAdmin(req, toId(req.params.id));
  const donnees = valider(
    req.body,
    {
      user_id: { type: 'int', requis: true, min: 1 },
      role: { type: 'enum', valeurs: ['admin', 'membre'], defaut: 'membre' },
    }
  );
  trouver('users', donnees.user_id, 'Utilisateur');
  if (roleGroupe(g.id, donnees.user_id)) throw erreur(409, 'Cet utilisateur est déjà membre du groupe');
  db.prepare('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)').run(g.id, donnees.user_id, donnees.role);
  res.status(201).json({ groupe_id: g.id, user_id: donnees.user_id, role: donnees.role });
});

router.post('/groupes/:id/rejoindre', (req, res) => {
  const user = acteur(req);
  const g = trouver('groupes', toId(req.params.id), 'Groupe');
  if (g.type !== 'public') throw erreur(403, 'Seuls les groupes publics peuvent être rejoints librement');
  if (roleGroupe(g.id, user.id)) throw erreur(409, 'Vous êtes déjà membre du groupe');
  db.prepare('INSERT INTO groupe_membres (groupe_id, user_id, role) VALUES (?, ?, ?)').run(g.id, user.id, 'membre');
  res.status(201).json({ groupe_id: g.id, user_id: user.id, role: 'membre' });
});

function nbAdmins(groupeId) {
  return db.prepare("SELECT COUNT(*) AS n FROM groupe_membres WHERE groupe_id = ? AND role = 'admin'").get(groupeId).n;
}

router.patch('/groupes/:id/membres/:userId', (req, res) => {
  const { g } = groupeAdmin(req, toId(req.params.id));
  const userId = toId(req.params.userId, 'userId');
  const donnees = valider(req.body, { role: { type: 'enum', valeurs: ['admin', 'membre'], requis: true } });
  const actuel = roleGroupe(g.id, userId);
  if (!actuel) throw erreur(404, 'Membre introuvable dans ce groupe');
  if (actuel === 'admin' && donnees.role === 'membre' && nbAdmins(g.id) === 1) {
    throw erreur(409, 'Un groupe doit garder au moins un administrateur');
  }
  db.prepare('UPDATE groupe_membres SET role = ? WHERE groupe_id = ? AND user_id = ?').run(donnees.role, g.id, userId);
  res.json({ groupe_id: g.id, user_id: userId, role: donnees.role });
});

router.delete('/groupes/:id/membres/:userId', (req, res) => {
  const { g, user, role } = groupeMembre(req, toId(req.params.id));
  const userId = toId(req.params.userId, 'userId');
  if (userId !== user.id && role !== 'admin') {
    throw erreur(403, 'Seul un administrateur peut retirer un autre membre');
  }
  const cible = roleGroupe(g.id, userId);
  if (!cible) throw erreur(404, 'Membre introuvable dans ce groupe');
  if (cible === 'admin' && nbAdmins(g.id) === 1) {
    throw erreur(409, 'Le dernier administrateur ne peut pas quitter le groupe');
  }
  db.prepare('DELETE FROM groupe_membres WHERE groupe_id = ? AND user_id = ?').run(g.id, userId);
  res.status(204).end();
});

router.get('/groupes/:id/evenements', (req, res) => {
  const { g, user } = groupeLecture(req, toId(req.params.id), { contenu: true });
  const sql =
    `SELECT e.id, e.nom, e.date_debut, e.date_fin, e.lieu, e.visibilite, e.statut
     FROM evenements e
     WHERE e.groupe_id = ?
     AND ((e.visibilite = 'public' AND e.statut = 'publie')
          OR e.id IN (SELECT evenement_id FROM evenement_membres WHERE user_id = ?))
     ORDER BY e.date_debut`;
  res.json(paginer(req, sql, [g.id, user ? user.id : 0]));
});

module.exports = router;
