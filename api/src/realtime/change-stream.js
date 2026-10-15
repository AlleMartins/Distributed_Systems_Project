const EVICTION_DELAY = 20000;

const createChangeStream = ({ db, io, podId }) => {
  let changeStream = null;
  let changeStreamHealthy = false;
  let resumeToken = null;
  let changeStreamRetries = 0;
  let shuttingDown = false;
  let evictionTimer = null;

  const scheduleClientEviction = () => {
    if (evictionTimer) return; 
    evictionTimer = setTimeout(async () => {
      evictionTimer = null;

      if (shuttingDown || changeStreamHealthy) return;
      try {
        const locali = await io.local.fetchSockets();
        if (locali.length === 0) return;
        console.warn(`[${podId}] Change stream ancora fermo: disconnetto i client locali (${locali.length}) perché si riconnettano a un pod sano.`);
        io.local.disconnectSockets(true);
      } catch (err) {
        console.error(`[${podId}] Disconnessione dei client locali fallita: ${err.message}`);
      }
    }, EVICTION_DELAY);
  };

  const cancelClientEviction = () => {
    if (evictionTimer) {
      clearTimeout(evictionTimer);
      evictionTimer = null;
    }
  };

  const scheduleChangeStreamRestart = (tokenRejected) => {
    const delay = Math.min(1000 * 2 ** changeStreamRetries, 30000);
    changeStreamRetries += 1;
    setTimeout(() => {
      if (shuttingDown) return;
      try {
        start();
        console.log(`[${podId}] Change stream ripristinato.`);

        if (tokenRejected) io.local.emit('resync_required');
      } catch (retryErr) {
        console.error(`[${podId}] Ricostruzione change stream fallita: ${retryErr.message}`);
        changeStreamHealthy = false;
        scheduleChangeStreamRestart(tokenRejected);
      }
    }, delay);
  };

  function start() {
    const options = { fullDocument: 'updateLookup' };

    if (resumeToken) options.resumeAfter = resumeToken;

    changeStream = db.collection('incidents').watch([], options);
    changeStreamHealthy = true;
    cancelClientEviction();

    changeStream.on('change', (change) => {
      resumeToken = change._id;
      changeStreamRetries = 0;
      io.local.emit('incident_update', change);
    });

    changeStream.on('error', async (err) => {
      if (shuttingDown) return;
      changeStreamHealthy = false;
      console.error(`[${podId}] Change stream interrotto: ${err.message}`);
      scheduleClientEviction();

      try { await changeStream.close(); } catch (_) {}
      const tokenRejected = !!resumeToken && (
        err.code === 286 || err.code === 280 || /resume|oplog/i.test(err.message || '')
      );
      if (tokenRejected) {
        console.warn(`[${podId}] Resume token non più valido: riparto dal presente e chiedo un resync ai client locali.`);
        resumeToken = null;
      }

      scheduleChangeStreamRestart(tokenRejected);
    });
  }

  const close = async () => {
    shuttingDown = true;
    cancelClientEviction();
    if (changeStream) {
      try { await changeStream.close(); } catch (_) { /* già chiuso */ }
    }
  };

  return { start, isHealthy: () => changeStreamHealthy, close };
};

module.exports = { createChangeStream };
