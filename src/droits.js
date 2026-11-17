const { db } = require('./db');
const { erreur } = require('./utils');

function trouver(table, id, nom) {
  const ligne = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!ligne) throw erreur(404, `${nom} introuvable`);
  return ligne;
}

function acteurOptionnel(req) {
  const entete = req.get('x-user-id');
  if (entete === undefined) return null;
  const id = Number(entete);
  if (!Number.isInteger(id) || id <= 0) throw erreur(401, 'Header x-user-id invalide');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw erreur(401, 'Utilisateur du header x-user-id introuvable');
  return user;
}

function acteur(req) {
  const user = acteurOptionnel(req);
  if (!user) throw erreur(401, 'Header x-user-id requis');
  return user;
}

function roleGroupe(groupeId, userId) {
  if (!userId) return null;
  const r = db
    .prepare('SELECT role FROM groupe_membres WHERE groupe_id = ? AND user_id = ?')
    .get(groupeId, userId);
  return r ? r.role : null;
}

function roleEvenement(evenementId, userId) {
  if (!userId) return null;
  const r = db
    .prepare('SELECT role FROM evenement_membres WHERE evenement_id = ? AND user_id = ?')
    .get(evenementId, userId);
  return r ? r.role : null;
}

function groupeLecture(req, id, { contenu = false } = {}) {
  const user = acteurOptionnel(req);
  const g = trouver('groupes', id, 'Groupe');
  const role = roleGroupe(g.id, user && user.id);
  if (g.type === 'secret' && !role) throw erreur(404, 'Groupe introuvable');
  if (contenu && g.type !== 'public' && !role) throw erreur(403, 'Réservé aux membres du groupe');
  return { g, user, role };
}

function groupeMembre(req, id) {
  const user = acteur(req);
  const g = trouver('groupes', id, 'Groupe');
  const role = roleGroupe(g.id, user.id);
  if (!role) {
    throw g.type === 'secret' ? erreur(404, 'Groupe introuvable') : erreur(403, 'Réservé aux membres du groupe');
  }
  return { g, user, role };
}

function groupeAdmin(req, id) {
  const r = groupeMembre(req, id);
  if (r.role !== 'admin') throw erreur(403, 'Réservé aux administrateurs du groupe');
  return r;
}

function evenementOuvert(evt) {
  return evt.visibilite === 'public' && evt.statut === 'publie';
}

function evenementLecture(req, id) {
  const user = acteurOptionnel(req);
  const evt = trouver('evenements', id, 'Événement');
  const role = roleEvenement(evt.id, user && user.id);
  if (!evenementOuvert(evt) && !role) throw erreur(404, 'Événement introuvable');
  return { evt, user, role };
}

function evenementMembre(req, id) {
  const user = acteur(req);
  const evt = trouver('evenements', id, 'Événement');
  const role = roleEvenement(evt.id, user.id);
  if (!role) {
    throw evenementOuvert(evt)
      ? erreur(403, "Réservé aux membres de l'événement (utiliser /rejoindre)")
      : erreur(404, 'Événement introuvable');
  }
  return { evt, user, role };
}

function evenementOrga(req, id) {
  const r = evenementMembre(req, id);
  if (r.role !== 'organisateur') throw erreur(403, "Réservé aux organisateurs de l'événement");
  return r;
}

function exigerOption(evt, champ, libelle) {
  if (!evt[champ]) throw erreur(409, `${libelle} : option non activée pour cet événement`);
}

module.exports = {
  trouver,
  acteur,
  acteurOptionnel,
  roleGroupe,
  roleEvenement,
  groupeLecture,
  groupeMembre,
  groupeAdmin,
  evenementOuvert,
  evenementLecture,
  evenementMembre,
  evenementOrga,
  exigerOption,
};
