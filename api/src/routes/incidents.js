// CRUD degli incidenti
const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../auth');
const { createResolveIncidentId } = require('../resolve-incident-id');
const { READ_LOCKS_SCRIPT, RELEASE_LOCK_SCRIPT } = require('../lua-scripts');
const {
  INCIDENT_STATUSES,
  ALLOWED_TRANSITIONS,
  MAX_TITLE_LENGTH,
  lockKeyFor
} = require('../config');

const createIncidentsRouter = ({ db, pubClient, io }) => {
  const router = express.Router();
  const resolveIncidentId = createResolveIncidentId(db);

  router.post('/incidents', authenticate, async (req, res) => {
    try {
      const { title } = req.body;
      
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          error: 'Il campo title è obbligatorio e deve essere una stringa non vuota'
        });
      }
      if (title.trim().length > MAX_TITLE_LENGTH) {
        return res.status(400).json({
          error: `Il campo title non può superare ${MAX_TITLE_LENGTH} caratteri`
        });
      }

      const result = await db.collection('incidents').insertOne({
        title: title.trim(),
        status: 'open',
        createdBy: req.user.username,
        version: 1,
        updatedAt: new Date()
      });
      res.status(201).json({ success: true, id: result.insertedId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/incidents', authenticate, async (req, res) => {
    try {
      const allIncidents = await db.collection('incidents').find({}).sort({ updatedAt: -1 }).toArray();

      if (allIncidents.length > 0) {
        const lockKeys = allIncidents.map(inc => lockKeyFor(inc._id));
        const flat = (await pubClient.eval(READ_LOCKS_SCRIPT, { keys: lockKeys })) || [];

        const locks = new Map();
        for (let i = 0; i < flat.length; i += 3) {
          locks.set(flat[i], { owner: flat[i + 1], ttl: Number(flat[i + 2]) });
        }

        allIncidents.forEach((inc, i) => {
          const lock = locks.get(lockKeys[i]);
          if (lock && lock.ttl > 0) {
            inc.lockedBy = lock.owner;
            inc.lockTtl = lock.ttl;
          }
        });
      }

      res.status(200).json(allIncidents);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/incidents/:id', authenticate, async (req, res) => {
    try {
      const id = await resolveIncidentId(req.params.id, res);
      if (!id) return;
      const { status, version } = req.body;
      const closedBy = status === 'closed' ? req.user.username : undefined;
      const lockKey = lockKeyFor(id);

      if (typeof version !== 'number') {
        return res.status(400).json({
          error: 'Il campo version è obbligatorio per il controllo di concorrenza ottimistico'
        });
      }

      if (!INCIDENT_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `Il campo status è obbligatorio e deve essere uno fra: ${INCIDENT_STATUSES.join(', ')}`
        });
      }

      const sourceStatuses = INCIDENT_STATUSES.filter(
        s => ALLOWED_TRANSITIONS[s].includes(status)
      );
      if (sourceStatuses.length === 0) {
        return res.status(409).json({
          error: `Transizione non ammessa: nessuno stato può tornare a '${status}'`
        });
      }

      const currentOwner = await pubClient.get(lockKey);
      if (!currentOwner) {
        return res.status(409).json({
          error: 'Devi prendere in carico l\'incidente prima di modificarlo'
        });
      }
      if (currentOwner !== req.user.username) {
        return res.status(409).json({
          error: 'Incidente bloccato da un altro utente',
          lockedBy: currentOwner
        });
      }

      const query = { _id: new ObjectId(id), version, status: { $in: sourceStatuses } };

      const updateData = { status, updatedAt: new Date() };
      if (closedBy) updateData.closedBy = closedBy;

      const result = await db.collection('incidents').updateOne(
        query,
        { $set: updateData, $inc: { version: 1 } }
      );

      if (result.matchedCount === 0) {
        const attuale = await db.collection('incidents').findOne(
          { _id: new ObjectId(id) },
          { projection: { status: 1, version: 1 } }
        );
        if (attuale && attuale.version === version) {
          return res.status(409).json({
            error: `Transizione non ammessa: da '${attuale.status}' non si può passare a '${status}'`,
            status: attuale.status
          });
        }
        return res.status(409).json({ error: 'Conflitto! Il documento è stato già modificato o non esiste.' });
      }

      const released = await pubClient.eval(RELEASE_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [req.user.username]
      });

      if (released !== 0) {
        io.emit('incident_unlocked', { id }); 
      }

      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

module.exports = { createIncidentsRouter };
