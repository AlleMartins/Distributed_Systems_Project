// Entry point: si occupa solo del WIRING. Non contiene logica di dominio.
//
// Perché l'ordine delle operazioni qui sotto conta, ed era il motivo per
// cui prima stava tutto dentro un'unica funzione startServer():
//  1. l'adapter Redis va installato su Socket.IO prima che arrivi una
//     connessione, altrimenti gli eventi non si propagano cross-pod;
//  2. `db` e `pubClient` non esistono finché le connessioni non sono
//     stabilite, e ogni rotta ne ha bisogno.
// La scomposizione non elimina questo vincolo: lo rende esplicito. I
// moduli sono FACTORY che ricevono le dipendenze come parametri invece di
// catturarle per closure, quindi cosa serve a chi si legge dalla firma.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { podId, port, corsOrigin } = require('./src/config');
const { connectRedis, connectMongo } = require('./src/connections');
const { createAuthRouter } = require('./src/routes/auth');
const { createIncidentsRouter } = require('./src/routes/incidents');
const { createClaimsRouter } = require('./src/routes/claims');
const { createHealthRouter } = require('./src/routes/health');
const { createChangeStream } = require('./src/realtime/change-stream');
const { registerPresence } = require('./src/realtime/presence');
const { startEscalationTask } = require('./src/tasks/escalation');

const app = express();
app.use(express.json());
app.use(cors({ origin: corsOrigin }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

// Riferimenti necessari allo spegnimento, popolati durante l'avvio.
let mongoClient = null;
let changeStream = null;
let escalationTask = null;

async function startServer() {
  try {
    const { pubClient } = await connectRedis(io);
    const connessioneMongo = await connectMongo();
    mongoClient = connessioneMongo.mongoClient;
    const db = connessioneMongo.db;

    const apiRouter = express.Router();

    // Ogni modulo espone i path COMPLETI, quindi si montano tutti alla
    // radice dello stesso router: nessun prefisso da tenere allineato fra
    // file e URL identici a prima della scomposizione.
    apiRouter.use(createAuthRouter(db));
    apiRouter.use(createIncidentsRouter({ db, pubClient, io }));
    apiRouter.use(createClaimsRouter({ db, pubClient, io }));

    // Il change stream si avvia PRIMA di registrare le probe, così lo
    // stato che la readiness legge è già inizializzato. La readiness
    // riceve `isHealthy` come funzione: un booleano resterebbe congelato
    // al valore che aveva al momento del wiring.
    changeStream = createChangeStream({ db, io, podId });
    changeStream.start();

    apiRouter.use(createHealthRouter({
      db,
      pubClient,
      isChangeStreamHealthy: changeStream.isHealthy
    }));

    app.use('/api', apiRouter);

    registerPresence(io);

    server.listen(port, () => {
      console.log(`[${podId}] API Server in ascolto sulla porta ${port}`);
    });

    escalationTask = startEscalationTask({ db, pubClient });
  } catch (err) {
    console.error('Errore fatale durante avvio:', err);
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', async () => {
  // Il change stream si chiude per primo: `close()` alza il proprio flag
  // interno di spegnimento prima di chiudere lo stream, così il suo
  // handler d'errore non scambia la chiusura volontaria per un guasto e
  // non riprogramma un ripristino su un client Mongo che stiamo chiudendo.
  if (changeStream) await changeStream.close();
  if (escalationTask) clearInterval(escalationTask);
  server.close();
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});
