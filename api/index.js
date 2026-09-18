const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const os = require('os'); // AGGIUNTO: Necessario per recuperare l'ID del pod
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const podId = os.hostname(); // AGGIUNTO: Identificativo univoco del container (es. api-7685fc6bd-4wv68)

// Secret condiviso da TUTTE le repliche dell'API (via k8s Secret): è ciò
// che rende l'autenticazione stateless in un cluster orizzontalmente
// scalato. Qualunque pod verifica un token emesso da un pod qualsiasi
// altro, senza bisogno di session affinity o storage di sessione condiviso.
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';
if (!process.env.JWT_SECRET) {
  console.warn(`[${podId}] ATTENZIONE: JWT_SECRET non impostato, uso un secret di sviluppo. Non usare in produzione.`);
}
const JWT_EXPIRES_IN = '12h';
const BCRYPT_SALT_ROUNDS = 10;

// Script Lua per il rinnovo ATOMICO del lock di leadership.
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

// Script Lua per il rilascio ATOMICO del lock sul claim di un incidente.
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

    // Indice unico: garantisce l'unicità dello username anche in presenza
    // di più repliche API che ricevono registrazioni concorrenti (l'unicità
    // applicativa da sola avrebbe una finestra di race condition).
    await db.collection('users').createIndex({ username: 1 }, { unique: true });

    const apiRouter = express.Router();

    // --- MIDDLEWARE DI AUTENTICAZIONE (JWT stateless) ---
    // Nessuno stato di sessione da mantenere: il token porta con sé tutto
    // il necessario per essere verificato da un pod QUALSIASI, il che è
    // essenziale dato che le richieste di un utente possono atterrare su
    // repliche diverse ad ogni chiamata (nessuna sticky session lato API).
    function authenticate(req, res, next) {
      const authHeader = req.headers.authorization || '';
      const [scheme, token] = authHeader.split(' ');
      if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Token di autenticazione mancante' });
      }
      try {
        const payload = jwt.verify(token, jwtSecret);
        req.user = { username: payload.sub };
        next();
      } catch (err) {
        return res.status(401).json({ error: 'Token non valido o scaduto' });
      }
    }

    // --- ROTTE DI AUTENTICAZIONE ---
    apiRouter.post('/auth/register', async (req, res) => {
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

    apiRouter.post('/auth/login', async (req, res) => {
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

    // --- ROTTE CRUD BASE ---
    apiRouter.post('/incidents', authenticate, async (req, res) => {
      const { title, status } = req.body;
      const result = await db.collection('incidents').insertOne({
        title,
        status: status || 'open',
        createdBy: req.user.username,
        version: 1,
        updatedAt: new Date()
      });
      res.status(201).json({ success: true, id: result.insertedId });
    });

    apiRouter.get('/incidents', authenticate, async (req, res) => {
      try {
        const allIncidents = await db.collection('incidents').find({}).sort({ updatedAt: -1 }).toArray();
        res.status(200).json(allIncidents);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- A) DISTRIBUTED LOCK / CLAIM (MUTUA ESCLUSIONE) ---
    // Permette a un operatore di "bloccare" l'incidente per 60 secondi
    apiRouter.post('/incidents/:id/claim', authenticate, async (req, res) => {
      try {
        const { id } = req.params;
        const username = req.user.username;
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

    // --- A.1) RILASCIO ESPLICITO DEL CLAIM ---
    // Senza questa rotta, l'unico modo per liberare un incidente preso in
    // carico per errore (o se l'analista si allontana senza risolverlo)
    // era aspettare i 60s di TTL del lock. Con questa rotta il rilascio è
    // immediato. Riusa lo stesso RELEASE_LOCK_SCRIPT della PATCH: cancella
    // il lock solo se appartiene ancora a chi lo sta rilasciando, così un
    // analista non può liberare per errore (o per dispetto) il lock preso
    // nel frattempo da un collega.
    apiRouter.delete('/incidents/:id/claim', authenticate, async (req, res) => {
      try {
        const { id } = req.params;
        const username = req.user.username;
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

    // --- ROTTA PATCH (Risoluzione con Optimistic Locking + Rilascio Mutex) ---
    apiRouter.patch('/incidents/:id', authenticate, async (req, res) => {
      try {
        const { id } = req.params;
        const { status, version } = req.body;
        // closedBy non è più letto dal body: prima un client poteva chiudere
        // un ticket "a nome" di chiunque. Ora è sempre l'identità verificata
        // dal token di chi effettua la richiesta.
        const closedBy = status === 'closed' ? req.user.username : undefined;
        const lockKey = `lock:incident:${id}`;

        // Verifica server-side del lock: prima il claim era solo "advisory"
        // (imposto nascondendo il bottone in UI), quindi un client bug/
        // malevolo poteva chiamare direttamente questa PATCH bypassando
        // completamente la mutua esclusione. Ora, se l'incidente risulta
        // bloccato da QUALCUN ALTRO rispetto a chi sta chiudendo, blocchiamo
        // la richiesta qui, indipendentemente da cosa mostra il frontend.
        const currentOwner = await pubClient.get(lockKey);
        if (currentOwner && currentOwner !== req.user.username) {
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

        // Rilascio ATOMICO del lock: cancelliamo la chiave solo se
        // appartiene ancora a chi ha appena chiuso l'incidente. Un DEL
        // incondizionato cancellerebbe qualunque lock trovi sulla chiave
        // in quel momento — se closedBy avesse mandato una richiesta in
        // ritardo dopo che il proprio lock era già scaduto e un altro
        // analista ne avesse preso uno nuovo, avremmo cancellato IL SUO
        // lock, non il nostro.
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
    // NOTA: prima qui mantenevamo manualmente un Hash su Redis
    // (active_users) aggiornato via hSet/hDel. Il problema: se un pod
    // viene terminato in modo non pulito (rollout restart, crash, OOM),
    // il 'disconnect' non scatta mai lato server per quei socket, e le
    // loro entry restano per sempre nell'hash — contatore "utenti online"
    // che cresce all'infinito ad ogni riavvio non pulito.
    // Fix: usiamo io.fetchSockets(), che interroga in tempo reale (via
    // adapter Redis) TUTTI i pod per sapere chi è REALMENTE connesso in
    // questo momento. Nessuno stato duplicato da mantenere sincronizzato:
    // Socket.IO rileva le connessioni morte tramite il proprio protocollo
    // di heartbeat (ping/pong su engine.io), indipendentemente da un
    // 'disconnect' pulito, quindi il conteggio si autocorregge da solo.
    // Middleware di autenticazione sull'handshake: prima lo username veniva
    // preso a occhi chiusi da socket.handshake.auth.username, cioè
    // qualunque client poteva connettersi dichiarando l'identità di un
    // altro utente. Ora l'handshake viene accettato solo con un JWT valido,
    // verificabile da QUALSIASI pod (nessuno stato di sessione condiviso
    // necessario oltre al secret comune).
    io.use((socket, next) => {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) {
        return next(new Error('unauthorized'));
      }
      try {
        const payload = jwt.verify(token, jwtSecret);
        socket.data.username = payload.sub;
        next();
      } catch (err) {
        next(new Error('unauthorized'));
      }
    });

    io.on('connection', async (socket) => {
      const broadcastActiveUsers = async () => {
        const sockets = await io.fetchSockets();
        const uniqueUsers = [...new Set(sockets.map(s => s.data.username))];
        io.emit('users_update', uniqueUsers);
      };

      await broadcastActiveUsers();

      socket.on('disconnect', async () => {
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
        
        // 2. Se non l'abbiamo presa, proviamo a rinnovarla ATOMICAMENTE:
        // lo script Lua verifica che il valore sia ancora il nostro podId
        // e SOLO in quel caso estende il TTL, in un'unica operazione
        // indivisibile (niente finestra tra "controllo" e "azione").
        if (!isLeader) {
          const renewed = await pubClient.eval(RENEW_LOCK_SCRIPT, {
            keys: [LEADER_KEY],
            arguments: [podId, String(LEADER_TTL)]
          });
          isLeader = renewed !== 0;
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