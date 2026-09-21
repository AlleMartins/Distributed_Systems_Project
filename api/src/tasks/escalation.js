// Leader election + task di escalation SLA.
// Il task deve girare UNA volta sola per intervallo nell'intero cluster,
// non una volta per replica: senza elezione, 3 pod eseguirebbero lo stesso
// updateMany in contemporanea.
// Il leader NON emette eventi Socket.IO: ci pensa il change stream, che
// intercetta l'updateMany e avvisa i client di ogni pod. Emetterli da qui
// li duplicherebbe.
const { RENEW_LOCK_SCRIPT } = require('../lua-scripts');
const { podId, LEADER_KEY, LEADER_TTL, TASK_INTERVAL, SLA_TIMEOUT } = require('../config');

const startEscalationTask = ({ db, pubClient }) => {
  return setInterval(async () => {
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

      // 3. Esecuzione esclusiva del background task.
      // Il lock con TTL non è mutua esclusione garantita: manca il fencing
      // token, quindi se il leader si blocca oltre i 15s (GC pause,
      // partizione) due pod possono credersi leader insieme. L'impatto è
      // nullo perché l'updateMany è idempotente rispetto al filtro
      // `status: 'open'`, ma è il caveat classico di Redlock e va
      // dichiarato, non nascosto.
      if (isLeader) {
        const timeoutDate = new Date(Date.now() - SLA_TIMEOUT);

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
};

module.exports = { startEscalationTask };
