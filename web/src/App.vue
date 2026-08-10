<template>
  <div class="app-container">
    <div v-if="!isJoined" class="login-wrapper">
      <div class="card login-card">
        <div class="pulse-indicator" style="margin: 0 auto 1rem auto; width: 40px; height: 40px;"></div>
        <h2>Entra nella Board</h2>
        <p class="subtitle" style="margin-bottom: 1.5rem;">Inserisci il tuo nome identificativo per partecipare alla sessione realtime.</p>
        
        <div class="input-group">
          <input v-model="tempName" @keyup.enter="joinBoard" placeholder="Il tuo nome..." class="modern-input" autofocus />
          <button @click="joinBoard" class="modern-btn" :disabled="!tempName.trim()">Connetti</button>
        </div>
      </div>
    </div>

    <div v-else class="dashboard-layout">
      <aside class="sidebar">
        <!-- Card Utenti Online -->
        <div class="card" style="margin-bottom: 1.5rem;">
          <div class="sidebar-header">
            <h3>🟢 Utenti Online</h3>
            <span class="badge counter">{{ onlineUsers.length }}</span>
          </div>
          <ul class="users-list">
            <li v-for="user in onlineUsers" :key="user" :class="{'current-user': user === username}">
              <div class="avatar">{{ user.charAt(0).toUpperCase() }}</div>
              <span class="user-name">{{ user }}</span>
              <span v-if="user === username" class="you-badge">Tu</span>
            </li>
          </ul>
        </div>

        <!-- Card Grafico a Torta -->
        <div class="card chart-card">
          <div class="sidebar-header">
            <h3>📊 Stato Incidenti</h3>
          </div>
          <div v-if="incidents.length === 0" class="empty-chart">
            Nessun dato
          </div>
          <!-- Il grafico appare solo quando ci sono incidenti -->
          <div v-else class="chart-container">
            <PieChart :data="chartData" :options="chartOptions" />
          </div>
        </div>
      </aside>

      <main class="main-content">
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
            <input v-model="newTitle" @keyup.enter="createIncident" placeholder="Es. Latenza elevata sul DB..." class="modern-input" />
            <button @click="createIncident" class="modern-btn" :disabled="!newTitle.trim()">Broadcast</button>
          </div>
        </section>

        <section class="card incidents-card">
          <div class="card-header">
            <h2>Log Eventi Live</h2>
            <span class="badge counter" v-if="incidents.length > 0">{{ incidents.length }} Rilevati</span>
          </div>

          <div v-if="incidents.length === 0" class="empty-state">
            <div class="spinner"></div><p>In attesa di eventi...</p>
          </div>

          <TransitionGroup name="list" tag="ul" class="incident-list">
            <li v-for="inc in incidents" :key="inc._id" class="incident-item">
              <div class="incident-info">
                <span class="incident-title" :class="{ 'resolved-text': inc.status === 'closed' }">{{ inc.title }}</span>
                <span class="incident-author">Segnalato da: <strong>{{ inc.createdBy || 'Anonimo' }}</strong></span>
                
                <!-- Mostra chi ha risolto l'incidente -->
                <span v-if="inc.status === 'closed' && inc.closedBy" class="incident-author" style="color: #10b981;">
                  ✓ Risolto da: <strong>{{ inc.closedBy }}</strong>
                </span>
              </div>
              
              <div class="incident-status-group">
                <span :class="['badge', inc.status]">{{ inc.status.toUpperCase() }}</span>
                
                <button v-if="inc.status === 'open'" @click="resolveIncident(inc)" class="resolve-btn" title="Segna come risolto">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
              </div>

            </li>
          </TransitionGroup>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { io } from 'socket.io-client';

// -- IMPORT PER IL GRAFICO CHART.JS --
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
// Usiamo l'alias PieChart per evitare conflitti con tag HTML standard
import { Pie as PieChart } from 'vue-chartjs';

ChartJS.register(ArcElement, Tooltip, Legend);

const isJoined = ref(false);
const tempName = ref('');
const username = ref('');
const incidents = ref([]);
const newTitle = ref('');
const onlineUsers = ref([]);

let socket = null;

// -- LOGICA DEL GRAFICO REATTIVO --
const chartData = computed(() => {
  const openCount = incidents.value.filter(i => i.status === 'open').length;
  const closedCount = incidents.value.filter(i => i.status === 'closed').length;
  
  return {
    labels: ['Aperti', 'Risolti'],
    datasets: [
      {
        backgroundColor: ['#ef4444', '#10b981'], 
        data: [openCount, closedCount],
        borderWidth: 0,
        hoverOffset: 4
      }
    ]
  };
});

const chartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: { font: { family: 'sans-serif' } }
    }
  }
});

