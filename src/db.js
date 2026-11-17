const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const fichier = process.env.DB_FILE || path.join(__dirname, '..', 'data.db');
const db = new DatabaseSync(fichier);

db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  telephone TEXT,
  ville TEXT,
  photo_profil TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS groupes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  description TEXT,
  icone TEXT,
  photo_couverture TEXT,
  type TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public', 'prive', 'secret')),
  membres_peuvent_publier INTEGER NOT NULL DEFAULT 1,
  membres_peuvent_creer_evenements INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS groupe_membres (
  groupe_id INTEGER NOT NULL REFERENCES groupes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'membre' CHECK (role IN ('admin', 'membre')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (groupe_id, user_id)
);

CREATE TABLE IF NOT EXISTS evenements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  description TEXT,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  lieu TEXT NOT NULL,
  photo_couverture TEXT,
  visibilite TEXT NOT NULL DEFAULT 'public' CHECK (visibilite IN ('public', 'prive')),
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publie')),
  groupe_id INTEGER REFERENCES groupes(id) ON DELETE SET NULL,
  createur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  billetterie_active INTEGER NOT NULL DEFAULT 0,
  shopping_active INTEGER NOT NULL DEFAULT 0,
  covoiturage_actif INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS evenement_membres (
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('organisateur', 'participant')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (evenement_id, user_id)
);

CREATE TABLE IF NOT EXISTS fils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupe_id INTEGER REFERENCES groupes(id) ON DELETE CASCADE,
  evenement_id INTEGER REFERENCES evenements(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  createur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK ((groupe_id IS NOT NULL AND evenement_id IS NULL) OR (groupe_id IS NULL AND evenement_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fil_id INTEGER NOT NULL REFERENCES fils(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contenu TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS commentaires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contenu TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  titre TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  legende TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS commentaires_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contenu TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sondages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  createur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  titre TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sondage_id INTEGER NOT NULL REFERENCES sondages(id) ON DELETE CASCADE,
  intitule TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS choix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  libelle TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  choix_id INTEGER NOT NULL REFERENCES choix(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS types_billets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  montant REAL NOT NULL,
  quantite INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS billets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type_billet_id INTEGER NOT NULL REFERENCES types_billets(id) ON DELETE CASCADE,
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT NOT NULL,
  adresse TEXT NOT NULL,
  code_postal TEXT NOT NULL,
  ville TEXT NOT NULL,
  pays TEXT NOT NULL,
  date_achat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (evenement_id, email)
);

CREATE TABLE IF NOT EXISTS shopping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nom TEXT NOT NULL COLLATE NOCASE,
  quantite INTEGER NOT NULL,
  heure_arrivee TEXT NOT NULL,
  UNIQUE (evenement_id, nom)
);

CREATE TABLE IF NOT EXISTS covoiturages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lieu_depart TEXT NOT NULL,
  heure_depart TEXT NOT NULL,
  prix REAL NOT NULL,
  places INTEGER NOT NULL,
  ecart_max_minutes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (evenement_id, user_id)
);

CREATE TABLE IF NOT EXISTS covoiturage_passagers (
  covoiturage_id INTEGER NOT NULL REFERENCES covoiturages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (covoiturage_id, user_id)
);
`);

function transaction(fonction) {
  db.exec('BEGIN');
  try {
    const resultat = fonction();
    db.exec('COMMIT');
    return resultat;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, transaction };
