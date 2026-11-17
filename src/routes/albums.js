const express = require('express');
const { db } = require('../db');
const { erreur, toId, valider, inserer, mettreAJour, paginer, ordonner } = require('../utils');
const { trouver, evenementLecture, evenementMembre, evenementOrga } = require('../droits');

const router = express.Router();

const champsAlbum = {
  titre: { type: 'string', requis: true, max: 150 },
  description: { type: 'string', max: 1000 },
};
const champsPhoto = {
  url: { type: 'url', requis: true },
  legende: { type: 'string', max: 300 },
};
const champsCommentaire = { contenu: { type: 'string', requis: true, max: 2000 } };

function contexteAlbum(req, albumId, mode) {
  const album = trouver('albums', albumId, 'Album');
  const fonction = mode === 'orga' ? evenementOrga : mode === 'membre' ? evenementMembre : evenementLecture;
  return { album, ...fonction(req, album.evenement_id) };
}

function contextePhoto(req, photoId, mode) {
  const photo = trouver('photos', photoId, 'Photo');
  return { photo, ...contexteAlbum(req, photo.album_id, mode) };
}

function contexteCommentairePhoto(req, id, mode) {
  const commentaire = trouver('commentaires_photos', id, 'Commentaire');
  return { commentaire, ...contextePhoto(req, commentaire.photo_id, mode) };
}

router.post('/evenements/:id/albums', (req, res) => {
  const { evt } = evenementOrga(req, toId(req.params.id));
  const donnees = valider(req.body, champsAlbum);
  const id = inserer('albums', { ...donnees, evenement_id: evt.id });
  res.status(201).location(`/albums/${id}`).json(trouver('albums', id, 'Album'));
});

router.get('/evenements/:id/albums', (req, res) => {
  const { evt } = evenementLecture(req, toId(req.params.id));
  const sql =
    `SELECT a.*, (SELECT COUNT(*) FROM photos WHERE album_id = a.id) AS nb_photos
     FROM albums a WHERE a.evenement_id = ?` + ordonner(req, { created_at: 'a.created_at', titre: 'a.titre' }, 'created_at');
  res.json(paginer(req, sql, [evt.id]));
});

router.get('/albums/:id', (req, res) => {
  const { album } = contexteAlbum(req, toId(req.params.id), 'lecture');
  const nb = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(album.id).n;
  res.json({ ...album, nb_photos: nb });
});

function modifierAlbum(partiel) {
  return (req, res) => {
    const { album } = contexteAlbum(req, toId(req.params.id), 'orga');
    mettreAJour('albums', album.id, valider(req.body, champsAlbum, partiel));
    res.json(trouver('albums', album.id, 'Album'));
  };
}

router.put('/albums/:id', modifierAlbum(false));
router.patch('/albums/:id', modifierAlbum(true));

router.delete('/albums/:id', (req, res) => {
  const { album } = contexteAlbum(req, toId(req.params.id), 'orga');
  db.prepare('DELETE FROM albums WHERE id = ?').run(album.id);
  res.status(204).end();
});

router.post('/albums/:id/photos', (req, res) => {
  const { album, user } = contexteAlbum(req, toId(req.params.id), 'membre');
  const donnees = valider(req.body, champsPhoto);
  const id = inserer('photos', { ...donnees, album_id: album.id, user_id: user.id });
  res.status(201).location(`/photos/${id}`).json(trouver('photos', id, 'Photo'));
});

router.get('/albums/:id/photos', (req, res) => {
  const { album } = contexteAlbum(req, toId(req.params.id), 'lecture');
  let filtre = null;
  if (req.query.user_id !== undefined) filtre = toId(req.query.user_id, 'user_id');
  const sql =
    `SELECT p.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom,
       (SELECT COUNT(*) FROM commentaires_photos WHERE photo_id = p.id) AS nb_commentaires
     FROM photos p JOIN users u ON u.id = p.user_id
     WHERE p.album_id = ? AND (? IS NULL OR p.user_id = ?)` + ordonner(req, { created_at: 'p.created_at' }, 'created_at');
  res.json(paginer(req, sql, [album.id, filtre, filtre]));
});

