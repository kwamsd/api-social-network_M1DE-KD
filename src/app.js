const express = require('express');
const { HttpError } = require('./utils');

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({
    nom: 'My Social Networks API',
    version: '1.0.0',
    message: "API en ligne. Voir le README et la collection Postman pour la liste des routes.",
  });
});

app.get('/sante', (req, res) => {
  res.json({ statut: 'ok', date: new Date().toISOString() });
});

app.use(require('./routes/utilisateurs'));
app.use(require('./routes/groupes'));
app.use(require('./routes/evenements'));
app.use(require('./routes/fils'));
app.use(require('./routes/albums'));
app.use(require('./routes/sondages'));
app.use(require('./routes/billetterie'));

app.use((req, res) => {
  res.status(404).json({ erreur: `Route ${req.method} ${req.originalUrl} introuvable` });
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    const corps = { erreur: err.message };
    if (err.details) corps.details = err.details;
    return res.status(err.status).json(corps);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erreur: 'JSON invalide dans le corps de la requête' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ erreur: 'Corps de la requête trop volumineux' });
  }
  if (typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ erreur: 'Cette ressource existe déjà' });
  }
  if (typeof err.message === 'string' && err.message.includes('FOREIGN KEY constraint failed')) {
    return res.status(409).json({ erreur: 'Opération impossible : ressource liée inexistante ou encore utilisée' });
  }
  console.error(err);
  res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

module.exports = app;
