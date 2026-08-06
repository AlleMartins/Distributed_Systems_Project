<template>
  <div style="font-family: sans-serif; padding: 2rem;">
    <h1>🚨 Realtime Incident Board</h1>
    
    <div style="margin-bottom: 2rem;">
      <input v-model="newTitle" placeholder="Titolo del nuovo incidente..." style="padding: 0.5rem; width: 300px;" />
      <button @click="createIncident" style="padding: 0.5rem 1rem; margin-left: 10px;">Segnala</button>
    </div>

    <div style="border: 1px solid #ccc; padding: 1rem; border-radius: 8px;">
      <h2>Log Incidenti Live</h2>
      <ul v-if="incidents.length > 0">
        <li v-for="inc in incidents" :key="inc._id" style="margin-bottom: 0.5rem;">
          <strong>{{ inc.title }}</strong> - Stato: {{ inc.status }}
        </li>
      </ul>
      <p v-else>Nessun incidente segnalato. La board è in ascolto...</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { io } from 'socket.io-client';

const incidents = ref([]);
const newTitle = ref('');

// Grazie all'Ingress, contattiamo direttamente la root e lui smisterà a Node.js
const socket = io('/', { path: '/socket.io' });

onMounted(() => {
  // Nota per prof: Qui in un'app reale faresti una GET REST a /api/incidents per caricare lo storico iniziale.
  // Per dimostrare la reattività pura, partiamo vuoti e ascoltiamo solo gli eventi live.
  
  socket.on('incident_update', (change) => {
    console.log('Evento ricevuto via WebSocket:', change);
    if (change.operationType === 'insert') {
      incidents.value.push(change.fullDocument);
    }
  });
});

const createIncident = async () => {
  if (!newTitle.value) return;
  
  await fetch('/api/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: newTitle.value, status: 'open' })
  });
  
  // Svuotiamo l'input. L'aggiornamento della lista lo farà il socket!
  newTitle.value = '';
};
</script>