// Connessioni alle dipendenze esterne. Isolarle serve a rendere esplicito
// l'ordine di avvio: l'adapter Redis va installato su Socket.IO PRIMA che
// arrivino connessioni, e le rotte non possono essere registrate finché
// `db` non esiste. Era il motivo per cui tutto stava dentro startServer().
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { mongoUrl, redisUrl, podId } = require('./config');

// Servono DUE client: l'adapter di Socket.IO usa il modello pub/sub di
// Redis, e un client in stato "subscribe" non può eseguire altri comandi.
// `pubClient` resta quindi libero per i lock e gli script Lua.
async function connectRedis(io) {
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log(`[${podId}] Redis connesso: Adapter Socket.IO configurato.`);
  return { pubClient, subClient };
}

async function connectMongo() {
  const mongoClient = new MongoClient(mongoUrl);
  await mongoClient.connect();
  const db = mongoClient.db('app');
  console.log(`[${podId}] MongoDB connesso al Replica Set.`);

  // Indice unico: garantisce l'unicità dello username anche in presenza
  // di più repliche API che ricevono registrazioni concorrenti (l'unicità
  // applicativa da sola avrebbe una finestra di race condition).
  await db.collection('users').createIndex({ username: 1 }, { unique: true });

  return { mongoClient, db };
}

module.exports = { connectRedis, connectMongo };
