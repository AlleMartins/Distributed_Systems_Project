// Valida l'id di un incidente e ne verifica l'esistenza, restituendo la
// forma CANONICA dell'id (hex minuscolo) da usare per la chiave Redis e
// per gli eventi socket. Se l'id non va bene ha già risposto al client e
// restituisce null: il chiamante deve solo interrompere.
//
// Serviva per due ragioni distinte.
// 1) Le rotte di claim non guardavano affatto l'id: una
//    'POST /api/incidents/nonvalido/claim' rispondeva 200, creava in
//    Redis la chiave 'lock:incident:nonvalido' con TTL di 60s e
//    annunciava a TUTTI i client un 'incident_locked' per un ticket che
//    non esiste. Un client autenticato poteva così riempire Redis di
//    chiavi arbitrarie e far comparire lock fantasma nella board altrui.
// 2) L'hex di un ObjectId è case-insensitive in lettura ma la chiave
//    Redis è una stringa: usando l'id grezzo della URL,
//    'lock:incident:6AAE...' e 'lock:incident:6aae...' sarebbero due
//    lock DIVERSI per lo STESSO incidente, e due analisti potrebbero
//    prenderlo in carico insieme. Normalizzare l'id chiude il buco.
//
// Vive in un file suo perché lo usano sia le rotte di claim sia la PATCH,
// che ora stanno in moduli diversi: è il punto unico in cui un id grezzo
// proveniente dalla URL diventa una chiave di lock.
const { ObjectId } = require('mongodb');

const createResolveIncidentId = (db) => async (id, res) => {
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Identificativo incidente non valido' });
    return null;
  }
  const objectId = new ObjectId(id);
  const esiste = await db.collection('incidents').countDocuments({ _id: objectId }, { limit: 1 });
  if (!esiste) {
    res.status(404).json({ error: 'Incidente inesistente' });
    return null;
  }
  return objectId.toHexString();
};

module.exports = { createResolveIncidentId };
