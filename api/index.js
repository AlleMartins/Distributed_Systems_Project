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
    
    apiRouter.use(createAuthRouter(db));
    apiRouter.use(createIncidentsRouter({ db, pubClient, io }));
    apiRouter.use(createClaimsRouter({ db, pubClient, io }));

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

  if (changeStream) await changeStream.close();
  if (escalationTask) clearInterval(escalationTask);
  server.close();
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});
