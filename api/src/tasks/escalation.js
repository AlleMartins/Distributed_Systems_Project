const { RENEW_LOCK_SCRIPT } = require('../lua-scripts');
const { podId, LEADER_KEY, LEADER_TTL, TASK_INTERVAL, SLA_TIMEOUT } = require('../config');

const startEscalationTask = ({ db, pubClient }) => {
  return setInterval(async () => {
    try {
      
      let isLeader = await pubClient.set(LEADER_KEY, podId, { NX: true, PX: LEADER_TTL });

      if (!isLeader) {
        const renewed = await pubClient.eval(RENEW_LOCK_SCRIPT, {
          keys: [LEADER_KEY],
          arguments: [podId, String(LEADER_TTL)]
        });
        isLeader = renewed !== 0;
      }

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
