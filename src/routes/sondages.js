const express = require('express');
const { db, transaction } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner } = require('../utils');
const { trouver, evenementLecture, evenementMembre, evenementOrga } = require('../droits');

const router = express.Router();

const champsSondage = { titre: { type: 'string', requis: true, max: 200 } };

function contexteSondage(req, sondageId, mode) {
  const sondage = trouver('sondages', sondageId, 'Sondage');
  const fonction = mode === 'orga' ? evenementOrga : mode === 'membre' ? evenementMembre : evenementLecture;
  return { sondage, ...fonction(req, sondage.evenement_id) };
}

function lireQuestion(brut, position) {
  const prefixe = `questions[${position}]`;
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) {
    throw erreur(400, `${prefixe} doit être un objet { intitule, choix }`);
  }
  const { intitule } = valider(brut, { intitule: { type: 'string', requis: true, max: 300 } });
  if (!Array.isArray(brut.choix) || brut.choix.length < 2 || brut.choix.length > 10) {
    throw erreur(400, `${prefixe}.choix doit contenir entre 2 et 10 réponses possibles`);
  }
  const choix = brut.choix.map((c) => {
    if (typeof c !== 'string' || !c.trim() || c.length > 200) {
      throw erreur(400, `${prefixe}.choix : chaque réponse doit être un texte non vide (200 caractères max)`);
    }
    return c.trim();
  });
  const uniques = new Set(choix.map((c) => c.toLowerCase()));
  if (uniques.size !== choix.length) throw erreur(400, `${prefixe}.choix : réponses en double`);
  return { intitule, choix };
}

function ajouterQuestion(sondageId, question) {
  const questionId = inserer('questions', { sondage_id: sondageId, intitule: question.intitule });
  const ajout = db.prepare('INSERT INTO choix (question_id, libelle) VALUES (?, ?)');
  for (const c of question.choix) ajout.run(questionId, c);
  return questionId;
}

function detailSondage(id) {
  const sondage = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(DISTINCT user_id) FROM votes v JOIN questions q ON q.id = v.question_id WHERE q.sondage_id = s.id) AS nb_votants
       FROM sondages s WHERE s.id = ?`
    )
    .get(id);
  const questions = db.prepare('SELECT id, intitule FROM questions WHERE sondage_id = ? ORDER BY id').all(id);
  const choix = db.prepare('SELECT id, libelle FROM choix WHERE question_id = ? ORDER BY id');
  return { ...sondage, questions: questions.map((q) => ({ ...q, choix: choix.all(q.id) })) };
}

router.post('/evenements/:id/sondages', (req, res) => {
  const { evt, user } = evenementOrga(req, toId(req.params.id));
  const donnees = valider(req.body, champsSondage);
  if (!Array.isArray(req.body.questions) || req.body.questions.length < 1 || req.body.questions.length > 20) {
    throw erreur(400, 'Un sondage doit contenir entre 1 et 20 questions');
  }
  const questions = req.body.questions.map((q, i) => lireQuestion(q, i));
  const id = transaction(() => {
    const sondageId = inserer('sondages', { ...donnees, evenement_id: evt.id, createur_id: user.id });
    for (const q of questions) ajouterQuestion(sondageId, q);
    return sondageId;
  });
  res.status(201).location(`/sondages/${id}`).json(detailSondage(id));
});

router.get('/evenements/:id/sondages', (req, res) => {
  const { evt } = evenementLecture(req, toId(req.params.id));
  const sql =
    `SELECT s.*, (SELECT COUNT(*) FROM questions WHERE sondage_id = s.id) AS nb_questions
     FROM sondages s WHERE s.evenement_id = ?` + ordonner(req, { created_at: 's.created_at', titre: 's.titre' }, 'created_at');
  res.json(paginer(req, sql, [evt.id]));
});

router.get('/sondages/:id', (req, res) => {
  const { sondage } = contexteSondage(req, toId(req.params.id), 'lecture');
  res.json(detailSondage(sondage.id));
});

function modifierSondage(partiel) {
  return (req, res) => {
    const { sondage } = contexteSondage(req, toId(req.params.id), 'orga');
    mettreAJour('sondages', sondage.id, valider(req.body, champsSondage, partiel));
    res.json(detailSondage(sondage.id));
  };
}

router.put('/sondages/:id', modifierSondage(false));
router.patch('/sondages/:id', modifierSondage(true));

router.delete('/sondages/:id', (req, res) => {
  const { sondage } = contexteSondage(req, toId(req.params.id), 'orga');
  db.prepare('DELETE FROM sondages WHERE id = ?').run(sondage.id);
  res.status(204).end();
});

router.post('/sondages/:id/questions', (req, res) => {
  const { sondage } = contexteSondage(req, toId(req.params.id), 'orga');
  const nb = db.prepare('SELECT COUNT(*) AS n FROM questions WHERE sondage_id = ?').get(sondage.id).n;
  if (nb >= 20) throw erreur(409, 'Un sondage ne peut pas dépasser 20 questions');
  const question = lireQuestion(req.body, 0);
  transaction(() => ajouterQuestion(sondage.id, question));
  res.status(201).json(detailSondage(sondage.id));
});

router.delete('/sondages/:id/questions/:questionId', (req, res) => {
  const { sondage } = contexteSondage(req, toId(req.params.id), 'orga');
  const questionId = toId(req.params.questionId, 'questionId');
  const question = db.prepare('SELECT * FROM questions WHERE id = ? AND sondage_id = ?').get(questionId, sondage.id);
  if (!question) throw erreur(404, 'Question introuvable dans ce sondage');
  const nb = db.prepare('SELECT COUNT(*) AS n FROM questions WHERE sondage_id = ?').get(sondage.id).n;
  if (nb === 1) throw erreur(409, 'Un sondage doit garder au moins une question');
  db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
  res.status(204).end();
});

function lireReponses(sondageId, corps) {
  if (!corps || !Array.isArray(corps.reponses) || corps.reponses.length === 0) {
    throw erreur(400, 'reponses doit être un tableau [{ question_id, choix_id }]');
  }
  const questions = db.prepare('SELECT id FROM questions WHERE sondage_id = ?').all(sondageId).map((q) => q.id);
  const vues = new Set();
  const reponses = corps.reponses.map((r, i) => {
    if (!r || !Number.isInteger(r.question_id) || !Number.isInteger(r.choix_id)) {
      throw erreur(400, `reponses[${i}] doit contenir question_id et choix_id (entiers)`);
    }
    if (!questions.includes(r.question_id)) throw erreur(400, `reponses[${i}] : question ${r.question_id} absente de ce sondage`);
    if (vues.has(r.question_id)) throw erreur(400, `reponses[${i}] : une seule réponse possible par question`);
    vues.add(r.question_id);
    const choix = db.prepare('SELECT id FROM choix WHERE id = ? AND question_id = ?').get(r.choix_id, r.question_id);
    if (!choix) throw erreur(400, `reponses[${i}] : le choix ${r.choix_id} n'appartient pas à la question ${r.question_id}`);
    return r;
  });
  if (vues.size !== questions.length) throw erreur(400, 'Il faut répondre à toutes les questions du sondage');
  return reponses;
}

