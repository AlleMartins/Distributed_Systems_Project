// CRUD degli incidenti: creazione, snapshot di idratazione e PATCH di
// transizione di stato. Le rotte di presa in carico stanno in claims.js —
// qui si tocca Mongo, là Redis — ma i due file NON sono indipendenti: la
// PATCH verifica il lock scritto dal claim, ed è quella verifica a rendere
// la mutua esclusione vincolante. Vedi il commento sopra `currentOwner`.
const express = require('express');
const { ObjectId } = require('mongodb');
const { authenticate } = require('../auth');
const { createResolveIncidentId } = require('../resolve-incident-id');
const { READ_LOCKS_SCRIPT, RELEASE_LOCK_SCRIPT } = require('../lua-scripts');
const {
  INCIDENT_STATUSES,
  ALLOWED_TRANSITIONS,
  MAX_TITLE_LENGTH,
  lockKeyFor
} = require('../config');

const createIncidentsRouter = ({ db, pubClient, io }) => {
  const router = express.Router();
  const resolveIncidentId = createResolveIncidentId(db);

  router.post('/incidents', authenticate, async (req, res) => {
    try {
      const { title } = req.body;

      // `title` non era validato, ed è il campo che la UI legge senza
      // difese: `filteredIncidents` in App.vue fa `inc.title.toLowerCase()`.
      // Un solo documento con title null o numerico (creabile via curl, non
      // dalla UI) faceva lanciare quel computed, e siccome il computed
      // alimenta l'intera board il danno non restava sul ticket malformato:
      // rompeva la dashboard di TUTTI i client collegati, inclusi quelli
      // già in sessione, raggiunti dal change stream. Una singola richiesta
      // malformata accettata qui diventava un guasto globale, ed è il
      // motivo per cui la validazione sta sul server e non sulla form.
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({
          error: 'Il campo title è obbligatorio e deve essere una stringa non vuota'
        });
      }
      if (title.trim().length > MAX_TITLE_LENGTH) {
        return res.status(400).json({
          error: `Il campo title non può superare ${MAX_TITLE_LENGTH} caratteri`
        });
      }

      // Lo status iniziale non arriva dal body: un incidente nasce sempre
      // 'open', primo stato di ALLOWED_TRANSITIONS. Prenderlo dal client
      // permetteva di creare ticket già 'closed' (senza `closedBy`, ma
      // conteggiati fra i risolti) o con uno status inventato.
      const result = await db.collection('incidents').insertOne({
        title: title.trim(),
        status: 'open',
        createdBy: req.user.username,
        version: 1,
        updatedAt: new Date()
      });
      res.status(201).json({ success: true, id: result.insertedId });
    } catch (err) {
      // Era l'unica rotta senza try/catch. Su Express 5 un handler async
      // che rigetta finisce comunque all'error handler, quindi il pod non
      // cadeva, ma il client riceveva un 500 HTML generico invece del JSON
      // che la UI si aspetta di poter leggere.
      res.status(500).json({ error: err.message });
    }
  });

  // Lo snapshot include i lock attivi letti da Redis. Prima esponeva solo
  // i documenti Mongo, e siccome `lockedBy` vive unicamente in Redis + nello
  // stato dei client (alimentato dagli eventi socket), il lock NON faceva
  // parte dello stato ricostruibile: un client che si idratava dopo
  // l'acquisizione di un lock non lo vedeva affatto. Conseguenze:
  //  - il proprietario, dopo un reload, si ritrovava il proprio ticket in
  //    colonna "Open" senza i bottoni Resolve/Release (che la UI mostra
  //    solo a chi possiede il lock), e senza poter ri-claimare;
  //  - i client idratati in momenti diversi mostravano stati divergenti
  //    dello stesso ticket, rompendo l'eventual consistency della UI.
  // Leggendo i lock qui, lo snapshot REST + gli eventi successivi
  // descrivono lo stesso stato per qualunque client, in qualunque istante
  // si colleghi.
  router.get('/incidents', authenticate, async (req, res) => {
    try {
      const allIncidents = await db.collection('incidents').find({}).sort({ updatedAt: -1 }).toArray();

      // Una sola EVAL per tutti i lock invece di N GET: il numero di
      // round-trip verso Redis non cresce con la dimensione della board.
      if (allIncidents.length > 0) {
        const lockKeys = allIncidents.map(inc => lockKeyFor(inc._id));
        // `|| []`: se nessuna delle chiavi esiste lo script Lua restituisce
        // una tabella vuota, e non è garantito che il driver la mappi su un
        // array (una table vuota è indistinguibile da un valore nullo lato
        // Redis). Un `null` qui faceva lanciare `flat.length` e mandava in
        // 500 la rotta dello snapshot: nessun client riusciva più a
        // idratarsi, cioè board vuota per tutti proprio quando NON c'era
        // alcun lock attivo.
        const flat = (await pubClient.eval(READ_LOCKS_SCRIPT, { keys: lockKeys })) || [];

        // Lo script restituisce solo le chiavi presenti, quindi indicizziamo
        // per chiave anziché per posizione.
        const locks = new Map();
        for (let i = 0; i < flat.length; i += 3) {
          locks.set(flat[i], { owner: flat[i + 1], ttl: Number(flat[i + 2]) });
        }

        allIncidents.forEach((inc, i) => {
          const lock = locks.get(lockKeys[i]);
          if (lock && lock.ttl > 0) {
            inc.lockedBy = lock.owner;
            // TTL RESIDUO, non una scadenza assoluta: il client calcola la
            // propria deadline con il proprio orologio, così non assumiamo
            // che browser e cluster siano sincronizzati (uno skew di pochi
            // secondi farebbe scadere i lock troppo presto o troppo tardi).
            inc.lockTtl = lock.ttl;
          }
        });
      }

      res.status(200).json(allIncidents);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- PATCH: transizione di stato con Optimistic Locking + rilascio mutex ---
  router.patch('/incidents/:id', authenticate, async (req, res) => {
    try {
      // Stesso helper delle rotte di claim: oltre a dare 400/404 invece di
      // un 500 su id malformato, restituisce l'id CANONICO, che qui è
      // indispensabile perché la chiave di lock costruita sotto deve essere
      // la stessa che ha scritto il claim (vedi resolve-incident-id.js).
      const id = await resolveIncidentId(req.params.id, res);
      if (!id) return;
      const { status, version } = req.body;
      // closedBy non è letto dal body: prima un client poteva chiudere un
      // ticket "a nome" di chiunque. È sempre l'identità verificata dal
      // token di chi effettua la richiesta.
      const closedBy = status === 'closed' ? req.user.username : undefined;
      const lockKey = lockKeyFor(id);

      // `version` è obbligatoria. Prima, se il client la ometteva, si
      // ripiegava su `version: { $exists: false }`: un ramo di fatto morto,
      // perché ogni documento creato dalla POST nasce con `version: 1` e
      // quindi il filtro non poteva matchare nulla. L'effetto era un 409
      // "documento già modificato" che descriveva un conflitto di
      // concorrenza inesistente, mandando fuori strada chi leggeva l'errore
      // (il problema vero era una richiesta malformata). Meglio un 400 che
      // dice cosa manca.
      if (typeof version !== 'number') {
        return res.status(400).json({
          error: 'Il campo version è obbligatorio per il controllo di concorrenza ottimistico'
        });
      }

      // `status` non era validato: una PATCH che lo ometteva scriveva null
      // (il driver serializza `undefined` come null) e produceva un ticket
      // fantasma, presente nei totali ma assente da ogni colonna Kanban.
      // `includes` copre anche il caso mancante, perché undefined non è in
      // whitelist.
      if (!INCIDENT_STATUSES.includes(status)) {
        return res.status(400).json({
          error: `Il campo status è obbligatorio e deve essere uno fra: ${INCIDENT_STATUSES.join(', ')}`
        });
      }

      // Stati di partenza dai quali `status` è raggiungibile. Vuoto solo
      // per 'open', verso cui nessuna transizione punta: è così che si
      // impedisce la riapertura di un ticket chiuso, che la whitelist da
      // sola non fermerebbe (è uno status legittimo, in un punto illegittimo
      // del ciclo di vita).
      const sourceStatuses = INCIDENT_STATUSES.filter(
        s => ALLOWED_TRANSITIONS[s].includes(status)
      );
      if (sourceStatuses.length === 0) {
        return res.status(409).json({
          error: `Transizione non ammessa: nessuno stato può tornare a '${status}'`
        });
      }

      // Verifica server-side del lock: il claim non è advisory, quindi un
      // client bug/malevolo non può chiamare questa PATCH bypassando la
      // mutua esclusione. Si richiede di POSSEDERE il lock, non soltanto di
      // non violarne uno altrui: prima, se nessuno aveva preso in carico il
      // ticket, chiunque poteva chiuderlo: bastava NON fare il claim per
      // aggirare del tutto il mutex, che restava vincolante solo per chi lo
      // rispettava. La UI fa già così (i bottoni Resolve/Release esistono
      // solo per il proprietario del lock), quindi il flusso normale non
      // cambia; cambia solo che ora la regola vale anche fuori dalla UI.
      const currentOwner = await pubClient.get(lockKey);
      if (!currentOwner) {
        return res.status(409).json({
          error: 'Devi prendere in carico l\'incidente prima di modificarlo'
        });
      }
      if (currentOwner !== req.user.username) {
        return res.status(409).json({
          error: 'Incidente bloccato da un altro utente',
          lockedBy: currentOwner
        });
      }

      // Lo stato di partenza entra nel FILTRO, non in un controllo letto
      // prima: una verifica separata lascerebbe una finestra fra lettura e
      // scrittura in cui il task di escalation del leader può cambiare lo
      // status sotto di noi. Così la transizione è validata da Mongo nella
      // stessa operazione atomica dell'optimistic locking.
      const query = { _id: new ObjectId(id), version, status: { $in: sourceStatuses } };

      const updateData = { status, updatedAt: new Date() };
      if (closedBy) updateData.closedBy = closedBy;

      const result = await db.collection('incidents').updateOne(
        query,
        { $set: updateData, $inc: { version: 1 } }
      );

      if (result.matchedCount === 0) {
        // Il filtro contiene sia `version` sia lo stato di partenza, quindi
        // un mancato match ha due cause diverse: qualcuno ha scritto prima
        // di noi (conflitto ottimistico, ha senso rileggere e ritentare),
        // oppure la transizione non è ammessa dallo stato corrente (ritentare
        // non servirà mai). Rileggiamo il documento per distinguerle: un 409
        // unico farebbe ritentare all'infinito una PATCH che non può
        // riuscire.
        const attuale = await db.collection('incidents').findOne(
          { _id: new ObjectId(id) },
          { projection: { status: 1, version: 1 } }
        );
        if (attuale && attuale.version === version) {
          return res.status(409).json({
            error: `Transizione non ammessa: da '${attuale.status}' non si può passare a '${status}'`,
            status: attuale.status
          });
        }
        return res.status(409).json({ error: 'Conflitto! Il documento è stato già modificato o non esiste.' });
      }

      // Rilascio ATOMICO del lock: cancelliamo la chiave solo se appartiene
      // ancora a chi sta effettuando la modifica. Un DEL incondizionato
      // cancellerebbe qualunque lock trovi sulla chiave in quel momento — se
      // la richiesta arrivasse in ritardo, dopo che il nostro lock era già
      // scaduto e un altro analista ne avesse preso uno nuovo, cancelleremmo
      // IL SUO lock, non il nostro.
      // Lo script si applica a QUALUNQUE status e non solo a 'closed': il
      // ramo che prima usava un DEL incondizionato aggirava questa
      // protezione proprio nel caso che il commento dichiarava di evitare.
      const released = await pubClient.eval(RELEASE_LOCK_SCRIPT, {
        keys: [lockKey],
        arguments: [req.user.username]
      });

      // Annunciamo lo sblocco SOLO se il lock era davvero nostro ed è stato
      // rilasciato ora. Emetterlo incondizionatamente significava che, se nel
      // frattempo il lock era scaduto ed era passato a un altro analista,
      // dicevamo a tutti i client di cancellare `lockedBy` mentre Redis
      // teneva un lock valido per lui: il nuovo proprietario perdeva i
      // bottoni di azione sul ticket che aveva legittimamente in carico.
      // Il caso "nessun lock" non arriva più fin qui (la rotta lo rifiuta
      // sopra con 409), ma `released === 0` resta possibile: fra la verifica
      // del proprietario e questo rilascio il TTL può scadere e il lock
      // passare a un altro analista. È la finestra TOCTOU inevitabile fra
      // due sistemi distinti — Redis e Mongo — e il motivo per cui il
      // rilascio deve restare condizionato al proprietario.
      //
      // io.emit (non io.local.emit): l'evento nasce su QUESTO pod e va
      // propagato cross-pod dall'adapter Redis. È l'opposto di
      // 'incident_update', che nasce dal change stream su OGNI pod.
      if (released !== 0) {
        io.emit('incident_unlocked', { id }); // Sblocca la UI per gli altri
      }

      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

module.exports = { createIncidentsRouter };
