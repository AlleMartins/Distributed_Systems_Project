// Mutua esclusione sulla presa in carico di un incidente: il mutex
// distribuito vero e proprio. Vive su Redis e non su Mongo perché
// `lockedBy` non è uno stato persistente del ticket ma una prenotazione a
// scadenza, e un TTL è esattamente ciò che Redis sa fare da solo.
//
// Gli eventi emessi qui usano `io.emit` e non `io.local.emit`: nascono su
// UN solo pod (quello che ha servito la richiesta) e devono raggiungere i
// client di tutti gli altri, cosa di cui si occupa l'adapter Redis.
const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../auth');
const { createResolveIncidentId } = require('../resolve-incident-id');
const { RENEW_LOCK_SCRIPT, RELEASE_LOCK_SCRIPT } = require('../lua-scripts');
const { CLAIM_TTL, lockKeyFor } = require('../config');

const createClaimsRouter = ({ db, pubClient, io }) => {
  const router = express.Router();
  const resolveIncidentId = createResolveIncidentId(db);

  // Un incidente risolto non si prende in carico: 'closed' è terminale,
  // quindi un claim non autorizzerebbe nulla. Prima la rotta verificava
  // solo che l'incidente esistesse, e un claim via API su un ticket chiuso
  // rispondeva 200 e annunciava a tutti un `incident_locked`: la card
  // restava in "Resolved" solo perché la colonna In Progress esclude i
  // chiusi, cioè il vincolo lo teneva la UI e non il server.
  //
  // Lo stato si legge DOPO aver acquisito il lock, non prima: chiudere un
  // ticket richiede di possederne il lock, quindi finché lo teniamo noi
  // nessuno può chiuderlo, e un controllo fatto prima lascerebbe aperta la
  // finestra in cui il proprietario precedente risolve e rilascia fra la
  // nostra lettura e il nostro SET. Se è chiuso, il lock appena preso (o
  // rinnovato) si rilascia senza averlo mai annunciato.
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

  // Permette a un operatore di "bloccare" l'incidente per CLAIM_TTL.
  router.post('/incidents/:id/claim', authenticate, async (req, res) => {
    try {
      const id = await resolveIncidentId(req.params.id, res);
      if (!id) return;
      const username = req.user.username;
      const lockKey = lockKeyFor(id);

      // SET NX (Not eXists) con PX (scadenza in ms, vedi CLAIM_TTL)
      const acquired = await pubClient.set(lockKey, username, { NX: true, PX: CLAIM_TTL });

      if (acquired) {
        if (await rifiutaSeChiuso(id, lockKey, username, res)) return;
        // Comunichiamo a tutti i frontend che l'incidente è bloccato (per
        // disabilitare i bottoni). Il TTL viaggia con l'evento: serve ai
        // client per far scadere il lock da soli, dato che allo scadere
        // naturale della chiave nessun pod emetterà 'incident_unlocked'
        // (Redis non notifica l'expiration senza keyspace notifications).
        io.emit('incident_locked', { id, lockedBy: username, ttl: CLAIM_TTL });
        return res.status(200).json({ success: true, lockedBy: username, ttl: CLAIM_TTL });
      }

      // Il SET NX è fallito: il lock esiste già. Ma potrebbe essere NOSTRO.
      // Prima questo caso restituiva indiscriminatamente 409, il che
      // bloccava fuori il legittimo proprietario dopo un reload (la sua UI
      // non conosceva più il lock, e ri-claimare era l'unico modo per
      // recuperarlo: si ritrovava in stallo fino alla scadenza del TTL).
      // Rendiamo quindi il claim IDEMPOTENTE per chi già possiede il lock:
      // rinnova il TTL e ri-annuncia il lock, così il proprietario rientra
      // immediatamente in controllo del proprio ticket.
      // Il rinnovo passa da RENEW_LOCK_SCRIPT e non da un PEXPIRE diretto:
      // fra la GET di verifica e il rinnovo il lock potrebbe scadere ed
      // essere acquisito da un altro analista, e allungheremmo il TTL del
      // lock di QUALCUN ALTRO. Lo script verifica il proprietario ed
      // estende in un'unica operazione indivisibile.
      const renewed = await pubClient.eval(RENEW_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [username, String(CLAIM_TTL)]
      });

      if (renewed !== 0) {
        if (await rifiutaSeChiuso(id, lockKey, username, res)) return;
        // Il TTL è stato riportato a CLAIM_TTL dallo script: ri-annunciarlo
        // riallinea anche i timer di scadenza degli altri client.
        io.emit('incident_locked', { id, lockedBy: username, ttl: CLAIM_TTL });
        return res.status(200).json({ success: true, lockedBy: username, ttl: CLAIM_TTL });
      }

      // Il lock non è nostro: conflitto reale con un altro analista.
      const currentOwner = await pubClient.get(lockKey);
      res.status(409).json({ error: 'Conflitto', message: 'Incidente già preso in carico', lockedBy: currentOwner });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rilascio esplicito del claim.
  // Senza questa rotta, l'unico modo per liberare un incidente preso in
  // carico per errore (o se l'analista si allontana senza risolverlo)
  // era aspettare i 60s di TTL del lock. Con questa rotta il rilascio è
  // immediato. Riusa lo stesso RELEASE_LOCK_SCRIPT della PATCH: cancella
  // il lock solo se appartiene ancora a chi lo sta rilasciando, così un
  // analista non può liberare per errore (o per dispetto) il lock preso
  // nel frattempo da un collega.
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
