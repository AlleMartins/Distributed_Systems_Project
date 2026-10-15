// Valida l'id di un incidente e ne verifica l'esistenza
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
