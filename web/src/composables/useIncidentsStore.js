import { ref } from 'vue';
import { createLockExpiry } from './useLockExpiry.js';

/*
 * Stato condiviso della board: la lista degli incidenti e le sole mutazioni
 * che la fanno evolvere. Ognuna corrisponde a un messaggio in arrivo dal
 * backend (snapshot REST, change stream, eventi di lock), così il flusso dei
 * dati resta a senso unico: il trasporto (useRealtime) traduce gli eventi in
 * chiamate a queste funzioni, i componenti leggono soltanto.
 */
export const createIncidentsStore = ({ username, toast }) => {
  const incidents = ref([]);
  const { scheduleLockExpiry, clearLockTimer, clearAllLockTimers } = createLockExpiry(incidents);

  // Ri-idratazione completa: lo snapshot REST rimpiazza lo stato corrente.
  const applySnapshot = (snapshot) => {
    incidents.value = snapshot;
    // I timer della vista precedente non valgono più: ne riprogrammiamo uno
    // per ogni lock idratato, usando il TTL residuo calcolato dal server.
    clearAllLockTimers();
    snapshot.forEach(inc => {
      if (inc.lockedBy) scheduleLockExpiry(inc._id, inc.lockedBy, inc.lockTtl);
    });
  };

  // Evento 'incident_update': un change stream di Mongo, quindi la fonte di
  // verità per tutto ciò che è persistito.
  const applyChange = (change) => {
    if (change.operationType === 'insert') {
      incidents.value.unshift(change.fullDocument);
      if (change.fullDocument.createdBy !== username.value) {
        toast.info(`Nuovo ticket registrato: ${change.fullDocument.title}`);
      }
      return;
    }

    if (change.operationType !== 'update') return;

    const index = incidents.value.findIndex(inc => inc._id === change.documentKey._id);
    if (index === -1 || !change.fullDocument) return;

    const oldIncident = incidents.value[index];
    const currentLock = oldIncident.lockedBy;

    if (oldIncident.status !== 'escalated' && change.fullDocument.status === 'escalated') {
      toast.warning(`⚠️ Attenzione: Il ticket "${change.fullDocument.title}" ha superato i limiti SLA ed è stato ESCALATO!`, { timeout: 8000 });
    }
    if (oldIncident.status !== 'closed' && change.fullDocument.status === 'closed' && change.fullDocument.closedBy !== username.value) {
      toast.success(`Il ticket "${change.fullDocument.title}" è stato risolto da ${change.fullDocument.closedBy}`);
    }

    // `lockedBy` NON è persistito su Mongo (la fonte di verità è Redis):
    // va rimontato sul documento che arriva dal DB, altrimenti ogni update
    // cancellerebbe il lock dalla UI.
    incidents.value[index] = { ...change.fullDocument, lockedBy: currentLock };
  };

  const applyLock = ({ id, lockedBy, ttl }) => {
    const inc = incidents.value.find(i => i._id === id);
    if (inc) inc.lockedBy = lockedBy;
    // Programmato anche se l'incidente non è in lista (può arrivare prima
    // dell'insert): alla scadenza il lookup semplicemente non troverà nulla.
    scheduleLockExpiry(id, lockedBy, ttl);
  };

  const applyUnlock = ({ id }) => {
    const inc = incidents.value.find(i => i._id === id);
    if (inc) delete inc.lockedBy;
    clearLockTimer(id); // rilascio esplicito: il timer non serve più
  };

  // Al logout: lo stato di una sessione non deve sopravvivere alla successiva.
  const reset = () => {
    clearAllLockTimers();
    incidents.value = [];
  };

  return { incidents, applySnapshot, applyChange, applyLock, applyUnlock, reset };
};
