const { db } = require('./db');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const erreur = (status, message, details) => new HttpError(status, message, details);

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const REGEX_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toId(valeur, nom = 'id') {
  const n = Number(valeur);
  if (valeur === undefined || valeur === '' || !Number.isInteger(n) || n <= 0) {
    throw erreur(400, `${nom} invalide`);
  }
  return n;
}

function nettoyer(valeur, regle) {
  switch (regle.type) {
    case 'string': {
      if (typeof valeur !== 'string') return { erreur: 'doit être une chaîne de caractères' };
      const v = valeur.trim();
      if (!v) return { erreur: 'ne peut pas être vide' };
      if (regle.max && v.length > regle.max) return { erreur: `${regle.max} caractères maximum` };
      return { valeur: v };
    }
    case 'email': {
      if (typeof valeur !== 'string' || !REGEX_EMAIL.test(valeur.trim())) {
        return { erreur: 'email invalide' };
      }
      return { valeur: valeur.trim().toLowerCase() };
    }
    case 'url': {
      try {
        const u = new URL(String(valeur));
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        return { valeur: String(valeur).trim() };
      } catch (e) {
        return { erreur: 'url invalide (http ou https)' };
      }
    }
    case 'date': {
      if (typeof valeur !== 'string' || !REGEX_DATE.test(valeur.trim()) || isNaN(Date.parse(valeur))) {
        return { erreur: 'date invalide (format ISO 8601, ex: 2026-12-31T20:00:00Z)' };
      }
      return { valeur: new Date(valeur.trim()).toISOString() };
    }
    case 'heure': {
      if (typeof valeur !== 'string' || !REGEX_HEURE.test(valeur)) {
        return { erreur: 'heure invalide (format HH:MM)' };
      }
      return { valeur };
    }
    case 'int': {
      if (!Number.isInteger(valeur)) return { erreur: 'doit être un entier' };
      if (regle.min !== undefined && valeur < regle.min) return { erreur: `minimum ${regle.min}` };
      if (regle.max !== undefined && valeur > regle.max) return { erreur: `maximum ${regle.max}` };
      return { valeur };
    }
    case 'nombre': {
      if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return { erreur: 'doit être un nombre' };
      if (regle.min !== undefined && valeur < regle.min) return { erreur: `minimum ${regle.min}` };
      return { valeur };
    }
    case 'bool': {
      if (typeof valeur !== 'boolean') return { erreur: 'doit être true ou false' };
      return { valeur: valeur ? 1 : 0 };
    }
    case 'enum': {
      if (!regle.valeurs.includes(valeur)) return { erreur: `valeurs possibles : ${regle.valeurs.join(', ')}` };
      return { valeur };
    }
    default:
      return { valeur };
  }
}

function valider(corps, champs, partiel = false) {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) {
    throw erreur(400, 'Le corps de la requête doit être un objet JSON');
  }
  const resultat = {};
  const details = [];
  for (const [nom, regle] of Object.entries(champs)) {
    const valeur = corps[nom];
    if (valeur === undefined) {
      if (partiel) continue;
      if (regle.requis) {
        details.push(`${nom} est requis`);
        continue;
      }
      resultat[nom] = regle.defaut !== undefined ? regle.defaut : null;
      continue;
    }
    if (valeur === null) {
      if (regle.requis) {
        details.push(`${nom} est requis`);
        continue;
      }
      resultat[nom] = regle.defaut !== undefined ? regle.defaut : null;
      continue;
    }
    const r = nettoyer(valeur, regle);
    if (r.erreur) details.push(`${nom} : ${r.erreur}`);
    else resultat[nom] = r.valeur;
  }
  if (details.length) throw erreur(400, 'Données invalides', details);
  return resultat;
}

function inserer(table, donnees) {
  const cles = Object.keys(donnees);
  const sql = `INSERT INTO ${table} (${cles.join(', ')}) VALUES (${cles.map((c) => '@' + c).join(', ')})`;
  const info = db.prepare(sql).run(donnees);
  return Number(info.lastInsertRowid);
}

function mettreAJour(table, id, donnees) {
  const cles = Object.keys(donnees);
  if (!cles.length) throw erreur(400, 'Aucun champ à modifier');
  const sql = `UPDATE ${table} SET ${cles.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...donnees, id });
}

function lirePagination(req) {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(page) || page < 1) throw erreur(400, 'page invalide');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw erreur(400, 'limit doit être un entier entre 1 et 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}

function paginer(req, sql, params = []) {
  const { page, limit, offset } = lirePagination(req);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
  const data = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { data, page, limit, total, pages: Math.ceil(total / limit) };
}

function ordonner(req, colonnes, defaut) {
  const cle = req.query.tri === undefined ? defaut : req.query.tri;
  if (!Object.prototype.hasOwnProperty.call(colonnes, cle)) {
    throw erreur(400, `tri invalide (valeurs possibles : ${Object.keys(colonnes).join(', ')})`);
  }
  const ordre = String(req.query.ordre || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(ordre)) throw erreur(400, 'ordre invalide (asc ou desc)');
  return ` ORDER BY ${colonnes[cle]} ${ordre}`;
}

function lireDate(valeur, nom) {
  const r = nettoyer(valeur, { type: 'date' });
  if (r.erreur) throw erreur(400, `${nom} : ${r.erreur}`);
  return r.valeur;
}

function listeIds(valeur, nom) {
  if (valeur === undefined || valeur === null) return [];
  if (!Array.isArray(valeur) || valeur.some((v) => !Number.isInteger(v) || v <= 0)) {
    throw erreur(400, `${nom} doit être un tableau d'identifiants`);
  }
  if (valeur.length > 500) throw erreur(400, `${nom} : 500 éléments maximum`);
  return [...new Set(valeur)];
}

function utilisateursInconnus(ids) {
  const requete = db.prepare('SELECT 1 FROM users WHERE id = ?');
  return ids.filter((id) => !requete.get(id));
}

function bools(ligne, champs) {
  if (!ligne) return ligne;
  const copie = { ...ligne };
  for (const c of champs) if (c in copie) copie[c] = !!copie[c];
  return copie;
}

function motif(valeur) {
  return valeur === undefined ? null : `%${String(valeur)}%`;
}

module.exports = {
  HttpError,
  erreur,
  toId,
  valider,
  inserer,
  mettreAJour,
  paginer,
  ordonner,
  lireDate,
  listeIds,
  utilisateursInconnus,
  bools,
  motif,
};
