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
