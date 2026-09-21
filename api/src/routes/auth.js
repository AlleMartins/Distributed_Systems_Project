// Rotte di registrazione e login.
// Ogni modulo di rotte esporta una factory che riceve le dipendenze e
// restituisce un Router con i path COMPLETI ('/auth/register', non
// '/register'): index.js li monta tutti sullo stesso apiRouter, quindi gli
// URL restano identici a prima e non c'è nessun calcolo di prefissi da
// tenere allineato fra file.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret, JWT_EXPIRES_IN, BCRYPT_SALT_ROUNDS } = require('../config');

const createAuthRouter = (db) => {
  const router = express.Router();

  router.post('/auth/register', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || typeof username !== 'string' || !username.trim()) {
        return res.status(400).json({ error: 'Username mancante' });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri' });
      }

      const normalizedUsername = username.trim();
      const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

      try {
        await db.collection('users').insertOne({
          username: normalizedUsername,
          passwordHash,
          createdAt: new Date()
        });
      } catch (err) {
        // L'unicità è garantita dall'indice, non da un controllo
        // applicativo: con più repliche API due registrazioni concorrenti
        // dello stesso username passerebbero entrambe un check "esiste già?".
        if (err.code === 11000) {
          return res.status(409).json({ error: 'Username già in uso' });
        }
        throw err;
      }

      res.status(201).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username e password sono obbligatori' });
      }

      const user = await db.collection('users').findOne({ username: username.trim() });
      // Stesso messaggio di errore sia per utente inesistente sia per
      // password errata: evita di rivelare quali username sono registrati.
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Credenziali non valide' });
      }

      const token = jwt.sign({ sub: user.username }, jwtSecret, { expiresIn: JWT_EXPIRES_IN });
      res.status(200).json({ token, username: user.username });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

module.exports = { createAuthRouter };
