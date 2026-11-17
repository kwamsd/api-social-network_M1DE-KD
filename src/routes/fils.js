const express = require('express');
const { db } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner, motif } = require('../utils');
const { acteur, trouver, groupeLecture, groupeMembre, evenementLecture, evenementMembre } = require('../droits');

const router = express.Router();

const champsFil = { titre: { type: 'string', requis: true, max: 200 } };
const champsTexte = { contenu: { type: 'string', requis: true, max: 5000 } };

function contexteFil(req, filId, ecriture) {
  const fil = trouver('fils', filId, 'Fil de discussion');
  if (fil.groupe_id) {
    const r = ecriture ? groupeMembre(req, fil.groupe_id) : groupeLecture(req, fil.groupe_id, { contenu: true });
    return {
      fil,
      user: r.user,
      admin: r.role === 'admin',
      peutPublier: r.role === 'admin' || (r.role === 'membre' && !!r.g.membres_peuvent_publier),
    };
  }
  const r = ecriture ? evenementMembre(req, fil.evenement_id) : evenementLecture(req, fil.evenement_id);
  return { fil, user: r.user, admin: r.role === 'organisateur', peutPublier: !!r.role };
}

function contexteMessage(req, messageId, ecriture) {
  const message = trouver('messages', messageId, 'Message');
  return { message, ...contexteFil(req, message.fil_id, ecriture) };
}

function contexteCommentaire(req, commentaireId, ecriture) {
  const commentaire = trouver('commentaires', commentaireId, 'Commentaire');
  return { commentaire, ...contexteMessage(req, commentaire.message_id, ecriture) };
}

router.post('/fils', (req, res) => {
  const acteurCourant = acteur(req);
  const donnees = valider(req.body, champsFil);
  const { groupe_id, evenement_id } = req.body;
  if ((groupe_id === undefined) === (evenement_id === undefined)) {
    throw erreur(400, 'Un fil doit être lié à un groupe OU à un événement (un seul des deux)');
  }
  if (groupe_id !== undefined) donnees.groupe_id = toId(groupe_id, 'groupe_id');
  else donnees.evenement_id = toId(evenement_id, 'evenement_id');
  donnees.createur_id = acteurCourant.id;

  if (donnees.groupe_id) {
    const g = trouver('groupes', donnees.groupe_id, 'Groupe');
    const r = groupeMembre(req, g.id);
    if (r.role !== 'admin' && !g.membres_peuvent_publier) {
      throw erreur(403, 'Les membres ne sont pas autorisés à publier dans ce groupe');
    }
  } else {
    evenementMembre(req, donnees.evenement_id);
  }
  const id = inserer('fils', donnees);
  res.status(201).location(`/fils/${id}`).json(trouver('fils', id, 'Fil de discussion'));
});

router.get('/fils', (req, res) => {
  const { groupe_id, evenement_id } = req.query;
  if ((groupe_id === undefined) === (evenement_id === undefined)) {
    throw erreur(400, 'Préciser groupe_id OU evenement_id en paramètre');
  }
  let colonne;
  let id;
  if (groupe_id !== undefined) {
    id = toId(groupe_id, 'groupe_id');
    groupeLecture(req, id, { contenu: true });
    colonne = 'groupe_id';
  } else {
    id = toId(evenement_id, 'evenement_id');
    evenementLecture(req, id);
    colonne = 'evenement_id';
  }
  const sql =
    `SELECT f.*, (SELECT COUNT(*) FROM messages WHERE fil_id = f.id) AS nb_messages
     FROM fils f WHERE f.${colonne} = ?` + ordonner(req, { created_at: 'f.created_at', titre: 'f.titre' }, 'created_at');
  res.json(paginer(req, sql, [id]));
});

router.get('/fils/:id', (req, res) => {
  const { fil } = contexteFil(req, toId(req.params.id), false);
  const nb = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE fil_id = ?').get(fil.id).n;
  res.json({ ...fil, nb_messages: nb });
});

function modifierFil(partiel) {
  return (req, res) => {
    const { fil, user, admin } = contexteFil(req, toId(req.params.id), true);
    if (!admin && fil.createur_id !== user.id) throw erreur(403, 'Réservé au créateur du fil ou aux administrateurs');
    mettreAJour('fils', fil.id, valider(req.body, champsFil, partiel));
    res.json(trouver('fils', fil.id, 'Fil de discussion'));
  };
}

router.put('/fils/:id', modifierFil(false));
router.patch('/fils/:id', modifierFil(true));

