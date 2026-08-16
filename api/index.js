const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { MongoClient, ObjectId } = require('mongodb'); 
const cors = require('cors');
const os = require('os'); //Necessario per recuperare l'ID del pod

const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const podId = os.hostname(); // Identificativo univoco del container (es. api-7685fc6bd-4wv68)

// Script Lua per il rinnovo atomico del lock di leadership.
// GET+PEXPIRE separati non sono atomici: nella finestra tra i due comandi
// il lock potrebbe scadere ed essere acquisito da un altro pod, e la
// PEXPIRE successiva estenderebbe il TTL della SUA chiave, non della
// nostra (split-brain: due pod convinti entrambi di essere leader).
// Con EVAL, Redis esegue il controllo e l'estensione come un'unica
// operazione indivisibile (Redis è single-threaded sull'esecuzione dei
// comandi, quindi nessun altro comando può intromettersi a metà script).
const RENEW_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

// Script Lua per il rilascio atomico del lock sul claim di un incidente.
// Stesso principio del rinnovo: un DEL incondizionato cancellerebbe
// qualsiasi lock trovi sulla chiave, anche se nel frattempo è scaduto
// e un altro analista lo ha già preso (gli cancelleremmo il lock per
// errore). Rilasciamo SOLO se il valore corrisponde ancora a chi sta
// chiudendo l'incidente.
const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

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

    // --- DISTRIBUTED LOCK / CLAIM (MUTUA ESCLUSIONE) ---
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

    // --- RILASCIO ESPLICITO DEL CLAIM ---
    // Senza questa rotta, l'unico modo per liberare un incidente preso in
    // carico per errore (o se l'analista si allontana senza risolverlo)
    // era aspettare i 60s di TTL del lock. Con questa rotta il rilascio è
    // immediato. Riusa lo stesso RELEASE_LOCK_SCRIPT della PATCH: cancella
    // il lock solo se appartiene ancora a chi lo sta rilasciando.
    apiRouter.delete('/incidents/:id/claim', async (req, res) => {
      try {
        const { id } = req.params;
        const { username } = req.body;
        if (!username) {
          return res.status(400).json({ error: 'username mancante' });
        }

        const lockKey = `lock:incident:${id}`;
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

    // --- rotta patch con risoluzione con optimistic locking + rilascio mutex ---
    apiRouter.patch('/incidents/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { status, version, closedBy } = req.body; 
        const lockKey = `lock:incident:${id}`;

        // Verifica server-side del lock: prima il claim era solo "advisory"
        // (imposto nascondendo il bottone in UI), quindi un client bug/
        // malevolo poteva chiamare direttamente questa PATCH bypassando
        // completamente la mutua esclusione. Ora, se l'incidente risulta
        // bloccato da altro rispetto a chi sta chiudendo, blocchiamo
        // la richiesta qui, indipendentemente da cosa mostra il frontend.
        const currentOwner = await pubClient.get(lockKey);
        if (currentOwner && currentOwner !== closedBy) {
          return res.status(409).json({
            error: 'Incidente bloccato da un altro utente',
            lockedBy: currentOwner
          });
        }

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

        // Rilascio atomico del lock: cancello la chiave solo se
        // appartiene ancora a chi ha appena chiuso l'incidente. Un DEL
        // incondizionato cancellerebbe qualunque lock trovi sulla chiave
        // in quel momento.
        if (closedBy) {
          await pubClient.eval(RELEASE_LOCK_SCRIPT, {
            keys: [lockKey],
            arguments: [closedBy]
          });
        } else {
          await pubClient.del(lockKey);
        }
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
    const LEADER_KEY = 'leader:escalation';
    const LEADER_TTL = 15000; // 15 secondi
    const TASK_INTERVAL = 10000; // 10 secondi

    setInterval(async () => {
      try {
        // 1. Provo a prendere la leadership se nessuno ce l'ha (SET NX)
        let isLeader = await pubClient.set(LEADER_KEY, podId, { NX: true, PX: LEADER_TTL });
        
        // 2. Se non presa, proviamo a rinnovarla atomicamente:
        // lo script Lua verifica che il valore sia ancora il nostro podId
        // e solo in quel caso estende il TTL, in un'unica operazione indivisibile
        if (!isLeader) {
          const renewed = await pubClient.eval(RENEW_LOCK_SCRIPT, {
            keys: [LEADER_KEY],
            arguments: [podId, String(LEADER_TTL)]
          });
          isLeader = renewed !== 0;
        }

        // 3. Esecuzione esclusiva del Background Task
        if (isLeader) {
          // console.log(`[LEADER ${podId}] Controllo incidenti da escalated`);
          const timeoutDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minuti 
          
          const result = await db.collection('incidents').updateMany(
            { status: 'open', updatedAt: { $lt: timeoutDate } },
            { 
              $set: { status: 'escalated', updatedAt: new Date() }, 
              $inc: { version: 1 } 
            }
          );
          
          if (result.modifiedCount > 0) {
            console.log(`[LEADER ${podId}] Escalati automaticamente ${result.modifiedCount} incidenti per superamento SLA.`);
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