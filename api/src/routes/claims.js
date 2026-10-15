const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../auth');
const { createResolveIncidentId } = require('../resolve-incident-id');
const { RENEW_LOCK_SCRIPT, RELEASE_LOCK_SCRIPT } = require('../lua-scripts');
const { CLAIM_TTL, lockKeyFor } = require('../config');

const createClaimsRouter = ({ db, pubClient, io }) => {
  const router = express.Router();
  const resolveIncidentId = createResolveIncidentId(db);

  const rifiutaSeChiuso = async (id, lockKey, username, res) => {
    const incidente = await db.collection('incidents').findOne(
      { _id: new ObjectId(id) },
      { projection: { status: 1 } }
    );
    if (incidente && incidente.status !== 'closed') return false;
    await pubClient.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [username] });
    res.status(409).json({ error: 'Incidente già risolto: non si può prendere in carico', status: 'closed' });
    return true;
  };

  router.post('/incidents/:id/claim', authenticate, async (req, res) => {
    try {
      const id = await resolveIncidentId(req.params.id, res);
      if (!id) return;
      const username = req.user.username;
      const lockKey = lockKeyFor(id);

      const acquired = await pubClient.set(lockKey, username, { NX: true, PX: CLAIM_TTL });

      if (acquired) {
        if (await rifiutaSeChiuso(id, lockKey, username, res)) return;
        io.emit('incident_locked', { id, lockedBy: username, ttl: CLAIM_TTL });
        return res.status(200).json({ success: true, lockedBy: username, ttl: CLAIM_TTL });
      }

      const renewed = await pubClient.eval(RENEW_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [username, String(CLAIM_TTL)]
      });

      if (renewed !== 0) {
        if (await rifiutaSeChiuso(id, lockKey, username, res)) return;
        io.emit('incident_locked', { id, lockedBy: username, ttl: CLAIM_TTL });
        return res.status(200).json({ success: true, lockedBy: username, ttl: CLAIM_TTL });
      }

      const currentOwner = await pubClient.get(lockKey);
      res.status(409).json({ error: 'Conflitto', message: 'Incidente già preso in carico', lockedBy: currentOwner });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  router.delete('/incidents/:id/claim', authenticate, async (req, res) => {
    try {
      const id = await resolveIncidentId(req.params.id, res);
      if (!id) return;
      const username = req.user.username;
      const lockKey = lockKeyFor(id);
      const released = await pubClient.eval(RELEASE_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [username]
      });

      if (released === 0) {
        const currentOwner = await pubClient.get(lockKey);
        return res.status(409).json({
          error: 'Lock non posseduto o già scaduto',
          lockedBy: currentOwner || null
        });
      }

      io.emit('incident_unlocked', { id });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

module.exports = { createClaimsRouter };
