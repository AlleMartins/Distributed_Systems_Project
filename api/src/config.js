// Configurazione ed env, in un punto solo. Prima stavano in cima a index.js
// e ogni rotta le leggeva per closure: funzionava, ma rendeva invisibile
// quali costanti servissero davvero a quale pezzo di codice.
const os = require('os');

const podId = os.hostname(); // Identificativo univoco del container (es. api-7685fc6bd-4wv68)
const port = process.env.PORT || 3000;
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/app?replicaSet=rs0';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const corsOrigin = process.env.CORS_ORIGIN || '*';

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

// Durata del lock di presa in carico di un incidente. Serve in più punti
// (acquisizione, rinnovo del proprietario, idratazione dello snapshot),
// quindi è una costante unica: un TTL duplicato e disallineato darebbe
// lock che scadono prima di quanto il client crede. Ora che i punti che la
// usano stanno in file diversi, l'unicità è ancora più importante: si
// importa da qui, non si ricopia.
const CLAIM_TTL = 60000; // 60 secondi

// Stati ammessi per un incidente e transizioni consentite dalla PATCH.
// Senza whitelist la rotta scriveva qualunque stringa arrivasse dal body, e
// `null` se il campo mancava del tutto (il driver serializza `undefined`
// come null): il ticket restava nei totali ma spariva da ogni colonna del
// Kanban, che filtra per valore esatto. Era uno stato non rappresentabile
// nella UI, quindi irrecuperabile dalla UI stessa.
// La tabella delle transizioni aggiunge il vincolo che la sola whitelist non
// dà: 'closed' è terminale, quindi un ticket risolto non si riapre
// scrivendogli sopra `status: 'open'`. 'open' -> 'escalated' resta ammessa
// anche da qui, oltre che dal task di escalation del leader, perché è una
// transizione legittima del dominio.
const INCIDENT_STATUSES = ['open', 'escalated', 'closed'];
const ALLOWED_TRANSITIONS = {
  open: ['escalated', 'closed'],
  escalated: ['closed'],
  closed: []
};

// Limite difensivo sulla lunghezza del titolo: GET /incidents non è paginata,
// quindi un singolo documento abnorme gonfierebbe lo snapshot di tutti.
const MAX_TITLE_LENGTH = 200;

// Prefisso delle chiavi di mutua esclusione sui claim. Centralizzato per lo
// stesso motivo del TTL: la chiave è costruita in tre file diversi (claim,
// PATCH, snapshot) e devono riferirsi tutte alla stessa.
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