function aVote(sondageId, userId) {
  return !!db
    .prepare('SELECT 1 FROM votes v JOIN questions q ON q.id = v.question_id WHERE q.sondage_id = ? AND v.user_id = ?')
    .get(sondageId, userId);
}

function supprimerVotes(sondageId, userId) {
  db.prepare('DELETE FROM votes WHERE user_id = ? AND question_id IN (SELECT id FROM questions WHERE sondage_id = ?)').run(
    userId,
    sondageId
  );
}

function enregistrerVotes(sondageId, userId, reponses) {
  const ajout = db.prepare('INSERT INTO votes (question_id, choix_id, user_id) VALUES (?, ?, ?)');
  transaction(() => {
    supprimerVotes(sondageId, userId);
    for (const r of reponses) ajout.run(r.question_id, r.choix_id, userId);
  });
}

function mesReponses(sondageId, userId) {
  return db
    .prepare(
      `SELECT v.question_id, v.choix_id FROM votes v JOIN questions q ON q.id = v.question_id
       WHERE q.sondage_id = ? AND v.user_id = ? ORDER BY v.question_id`
    )
    .all(sondageId, userId);
}

router.post('/sondages/:id/reponses', (req, res) => {
  const { sondage, user } = contexteSondage(req, toId(req.params.id), 'membre');
  if (aVote(sondage.id, user.id)) throw erreur(409, 'Vous avez déjà répondu à ce sondage (utiliser PUT pour modifier)');
  const reponses = lireReponses(sondage.id, req.body);
  enregistrerVotes(sondage.id, user.id, reponses);
  res.status(201).json({ sondage_id: sondage.id, user_id: user.id, reponses: mesReponses(sondage.id, user.id) });
});

router.put('/sondages/:id/reponses', (req, res) => {
  const { sondage, user } = contexteSondage(req, toId(req.params.id), 'membre');
  if (!aVote(sondage.id, user.id)) throw erreur(404, "Vous n'avez pas encore répondu à ce sondage");
  const reponses = lireReponses(sondage.id, req.body);
  enregistrerVotes(sondage.id, user.id, reponses);
  res.json({ sondage_id: sondage.id, user_id: user.id, reponses: mesReponses(sondage.id, user.id) });
});

router.delete('/sondages/:id/reponses', (req, res) => {
  const { sondage, user } = contexteSondage(req, toId(req.params.id), 'membre');
  if (!aVote(sondage.id, user.id)) throw erreur(404, "Vous n'avez pas encore répondu à ce sondage");
  supprimerVotes(sondage.id, user.id);
  res.status(204).end();
});

router.get('/sondages/:id/reponses/moi', (req, res) => {
  const { sondage, user } = contexteSondage(req, toId(req.params.id), 'membre');
  res.json({ sondage_id: sondage.id, user_id: user.id, reponses: mesReponses(sondage.id, user.id) });
});

router.get('/sondages/:id/resultats', (req, res) => {
  const { sondage } = contexteSondage(req, toId(req.params.id), 'lecture');
  const questions = db.prepare('SELECT id, intitule FROM questions WHERE sondage_id = ? ORDER BY id').all(sondage.id);
  const choix = db.prepare(
    `SELECT c.id, c.libelle, (SELECT COUNT(*) FROM votes WHERE choix_id = c.id) AS nb_votes
     FROM choix c WHERE c.question_id = ? ORDER BY c.id`
  );
  const resultats = questions.map((q) => {
    const liste = choix.all(q.id);
    const total = liste.reduce((somme, c) => somme + c.nb_votes, 0);
    return {
      question_id: q.id,
      intitule: q.intitule,
      total_votes: total,
      choix: liste.map((c) => ({ ...c, pourcentage: total ? Math.round((c.nb_votes / total) * 1000) / 10 : 0 })),
    };
  });
  const votants = db
    .prepare('SELECT COUNT(DISTINCT v.user_id) AS n FROM votes v JOIN questions q ON q.id = v.question_id WHERE q.sondage_id = ?')
    .get(sondage.id).n;
  res.json({ sondage_id: sondage.id, titre: sondage.titre, nb_votants: votants, resultats });
});

module.exports = router;
