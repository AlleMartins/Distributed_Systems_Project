/*
 * -- SCADENZA LOCALE DEI LOCK --
 * Redis non notifica l'expiration di una chiave (le keyspace notifications
 * non sono abilitate), quindi allo scadere NATURALE del TTL nessun pod può
 * emettere 'incident_unlocked'. Senza questi timer la card resterebbe
 * mostrata come "presa in carico" a tempo indefinito e, siccome i bottoni
 * di azione si mostrano solo al proprietario, il ticket diventerebbe
 * inazionabile da tutti.
 * Il server manda il TTL RESIDUO in millisecondi e ogni client calcola la
 * propria deadline con il proprio orologio: nessuna assunzione di clock
 * sincronizzato fra browser e cluster.
 */
export const createLockExpiry = (incidents) => {
  const lockTimers = new Map();

  const clearLockTimer = (id) => {
    const timer = lockTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      lockTimers.delete(id);
    }
  };

  const clearAllLockTimers = () => {
    lockTimers.forEach(timer => clearTimeout(timer));
    lockTimers.clear();
  };

  const scheduleLockExpiry = (id, owner, ttl) => {
    clearLockTimer(id); // un nuovo claim/rinnovo sostituisce il timer precedente
    if (!ttl || ttl <= 0) return;
    lockTimers.set(id, setTimeout(() => {
      lockTimers.delete(id);
      const inc = incidents.value.find(i => i._id === id);
      // Se nel frattempo il lock è passato a un altro utente, quel passaggio ha
      // già programmato il proprio timer: non tocchiamo il suo stato.
      if (inc && inc.lockedBy === owner) delete inc.lockedBy;
    }, ttl));
  };

  return { scheduleLockExpiry, clearLockTimer, clearAllLockTimers };
};
