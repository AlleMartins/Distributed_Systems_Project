// Il change stream è l'UNICO canale da cui i client apprendono le
// modifiche dopo l'idratazione iniziale: se si interrompe su un pod, i
// client di QUEL pod smettono silenziosamente di ricevere aggiornamenti
// mentre quelli degli altri pod continuano a vederli. È il caso peggiore
// — divergenza silenziosa — perché il pod resta perfettamente in salute
// dal punto di vista di Express.
// Prima non c'era alcun listener 'error': un EventEmitter che emette
// 'error' senza handler fa terminare il processo per eccezione non
// catturata, quindi l'unico backstop era il riavvio del pod da parte di
// Kubernetes. Funzionava per effetto collaterale, non per progetto.
// Ora: il driver Mongo ritenta già da sé gli errori "resumable" (es.
// failover del primary), quindi l'handler scatta solo per quelli NON
// resumable. In quel caso marchiamo il pod come non pronto (esce dal
// Service senza essere riavviato) e tentiamo di ricostruire lo stream.
//
// La factory restituisce { start, isHealthy, close }. `isHealthy` è una
// FUNZIONE e non un valore: la readiness deve leggere lo stato corrente,
// non una copia scattata al momento del wiring.
// `shuttingDown` è interno e viene alzato da `close()`: prima era una
// variabile di modulo condivisa con l'handler SIGTERM, ed è essenziale che
// venga impostata PRIMA di chiudere lo stream, altrimenti l'handler
// d'errore interpreta la chiusura volontaria come un guasto e riprogramma
// un ripristino su un client Mongo che stiamo per chiudere.

// Attesa prima di spostare i client di un pod degradato. Il valore è
// legato al manifest (periodSeconds 5 * failureThreshold 3 in
// k8s/api.yaml, più un margine): se cambiano lì, va cambiato qui.
const EVICTION_DELAY = 20000;

