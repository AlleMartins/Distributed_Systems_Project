import { ApiError } from '../services/api.js';

/*
 * Comandi della UI verso il backend. Nessuno di questi aggiorna la lista
 * localmente: la conferma arriva sempre dal canale realtime (change stream o
 * evento di lock), quindi tutti i client vedono la stessa cosa nello stesso
 * modo, compreso chi ha premuto il bottone.
 *
 * Ogni azione guarda l'esito: un ApiError porta il messaggio del server, un
 * errore qualsiasi è un problema di rete.
 */
export const createIncidentActions = ({ api, toast }) => {
  const report = (err, prefix, networkMessage) => {
    if (err instanceof ApiError) {
      toast.error(`${prefix}: ${err.message}`);
    } else {
      console.error(prefix, err);
      toast.error(networkMessage);
    }
  };

  // Ritorna true solo se il ticket è stato davvero creato: è quello che
  // permette a chi chiama di svuotare l'input soltanto in caso di successo,
  // senza far perdere il testo all'utente quando la richiesta fallisce.
  const createIncident = async (title) => {
    if (!title.trim()) return false;
    try {
      await api.create(title);
      toast.success('Incidente registrato con successo!');
      return true;
    } catch (err) {
      report(err, "Impossibile registrare l'incidente", 'Errore di rete durante la registrazione.');
      return false;
    }
  };

  const claimIncident = async (inc) => {
    try {
      await api.claim(inc._id);
      toast.success('Hai preso in carico il ticket.');
    } catch (err) {
      report(err, 'Impossibile prendere in carico', 'Errore di rete durante la presa in carico.');
    }
  };

  const releaseClaim = async (inc) => {
    try {
      await api.release(inc._id);
      toast.info('Lock rilasciato.');
    } catch (err) {
      report(err, 'Impossibile rilasciare', 'Errore di rete durante il rilascio.');
    }
  };

  const resolveIncident = async (inc) => {
    try {
      await api.resolve(inc._id, inc.version);
      toast.success('Ticket risolto correttamente!');
    } catch (err) {
      report(err, '⚠️ Conflitto o errore', 'Errore di rete durante la risoluzione.');
    }
  };

  return { createIncident, claimIncident, releaseClaim, resolveIncident };
};
