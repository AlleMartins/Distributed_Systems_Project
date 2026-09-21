import { ref } from 'vue';
import { io } from 'socket.io-client';

/*
 * Canale realtime: connessione Socket.IO, ri-idratazione dello stato e
 * traduzione degli eventi del server in mutazioni dello store.
 *
 * È il punto in cui vivono le contromisure ai guasti distribuiti (resync
 * generazionale, riconnessione dopo l'eviction lato server), quindi conviene
 * che resti un file solo, letto per intero: sono meccanismi che si capiscono
 * insieme.
 */
export const createRealtime = ({ token, api, store, toast, onUnauthorized }) => {
  const onlineUsers = ref([]);
  let socket = null;

  const connect = () => {
    socket = io('/', { path: '/socket.io', auth: { token: token.value } });

    // Contatore di "generazione" del resync: incrementato all'inizio di OGNI
    // ri-idratazione, da qualunque innesco provenga. Serve a scartare le
    // risposte fetch "in ritardo": se nel frattempo ne è partita una più
    // recente, la risposta della precedente, risolta tardi, sovrascriverebbe
    // uno stato più fresco con uno stale (tipico durante un rolling update dei
    // pod api, dove il socket si riconnette più volte di seguito).
    // Prima il contatore era legato al solo evento 'connect'. Da quando anche
    // il server può chiedere un resync ('resync_required'), due ri-idratazioni
    // possono essere in volo contemporaneamente all'interno della stessa
    // connessione: contarle per connessione non le distinguerebbe.
    let resyncGeneration = 0;

    // Ri-idratazione completa dello stato dallo snapshot REST. Invocata al
    // (ri)connect e su richiesta del server (evento 'resync_required').
    const resyncIncidents = async () => {
      const myGeneration = ++resyncGeneration;
      try {
        const data = await api.list();
        // Se nel frattempo è partito un resync più recente (myGeneration
        // stale), scartiamo questa risposta invece di applicarla comunque.
        if (myGeneration === resyncGeneration) store.applySnapshot(data);
      } catch (err) {
        console.error('Errore durante la sincronizzazione:', err);
        toast.error('Errore di connessione al database.');
      }
    };

    socket.on('connect', () => {
      resyncIncidents();
    });

    // Il pod a cui siamo collegati ha dovuto ricostruire il proprio change
    // stream ripartendo dal presente (resume token non più nell'oplog): gli
    // eventi del buco sono persi, quindi ri-scarichiamo lo stato completo
    // invece di restare disallineati in silenzio.
    socket.on('resync_required', () => {
      resyncIncidents();
    });

    // Il token può scadere (o essere invalido dopo un riavvio con secret
    // diverso in ambienti di sviluppo): l'handshake viene rifiutato dal
    // middleware io.use() lato server con Error('unauthorized'). In quel
    // caso riportiamo l'utente al login invece di ritentare all'infinito.
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        toast.error('Sessione scaduta o non valida, effettua di nuovo il login.');
        onUnauthorized();
      }
    });

    // Il pod a cui siamo agganciati può disconnetterci DELIBERATAMENTE quando
    // il suo change stream non si riprende: da lì in poi non riceveremmo più
    // alcun evento, e restare collegati significherebbe guardare una board
    // ferma credendola aggiornata. Ci sposta quindi su un pod sano.
    // Va richiesta esplicitamente la riconnessione: dopo un disconnect imposto
    // dal server ('io server disconnect') Socket.IO NON riprova da solo, a
    // differenza di una caduta di rete. Senza questa riga l'eviction lato
    // server lascerebbe il client scollegato per sempre.
    // La nuova connessione passa dal Service, che nel frattempo ha smesso di
    // elencare il pod degradato, e 'connect' innesca già la ri-idratazione.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') socket.connect();
    });

    socket.on('incident_update', (change) => store.applyChange(change));
    socket.on('incident_locked', (payload) => store.applyLock(payload));
    socket.on('incident_unlocked', (payload) => store.applyUnlock(payload));

    // Presenza calcolata on demand dal server con io.fetchSockets(): qui
    // basta prendere l'ultima lista ricevuta.
    socket.on('users_update', (users) => {
      onlineUsers.value = users;
    });
  };

  const disconnect = () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    onlineUsers.value = [];
  };

  return { onlineUsers, connect, disconnect };
};