const createChangeStream = ({ db, io, podId }) => {
  let changeStream = null;
  let changeStreamHealthy = false;
  let resumeToken = null;
  let changeStreamRetries = 0;
  let shuttingDown = false;
  let evictionTimer = null;

  // Uscire dal Service NON chiude le connessioni già stabilite: Kubernetes
  // smette di indirizzare traffico NUOVO al pod, ma i WebSocket già aperti
  // restano appesi qui e smettono semplicemente di ricevere
  // 'incident_update'. Sono esattamente i client che il degrado danneggia,
  // ed erano gli unici che la readinessProbe non proteggeva: la board
  // continuava a sembrare viva mentre divergeva in silenzio.
  // Li disconnettiamo quindi esplicitamente. Il client si riconnette
  // attraverso il Service, che a quel punto non elenca più questo pod, e si
  // ri-idrata da solo: resyncIncidents() è già agganciato a 'connect'.
  //
  // L'attesa prima di disconnettere serve a due cose:
  //  - non buttare giù tutti per un'interruzione di pochi secondi, da cui
  //    il resume token recupera senza che nessuno se ne accorga;
  //  - dare tempo alla readiness di far uscire il pod dagli endpoint. Se
  //    disconnettessimo subito, l'Ingress rimanderebbe i client su QUESTO
  //    stesso pod e otterremmo solo un ciclo di riconnessioni.
  //
  // ATTENZIONE: ha una metà indispensabile lato client. Dopo un disconnect
  // imposto dal server, Socket.IO non ritenta da solo, quindi App.vue
  // richiama esplicitamente socket.connect() su reason === 'io server
  // disconnect'. Senza quella riga questo codice sposta i client nel nulla.
  const scheduleClientEviction = () => {
    if (evictionTimer) return; // già programmata da un errore precedente
    evictionTimer = setTimeout(async () => {
      evictionTimer = null;
      // Se nel frattempo lo stream è tornato su, i client non hanno perso
      // nulla (il resume token ha recuperato il buco): non si tocca niente.
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

  // Pianifica un tentativo di ricostruzione dello stream, con backoff
  // esponenziale fino a un tetto di 30s.
  // È una funzione a sé, e non il corpo del setTimeout dentro l'handler
  // 'error', perché il tentativo deve poter RIPIANIFICARE SE STESSO:
  // `watch()` può fallire in modo sincrono (topology distrutta, client
  // Mongo non ancora riconnesso dopo un'interruzione di rete) e in quel
  // caso non nasce alcuno stream, quindi non esiste nessun handler
  // 'error' che possa innescare il tentativo successivo.
  // Prima il catch si limitava a marcare il pod non pronto: il risultato
  // era uno stallo PERMANENTE, perché la readiness resta a 503 per
  // sempre (il pod esce dal Service e non rientra mai) mentre la
  // liveness è shallow e quindi Kubernetes non lo riavvia. Il pod
  // restava vivo, inutile e invisibile, fino a un intervento manuale.
  const scheduleChangeStreamRestart = (tokenRejected) => {
    const delay = Math.min(1000 * 2 ** changeStreamRetries, 30000);
    changeStreamRetries += 1;
    setTimeout(() => {
      if (shuttingDown) return;
      try {
        start();
        console.log(`[${podId}] Change stream ripristinato.`);
        // Il flag viaggia attraverso i tentativi: se il token era stato
        // rifiutato, il resync va chiesto ai client quando lo stream
        // torna su davvero, non al primo tentativo (che può fallire).
        if (tokenRejected) io.local.emit('resync_required');
      } catch (retryErr) {
        console.error(`[${podId}] Ricostruzione change stream fallita: ${retryErr.message}`);
        changeStreamHealthy = false;
        // Si ritenta. Il contatore del backoff è già stato incrementato,
        // quindi i tentativi si diradano fino al tetto invece di fermarsi.
        scheduleChangeStreamRestart(tokenRejected);
      }
    }, delay);
  };

  function start() {
    const options = { fullDocument: 'updateLookup' };
    // Riprendendo dall'ultimo evento processato, gli aggiornamenti avvenuti
    // durante l'interruzione non vengono persi.
    if (resumeToken) options.resumeAfter = resumeToken;

    changeStream = db.collection('incidents').watch([], options);
    changeStreamHealthy = true;
    // Lo stream è di nuovo in piedi: i client locali restano dove sono.
    cancelClientEviction();

    changeStream.on('change', (change) => {
      resumeToken = change._id;
      // Il backoff si azzera qui, alla ricezione di un evento, e non subito
      // dopo la creazione dello stream: `watch()` riesce sempre, quindi
      // resettare là significherebbe ritentare ogni 1-2s all'infinito su un
      // guasto persistente (stream che si ricrea e muore subito). Un evento
      // ricevuto è invece la prova che lo stream funziona davvero.
      changeStreamRetries = 0;
      // io.local.emit e NON io.emit: il change stream scatta su OGNI
      // replica API, quindi un io.emit qui consegnerebbe lo stesso evento
      // N volte a ciascun client. È l'opposto degli eventi di lock.
      io.local.emit('incident_update', change);
    });

    changeStream.on('error', async (err) => {
      if (shuttingDown) return;
      changeStreamHealthy = false;
      console.error(`[${podId}] Change stream interrotto: ${err.message}`);

      // I client agganciati a questo pod non riceveranno più eventi finché
      // lo stream non torna: se non torna in fretta vanno spostati altrove.
      scheduleClientEviction();

      try { await changeStream.close(); } catch (_) { /* già chiuso */ }

      // Un resume token può essere rifiutato perché non è più nell'oplog
      // (interruzione troppo lunga). In quel caso l'unica via è ripartire
      // dal presente, accettando di aver perso gli eventi del buco: lo
      // segnaliamo ai client locali, che si ri-idratano via REST.
      // Discriminiamo sul codice d'errore (286 ChangeStreamHistoryLost,
      // 280 ChangeStreamFatalError) e non solo sul messaggio, che dipende
      // dalla versione del server; il match testuale resta come fallback.
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

  // Chiusura volontaria (SIGTERM). Alza `shuttingDown` PRIMA di chiudere,
  // così l'handler 'error' non scambia lo spegnimento per un guasto.
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
