<template>
  <div class="app-container">
    <div v-if="!isJoined" class="login-wrapper">
      <div class="card login-card">
        <div class="pulse-indicator" style="margin: 0 auto 1rem auto; width: 40px; height: 40px;"></div>
        <h2>Entra nella Board</h2>
        <p class="subtitle" style="margin-bottom: 1.5rem;">Inserisci il tuo nome identificativo per partecipare alla sessione realtime.</p>
        
        <div class="input-group">
          <input 
            v-model="tempName" 
            @keyup.enter="joinBoard"
            placeholder="Il tuo nome..." 
            class="modern-input"
            autofocus
          />
          <button @click="joinBoard" class="modern-btn" :disabled="!tempName.trim()">
            Connetti
          </button>
        </div>
      </div>
    </div>

    <div v-else class="main-content">
      <header class="app-header">
        <div class="header-title">
          <div class="pulse-indicator"></div>
          <h1>Realtime Incident Board</h1>
        </div>
        <p class="subtitle">Connesso come: <strong>{{ username }}</strong></p>
      </header>

      <section class="card creation-card">
        <h2>🚨 Segnala Nuovo Incidente</h2>
        <div class="input-group">
          <input 
            v-model="newTitle" 
            @keyup.enter="createIncident"
            placeholder="Es. Latenza elevata sul DB..." 
            class="modern-input"
          />
          <button @click="createIncident" class="modern-btn" :disabled="!newTitle.trim()">
            Broadcast
          </button>
        </div>
      </section>

      <section class="card incidents-card">
        <div class="card-header">
          <h2>Log Eventi Live</h2>
          <span class="badge counter" v-if="incidents.length > 0">{{ incidents.length }} Rilevati</span>
        </div>

        <div v-if="incidents.length === 0" class="empty-state">
          <div class="spinner"></div>
          <p>In attesa di eventi...</p>
        </div>

        <TransitionGroup name="list" tag="ul" class="incident-list">
          <li v-for="inc in incidents" :key="inc._id" class="incident-item">
            <div class="incident-info">
              <span class="incident-title">{{ inc.title }}</span>
              <span class="incident-id">ID: {{ inc._id.substring(0, 8) }}...</span>
            </div>
            <div class="incident-status">
              <span :class="['badge', inc.status]">{{ inc.status.toUpperCase() }}</span>
            </div>
          </li>
        </TransitionGroup>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { io } from 'socket.io-client';

const isJoined = ref(false);
const tempName = ref('');
const username = ref('');
const incidents = ref([]);
const newTitle = ref('');

let socket = null;

const joinBoard = () => {
  if (!tempName.value.trim()) return;
  
  username.value = tempName.value.trim();
  isJoined.value = true;

  // Inizializziamo il socket passandogli il nome nell'handshake
  socket = io('/', { 
    path: '/socket.io',
    auth: { username: username.value } 
  });

  socket.on('incident_update', (change) => {
    if (change.operationType === 'insert') {
      incidents.value.unshift(change.fullDocument);
    }
  });
};

const createIncident = async () => {
  if (!newTitle.value.trim()) return;
  
  await fetch('/api/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: newTitle.value, status: 'open' })
  });
  
  newTitle.value = '';
};
</script>

<style scoped>
* { box-sizing: border-box; }
.app-container { min-height: 100vh; background-color: #f4f7f9; font-family: sans-serif; color: #333; padding: 2rem; display: flex; flex-direction: column; align-items: center; }
.app-header { text-align: center; margin-bottom: 3rem; }
.header-title { display: flex; align-items: center; justify-content: center; gap: 12px; }
.pulse-indicator { width: 12px; height: 12px; background-color: #10b981; border-radius: 50%; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
h1 { margin: 0; font-size: 2.5rem; color: #111827; letter-spacing: -0.5px; }
.subtitle { color: #6b7280; font-size: 1rem; margin-top: 0.5rem; }
.main-content { width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 2rem; }
.card { background: white; border-radius: 12px; padding: 1.5rem 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #e5e7eb; }
h2 { margin-top: 0; font-size: 1.25rem; color: #374151; border-bottom: 2px solid #f3f4f6; padding-bottom: 0.75rem; margin-bottom: 1.25rem; }
.input-group { display: flex; gap: 1rem; }
.modern-input { flex: 1; padding: 0.75rem 1rem; font-size: 1rem; border: 1px solid #d1d5db; border-radius: 8px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
.modern-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
.modern-btn { display: flex; align-items: center; background-color: #3b82f6; color: white; border: none; padding: 0 1.5rem; font-size: 1rem; font-weight: 600; border-radius: 8px; cursor: pointer; transition: background-color 0.2s; }
.modern-btn:hover:not(:disabled) { background-color: #2563eb; }
.modern-btn:disabled { background-color: #9ca3af; cursor: not-allowed; }
.card-header { display: flex; justify-content: space-between; align-items: baseline; }
.incident-list { list-style: none; padding: 0; margin: 0; }
.incident-item { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.75rem; }
.incident-info { display: flex; flex-direction: column; gap: 0.25rem; }
.incident-title { font-weight: 600; color: #1f2937; font-size: 1.1rem; }
.incident-id { font-size: 0.75rem; color: #9ca3af; font-family: monospace; }
.badge { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; }
.badge.counter { background-color: #e0e7ff; color: #4f46e5; }
.badge.open { background-color: #fee2e2; color: #dc2626; }
.empty-state { display: flex; flex-direction: column; align-items: center; padding: 3rem 0; color: #6b7280; }
.spinner { width: 30px; height: 30px; border: 3px solid #f3f4f6; border-top: 3px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.list-enter-active, .list-leave-active { transition: all 0.5s ease; }
.list-enter-from { opacity: 0; transform: translateX(-30px); }
.list-leave-to { opacity: 0; transform: translateX(30px); }

/* --- stili per il Login --- */
.login-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80vh;
  width: 100%;
}
.login-card {
  width: 100%;
  max-width: 450px;
  text-align: center;
  padding: 3rem 2rem;
}
</style>