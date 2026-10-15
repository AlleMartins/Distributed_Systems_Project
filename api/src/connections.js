const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { mongoUrl, redisUrl, podId } = require('./config');

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

  await db.collection('users').createIndex({ username: 1 }, { unique: true });

  return { mongoClient, db };
}

module.exports = { connectRedis, connectMongo };