router.get('/photos/:id', (req, res) => {
  const { photo } = contextePhoto(req, toId(req.params.id), 'lecture');
  const nb = db.prepare('SELECT COUNT(*) AS n FROM commentaires_photos WHERE photo_id = ?').get(photo.id).n;
  res.json({ ...photo, nb_commentaires: nb });
});

function modifierPhoto(partiel) {
  return (req, res) => {
    const { photo, user } = contextePhoto(req, toId(req.params.id), 'membre');
    if (photo.user_id !== user.id) throw erreur(403, "Seul l'auteur de la photo peut la modifier");
    mettreAJour('photos', photo.id, valider(req.body, champsPhoto, partiel));
    res.json(trouver('photos', photo.id, 'Photo'));
  };
}

router.put('/photos/:id', modifierPhoto(false));
router.patch('/photos/:id', modifierPhoto(true));

router.delete('/photos/:id', (req, res) => {
  const { photo, user, role } = contextePhoto(req, toId(req.params.id), 'membre');
  if (photo.user_id !== user.id && role !== 'organisateur') {
    throw erreur(403, "Réservé à l'auteur de la photo ou aux organisateurs");
  }
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  res.status(204).end();
});

router.get('/photos/:id/commentaires', (req, res) => {
  const { photo } = contextePhoto(req, toId(req.params.id), 'lecture');
  const sql =
    `SELECT c.id, c.photo_id, c.contenu, c.created_at, c.updated_at, u.id AS auteur_id, u.nom AS auteur_nom, u.prenom AS auteur_prenom
     FROM commentaires_photos c JOIN users u ON u.id = c.user_id WHERE c.photo_id = ?` +
    ordonner(req, { created_at: 'c.created_at' }, 'created_at');
  res.json(paginer(req, sql, [photo.id]));
});

router.post('/photos/:id/commentaires', (req, res) => {
  const { photo, user } = contextePhoto(req, toId(req.params.id), 'membre');
  const donnees = valider(req.body, champsCommentaire);
  const id = inserer('commentaires_photos', { ...donnees, photo_id: photo.id, user_id: user.id });
  res.status(201).location(`/commentaires-photos/${id}`).json(trouver('commentaires_photos', id, 'Commentaire'));
});

router.get('/commentaires-photos/:id', (req, res) => {
  const { commentaire } = contexteCommentairePhoto(req, toId(req.params.id), 'lecture');
  res.json(commentaire);
});

function modifierCommentaire(partiel) {
  return (req, res) => {
    const { commentaire, user } = contexteCommentairePhoto(req, toId(req.params.id), 'membre');
    if (commentaire.user_id !== user.id) throw erreur(403, "Seul l'auteur peut modifier son commentaire");
    const donnees = valider(req.body, champsCommentaire, partiel);
    mettreAJour('commentaires_photos', commentaire.id, { ...donnees, updated_at: new Date().toISOString() });
    res.json(trouver('commentaires_photos', commentaire.id, 'Commentaire'));
  };
}

router.put('/commentaires-photos/:id', modifierCommentaire(false));
router.patch('/commentaires-photos/:id', modifierCommentaire(true));

router.delete('/commentaires-photos/:id', (req, res) => {
  const { commentaire, user, role } = contexteCommentairePhoto(req, toId(req.params.id), 'membre');
  if (commentaire.user_id !== user.id && role !== 'organisateur') {
    throw erreur(403, "Réservé à l'auteur ou aux organisateurs");
  }
  db.prepare('DELETE FROM commentaires_photos WHERE id = ?').run(commentaire.id);
  res.status(204).end();
});

module.exports = router;
