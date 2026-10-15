const os = require('os');

const podId = os.hostname(); 
const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const corsOrigin = process.env.CORS_ORIGIN || '*';

const jwtSecret = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';
if (!process.env.JWT_SECRET) {
  console.warn(`[${podId}] ATTENZIONE: JWT_SECRET non impostato, uso un secret di sviluppo. Non usare in produzione.`);
}

const JWT_EXPIRES_IN = '12h';
const BCRYPT_SALT_ROUNDS = 10;

const CLAIM_TTL = 60000; // 60 secondi

const INCIDENT_STATUSES = ['open', 'escalated', 'closed'];
const ALLOWED_TRANSITIONS = {
  open: ['escalated', 'closed'],
  escalated: ['closed'],
  closed: []
};

const MAX_TITLE_LENGTH = 200;

const lockKeyFor = (id) => `lock:incident:${id}`;

// Leader election e task di escalation SLA.
const LEADER_KEY = 'leader:escalation';
const LEADER_TTL = 15000; // 15 secondi
const TASK_INTERVAL = 10000; // 10 secondi
const SLA_TIMEOUT = 5 * 60 * 1000; // 5 minuti

module.exports = {
  podId,
  port,
  mongoUrl,
  redisUrl,
  corsOrigin,
  jwtSecret,
  JWT_EXPIRES_IN,
  BCRYPT_SALT_ROUNDS,
  CLAIM_TTL,
  INCIDENT_STATUSES,
  ALLOWED_TRANSITIONS,
  MAX_TITLE_LENGTH,
  lockKeyFor,
  LEADER_KEY,
  LEADER_TTL,
  TASK_INTERVAL,
  SLA_TIMEOUT
};
