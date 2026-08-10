const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { MongoClient, ObjectId } = require('mongodb'); 
const cors = require('cors');

const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

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
    console.log('Redis connesso: Adapter Socket.IO configurato.');

    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    db = mongoClient.db('app');
    console.log('MongoDB connesso al Replica Set.');

    const apiRouter = express.Router();
    
    // Rotta per Creare
    apiRouter.post('/incidents', async (req, res) => {
      const { title, status, createdBy } = req.body;
      const result = await db.collection('incidents').insertOne({ 
        title, 
        status: status || 'open', 
        createdBy: createdBy || 'Anonimo',
        version: 1, // AGGIUNTO: Inizializziamo il contatore di versione
        updatedAt: new Date() 
      });
      res.status(201).json({ success: true, id: result.insertedId });
    });

    // NUOVA ROTTA: Recupero dello storico iniziale (State Hydration)
    apiRouter.get('/incidents', async (req, res) => {
      try {
        // Recupera tutti gli incidenti, ordinati dal più recente al più vecchio
        const allIncidents = await db.collection('incidents').find({}).sort({ updatedAt: -1 }).toArray();
        res.status(200).json(allIncidents);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

// Rotta per Aggiornare (con OPTIMISTIC LOCKING + RETROCOMPATIBILITÀ + CHIUSO DA)
    apiRouter.patch('/incidents/:id', async (req, res) => {
      try {
        const { id } = req.params;
        // AGGIUNTO: Estraiamo closedBy dal body della richiesta
        const { status, version, closedBy } = req.body; 

        const query = { _id: new ObjectId(id) };

        // Logica di Retrocompatibilità
        if (version !== undefined && version !== null) {
          query.version = version;
        } else {
          query.version = { $exists: false };
        }

        // AGGIUNTO: Prepariamo i dati da aggiornare
        const updateData = { status, updatedAt: new Date() };
        if (closedBy) {
          updateData.closedBy = closedBy; // Salviamo chi ha chiuso l'incidente
        }

        const result = await db.collection('incidents').updateOne(
          query,
          { 
            $set: updateData,
            $inc: { version: 1 } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(409).json({ error: 'Conflitto! Il documento è stato già modificato o non esiste.' });
        }

        res.status(200).json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    apiRouter.get('/health', (req, res) => res.status(200).send('OK'));
    app.use('/api', apiRouter);

    const changeStream = db.collection('incidents').watch([], { fullDocument: 'updateLookup' });
    
    changeStream.on('change', (change) => {
      io.local.emit('incident_update', change); 
    });

    io.on('connection', async (socket) => {
      const username = socket.handshake.auth.username || 'Anonimo';
      console.log(`[+] User connesso: ${username} (Socket: ${socket.id})`);
      
      await pubClient.hSet('active_users', socket.id, username);
      
      const broadcastActiveUsers = async () => {
        const usersMap = await pubClient.hGetAll('active_users');
        const uniqueUsers = [...new Set(Object.values(usersMap))];
        io.emit('users_update', uniqueUsers);
      };

      await broadcastActiveUsers();

      socket.on('disconnect', async () => {
        console.log(`[-] User disconnesso: ${username}`);
        await pubClient.hDel('active_users', socket.id);
        await broadcastActiveUsers();
      });
    });

    server.listen(port, () => {
      console.log(`API Server in ascolto sulla porta ${port}`);
    });

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