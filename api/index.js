const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const port = process.env.PORT || 3000;
// URL interni al cluster Kubernetes
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' }
});

let mongoClient;
let db;

async function startServer() {
  try {
    // 1. Setup Redis Adapter per il fanout tra le repliche API
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Redis connesso: Adapter Socket.IO configurato.');

    // 2. Connessione a MongoDB Replica Set
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    db = mongoClient.db('app');
    console.log('MongoDB connesso al Replica Set.');

    // 3. Setup rotte REST (montate sotto /api per facilitare l'Ingress)
    const apiRouter = express.Router();
    
    apiRouter.post('/incidents', async (req, res) => {
      const { title, status, description } = req.body;
      const result = await db.collection('incidents').insertOne({ 
        title, 
        status: status || 'open', 
        description, 
        updatedAt: new Date() 
      });
      res.status(201).json({ success: true, id: result.insertedId });
    });

    // Endpoint vitale per Liveness/Readiness probe di Kubernetes
    apiRouter.get('/health', (req, res) => res.status(200).send('OK'));
    
    app.use('/api', apiRouter);

    // 4. Mongo Change Streams: Il DB diventa l'Event Source
    const changeStream = db.collection('incidents').watch();
    changeStream.on('change', (change) => {
      console.log('Rilevato cambiamento su Mongo:', change.operationType);
      // Usa .local.emit per inviare SOLO ai client connessi a questo specifico Pod
      io.local.emit('incident_update', change); 
    });

    // 5. Gestione Socket.IO
    io.on('connection', (socket) => {
      // Estraiamo il nome dall'handshake (o assegniamo 'Anonimo' se assente per sicurezza)
      const username = socket.handshake.auth.username || 'Anonimo';
      
      console.log(`[+] User connesso: ${username} (Socket ID: ${socket.id}) su Replica API`);
      
      socket.on('disconnect', () => {
        console.log(`[-] User disconnesso: ${username}`);
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

// 6. Graceful Shutdown: Essenziale per testare la Fault Injection senza perdere connessioni
process.on('SIGTERM', async () => {
  console.log('Ricevuto segnale SIGTERM (Es. Pod terminato da Kubernetes). Chiusura graceful...');
  server.close(() => console.log('Traffico HTTP bloccato.'));
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});