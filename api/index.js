const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { MongoClient, ObjectId } = require('mongodb'); 
const cors = require('cors');
const os = require('os'); // AGGIUNTO: Necessario per recuperare l'ID del pod

const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const podId = os.hostname(); // AGGIUNTO: Identificativo univoco del container (es. api-7685fc6bd-4wv68)

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*' } });

let mongoClient;
let db;

async function startServer() {
  try {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log(`[${podId}] Redis connesso: Adapter Socket.IO configurato.`);

    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    db = mongoClient.db('app');
    console.log(`[${podId}] MongoDB connesso al Replica Set.`);

    const apiRouter = express.Router();
    
    // --- ROTTE CRUD BASE ---
    apiRouter.post('/incidents', async (req, res) => {
      const { title, status, createdBy } = req.body;
      const result = await db.collection('incidents').insertOne({ 
        title, 
        status: status || 'open', 
        createdBy: createdBy || 'Anonimo',
        version: 1, 
        updatedAt: new Date() 
      });
      res.status(201).json({ success: true, id: result.insertedId });
    });

    apiRouter.get('/incidents', async (req, res) => {
      try {
        const allIncidents = await db.collection('incidents').find({}).sort({ updatedAt: -1 }).toArray();
        res.status(200).json(allIncidents);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- A) DISTRIBUTED LOCK / CLAIM (MUTUA ESCLUSIONE) ---
    // Permette a un operatore di "bloccare" l'incidente per 60 secondi
    apiRouter.post('/incidents/:id/claim', async (req, res) => {
      try {
        const { id } = req.params;
        const { username } = req.body;
        const lockKey = `lock:incident:${id}`;
        
        // SET NX (Not eXists) con PX (scadenza in ms) -> 60 secondi
        const acquired = await pubClient.set(lockKey, username, { NX: true, PX: 60000 });
        
        if (acquired) {
          // Comunichiamo a tutti i frontend che l'incidente è bloccato (per disabilitare i bottoni)
          io.emit('incident_locked', { id, lockedBy: username });
          res.status(200).json({ success: true, lockedBy: username });
        } else {
          const currentOwner = await pubClient.get(lockKey);
          res.status(409).json({ error: 'Conflitto', message: 'Incidente già preso in carico', lockedBy: currentOwner });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- ROTTA PATCH (Risoluzione con Optimistic Locking + Rilascio Mutex) ---
    apiRouter.patch('/incidents/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { status, version, closedBy } = req.body; 

        const query = { _id: new ObjectId(id) };
        if (version !== undefined && version !== null) {
          query.version = version;
        } else {
          query.version = { $exists: false };
        }

        const updateData = { status, updatedAt: new Date() };
        if (closedBy) updateData.closedBy = closedBy;

        const result = await db.collection('incidents').updateOne(
          query,
          { $set: updateData, $inc: { version: 1 } }
        );

        if (result.matchedCount === 0) {
          return res.status(409).json({ error: 'Conflitto! Il documento è stato già modificato o non esiste.' });
        }

        // AGGIUNTO: Se la risoluzione ha successo, rilasciamo il Lock Distribuito
        await pubClient.del(`lock:incident:${id}`);
        io.emit('incident_unlocked', { id }); // Sblocca la UI per gli altri

        res.status(200).json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- PROBES ---
    apiRouter.get('/health', (req, res) => res.status(200).send('OK'));
    apiRouter.get('/ready', async (req, res) => {
      try {
        await db.command({ ping: 1 });
        await pubClient.ping();
        res.status(200).json({ status: 'ready' });
      } catch (err) {
        res.status(503).json({ status: 'not ready', error: err.message });
      }
    });

    app.use('/api', apiRouter);

    // --- MONGODB CHANGE STREAMS ---
    const changeStream = db.collection('incidents').watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', (change) => {
      io.local.emit('incident_update', change); 
    });

    // --- SOCKET.IO CONNESSIONI ---
    io.on('connection', async (socket) => {
      const username = socket.handshake.auth.username || 'Anonimo';
      await pubClient.hSet('active_users', socket.id, username);
      
      const broadcastActiveUsers = async () => {
        const usersMap = await pubClient.hGetAll('active_users');
        const uniqueUsers = [...new Set(Object.values(usersMap))];
        io.emit('users_update', uniqueUsers);
      };

      await broadcastActiveUsers();

      socket.on('disconnect', async () => {
        await pubClient.hDel('active_users', socket.id);
        await broadcastActiveUsers();
      });
    });

    server.listen(port, () => {
      console.log(`[${podId}] API Server in ascolto sulla porta ${port}`);
    });

    // --- B) LEADER ELECTION & BACKGROUND TASK ---
    // Task: Ogni 10 secondi, il Leader scala gli incidenti vecchi di 5 minuti
    const LEADER_KEY = 'leader:escalation';
    const LEADER_TTL = 15000; // 15 secondi
    const TASK_INTERVAL = 10000; // 10 secondi

    setInterval(async () => {
      try {
        // 1. Proviamo a prendere la leadership se nessuno ce l'ha (SET NX)
        let isLeader = await pubClient.set(LEADER_KEY, podId, { NX: true, PX: LEADER_TTL });
        
        // 2. Se non l'abbiamo presa, verifichiamo se eravamo GIA' noi il leader per rinnovare il lease
        if (!isLeader) {
          const currentLeader = await pubClient.get(LEADER_KEY);
          if (currentLeader === podId) {
            await pubClient.pExpire(LEADER_KEY, LEADER_TTL);
            isLeader = true; // Rinnovo confermato
          }
        }

        // 3. Esecuzione esclusiva del Background Task
        if (isLeader) {
          // console.log(`[LEADER ${podId}] Controllo incidenti da escalare...`);
          const timeoutDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minuti fa
          
          const result = await db.collection('incidents').updateMany(
            { status: 'open', updatedAt: { $lt: timeoutDate } },
            { 
              $set: { status: 'escalated', updatedAt: new Date() }, 
              $inc: { version: 1 } 
            }
          );
          
          if (result.modifiedCount > 0) {
            console.log(`[LEADER ${podId}] Escalati automaticamente ${result.modifiedCount} incidenti per superamento SLA.`);
            // NOTA MAGICA: Non serve inviare l'evento Socket.io da qui! 
            // Il Change Stream di Mongo intercetterà l'updateMany e avviserà tutti i client in realtime.
          }
        }
      } catch (err) {
        console.error(`[${podId}] Errore background task:`, err.message);
      }
    }, TASK_INTERVAL);

  } catch (err) {
    console.error('Errore fatale durante avvio:', err);
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', async () => {
  server.close();
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});