const joinBoard = async () => {
  if (!tempName.value.trim()) return;
  username.value = tempName.value.trim();
  isJoined.value = true;

  // 1. RECUPERO STORICO: Carichiamo la "baseline" dal database
  try {
    const response = await fetch('/api/incidents');
    const history = await response.json();
    incidents.value = history; // Popola la lista e il grafico a torta
  } catch (err) {
    console.error("Errore nel recupero dello storico:", err);
  }

  // 2. SOTTOSCRIZIONE EVENTI: Ci colleghiamo al bus realtime
  socket = io('/', { 
    path: '/socket.io',
    auth: { username: username.value } 
  });

  socket.on('incident_update', (change) => {
    if (change.operationType === 'insert') {
      incidents.value.unshift(change.fullDocument);
    } 
    else if (change.operationType === 'update') {
      const index = incidents.value.findIndex(inc => inc._id === change.documentKey._id);
      if (index !== -1 && change.fullDocument) {
        incidents.value[index] = change.fullDocument;
      }
    }
  });

  socket.on('users_update', (users) => {
    onlineUsers.value = users;
  });
};

const createIncident = async () => {
  if (!newTitle.value.trim()) return;
  await fetch('/api/incidents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: newTitle.value, status: 'open', createdBy: username.value })
  });
  newTitle.value = '';
};

const resolveIncident = async (inc) => {
  try {
    const response = await fetch(`/api/incidents/${inc._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        status: 'closed',
        version: inc.version,
        // AGGIUNTO: Inviamo al backend il nome di chi sta cliccando
        closedBy: username.value 
      })
    });

    if (response.status === 409) {
      alert("⚠️ CONFLITTO! Qualcun altro ha già modificato questo incidente.");
    }
  } catch (err) {
    console.error("Errore di rete:", err);
  }
};
</script>

<style scoped>
/* Tutto il CSS in un unico file per garanzia di build */
* { box-sizing: border-box; }
.app-container { min-height: 100vh; background-color: #f4f7f9; font-family: sans-serif; color: #333; padding: 2rem; display: flex; flex-direction: column; align-items: center; }
.app-header { text-align: center; margin-bottom: 3rem; }
.header-title { display: flex; align-items: center; justify-content: center; gap: 12px; }
.pulse-indicator { width: 12px; height: 12px; background-color: #10b981; border-radius: 50%; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
h1 { margin: 0; font-size: 2.5rem; color: #111827; letter-spacing: -0.5px; }
.subtitle { color: #6b7280; font-size: 1rem; margin-top: 0.5rem; }
.main-content { width: 100%; display: flex; flex-direction: column; gap: 2rem; }
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
.incident-title { font-weight: 600; color: #1f2937; font-size: 1.1rem; transition: color 0.3s; }
.resolved-text { color: #9ca3af; text-decoration: line-through; }
.badge { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; }
.badge.counter { background-color: #e0e7ff; color: #4f46e5; }
.badge.open { background-color: #fee2e2; color: #dc2626; }
.badge.closed { background-color: #d1fae5; color: #059669; }
.empty-state { display: flex; flex-direction: column; align-items: center; padding: 3rem 0; color: #6b7280; }
.spinner { width: 30px; height: 30px; border: 3px solid #f3f4f6; border-top: 3px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 1rem; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.list-enter-active, .list-leave-active { transition: all 0.5s ease; }
.list-enter-from { opacity: 0; transform: translateX(-30px); }
.list-leave-to { opacity: 0; transform: translateX(30px); }
.login-wrapper { display: flex; align-items: center; justify-content: center; height: 80vh; width: 100%; }
.login-card { width: 100%; max-width: 450px; text-align: center; padding: 3rem 2rem; }
.dashboard-layout { display: grid; grid-template-columns: 280px 1fr; gap: 2rem; width: 100%; max-width: 1200px; }
.sidebar { align-self: start; position: sticky; top: 2rem; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f3f4f6; padding-bottom: 0.75rem; margin-bottom: 1rem; }
.sidebar-header h3 { margin: 0; font-size: 1.1rem; color: #374151; }
.users-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.users-list li { display: flex; align-items: center; padding: 0.5rem; border-radius: 6px; background-color: #f9fafb; }
.current-user { background-color: #eff6ff !important; border: 1px solid #bfdbfe; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background-color: #3b82f6; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 10px; }
.user-name { font-weight: 500; font-size: 0.95rem; color: #1f2937; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.you-badge { background: #3b82f6; color: white; font-size: 0.65rem; padding: 2px 6px; border-radius: 12px; font-weight: bold; }
.incident-author { font-size: 0.85rem; color: #6b7280; margin-top: 4px; }
.incident-status-group { display: flex; align-items: center; gap: 0.75rem; }
.resolve-btn { background-color: #10b981; color: white; border: none; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s, background-color 0.2s; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2); }
.resolve-btn:hover { background-color: #059669; transform: scale(1.1); }
.resolve-btn:active { transform: scale(0.95); }

/* --- CORREZIONE DEL CONTENITORE DEL GRAFICO --- */
.chart-container { 
  position: relative; 
  height: 220px; 
  width: 100%; 
  /* Ho rimosso il display: flex che schiacciava il canvas */
}
.empty-chart { text-align: center; color: #9ca3af; font-size: 0.9rem; padding: 2rem 0; font-style: italic; }
</style>