router.delete('/fils/:id', (req, res) => {
  const { fil, user, admin } = contexteFil(req, toId(req.params.id), true);
  if (!admin && fil.createur_id !== user.id) throw erreur(403, 'Réservé au créateur du fil ou aux administrateurs');
  db.prepare('DELETE FROM fils WHERE id = ?').run(fil.id);
  res.status(204).end();
});

router.get('/fils/:id/messages', (req, res) => {
  const { fil } = contexteFil(req, toId(req.params.id), false);
  const q = motif(req.query.q);
  const sql =
    `SELECT m.id, m.fil_id, m.contenu, m.created_at, m.updated_at, u.id AS auteur_id, u.nom AS auteur_nom, u.prenom AS auteur_prenom,
       (SELECT COUNT(*) FROM commentaires WHERE message_id = m.id) AS nb_commentaires
     FROM messages m JOIN users u ON u.id = m.user_id
     WHERE m.fil_id = ? AND (? IS NULL OR m.contenu LIKE ?)` +
    ordonner(req, { created_at: 'm.created_at' }, 'created_at');
  res.json(paginer(req, sql, [fil.id, q, q]));
});

router.post('/fils/:id/messages', (req, res) => {
  const { fil, user, peutPublier } = contexteFil(req, toId(req.params.id), true);
  if (!peutPublier) throw erreur(403, 'Vous ne pouvez pas publier dans ce groupe');
  const donnees = valider(req.body, champsTexte);
  const id = inserer('messages', { ...donnees, fil_id: fil.id, user_id: user.id });
  res.status(201).location(`/messages/${id}`).json(trouver('messages', id, 'Message'));
});

router.get('/messages/:id', (req, res) => {
  const { message } = contexteMessage(req, toId(req.params.id), false);
  const nb = db.prepare('SELECT COUNT(*) AS n FROM commentaires WHERE message_id = ?').get(message.id).n;
  res.json({ ...message, nb_commentaires: nb });
});

function modifierTexte(table, lecture, cle) {
  return (partiel) => (req, res) => {
    const ctx = lecture(req, toId(req.params.id), true);
    const objet = ctx[cle];
    if (objet.user_id !== ctx.user.id) throw erreur(403, 'Vous ne pouvez modifier que vos propres contenus');
    const donnees = valider(req.body, champsTexte, partiel);
    mettreAJour(table, objet.id, { ...donnees, updated_at: new Date().toISOString() });
    res.json(trouver(table, objet.id, 'Contenu'));
  };
}

function supprimerTexte(table, lecture, cle) {
  return (req, res) => {
    const ctx = lecture(req, toId(req.params.id), true);
    const objet = ctx[cle];
    if (objet.user_id !== ctx.user.id && !ctx.admin) {
      throw erreur(403, "Réservé à l'auteur ou aux administrateurs/organisateurs");
    }
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(objet.id);
    res.status(204).end();
  };
}

const modifierMessage = modifierTexte('messages', contexteMessage, 'message');
router.put('/messages/:id', modifierMessage(false));
router.patch('/messages/:id', modifierMessage(true));
router.delete('/messages/:id', supprimerTexte('messages', contexteMessage, 'message'));

router.get('/messages/:id/commentaires', (req, res) => {
  const { message } = contexteMessage(req, toId(req.params.id), false);
  const sql =
    `SELECT c.id, c.message_id, c.contenu, c.created_at, c.updated_at, u.id AS auteur_id, u.nom AS auteur_nom, u.prenom AS auteur_prenom
     FROM commentaires c JOIN users u ON u.id = c.user_id WHERE c.message_id = ?` +
    ordonner(req, { created_at: 'c.created_at' }, 'created_at');
  res.json(paginer(req, sql, [message.id]));
});

router.post('/messages/:id/commentaires', (req, res) => {
  const { message, user } = contexteMessage(req, toId(req.params.id), true);
  const donnees = valider(req.body, champsTexte);
  const id = inserer('commentaires', { ...donnees, message_id: message.id, user_id: user.id });
  res.status(201).location(`/commentaires/${id}`).json(trouver('commentaires', id, 'Commentaire'));
});

router.get('/commentaires/:id', (req, res) => {
  const { commentaire } = contexteCommentaire(req, toId(req.params.id), false);
  res.json(commentaire);
});

const modifierCommentaire = modifierTexte('commentaires', contexteCommentaire, 'commentaire');
router.put('/commentaires/:id', modifierCommentaire(false));
router.patch('/commentaires/:id', modifierCommentaire(true));
router.delete('/commentaires/:id', supprimerTexte('commentaires', contexteCommentaire, 'commentaire'));

module.exports = router;
