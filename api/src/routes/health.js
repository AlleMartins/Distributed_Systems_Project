// Probe di liveness e readiness.
// - livenessProbe: shallow, verifica solo che Express risponda. Un
//   disservizio temporaneo di una dipendenza non deve causare riavvii.
// - readinessProbe: deep. Oltre a Mongo e Redis verifica anche il change
//   stream: un pod che non riceve più eventi serve dati fermi al momento
//   dell'idratazione, quindi è meglio che esca dal Service (senza essere
//   riavviato) e rientri quando si è ripristinato.
//
// `isChangeStreamHealthy` arriva come funzione e non come booleano: un
// booleano verrebbe copiato al momento del wiring e resterebbe congelato
// al suo valore iniziale, rendendo la readiness cieca proprio al guasto
// che deve rilevare.
const express = require('express');

const createHealthRouter = ({ db, pubClient, isChangeStreamHealthy }) => {
  const router = express.Router();

  router.get('/health', (req, res) => res.status(200).send('OK'));

  router.get('/ready', async (req, res) => {
    try {
      await db.command({ ping: 1 });
      await pubClient.ping();
      if (!isChangeStreamHealthy()) {
        return res.status(503).json({ status: 'not ready', error: 'change stream non attivo' });
      }
      res.status(200).json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', error: err.message });
    }
  });

  return router;
};

module.exports = { createHealthRouter };
