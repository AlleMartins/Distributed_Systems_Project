<template>
  <div class="app-container">
    <div v-if="!isJoined" class="login-wrapper">
      <div class="card login-card">
        <div class="pulse-indicator" style="margin: 0 auto 1rem auto; width: 40px; height: 40px;"></div>
        <h2 class="text-light">Entra nella Board</h2>
        <p class="subtitle" style="margin-bottom: 1.5rem;">Inserisci il tuo nome per accedere alla Dashboard Realtime.</p>
        
        <div class="input-group">
          <input v-model="tempName" @keyup.enter="joinBoard" placeholder="Il tuo nome..." class="modern-input dark-input" autofocus />
          <button @click="joinBoard" class="modern-btn magenta-btn" :disabled="!tempName.trim()">Connetti</button>
        </div>
      </div>
    </div>

    <div v-else class="dashboard-wrapper">
      <header class="app-header">
        <div class="header-titles">
          <h1>Real time incident management dashboard</h1>
          <p class="subtitle">Following dashboard illustrates KPI in real-time. Connected as: <strong>{{ username }}</strong></p>
        </div>
        <div class="header-status">
          <div class="pulse-indicator"></div>
          <span>Live Sync Active</span>
        </div>
      </header>

      <main class="dashboard-grid">
        
        <div class="grid-col kpi-column">
          <div class="kpi-card">
            <h3>Total Number of Tickets</h3>
            <div class="kpi-number text-yellow">{{ totalIncidents }}</div>
          </div>
          
          <div class="kpi-card">
            <h3>Open Tickets</h3>
            <div class="kpi-number text-magenta">{{ openIncidents }}</div>
          </div>

          <div class="kpi-card">
            <h3>Escalated Tickets</h3>
            <div class="kpi-number text-orange">{{ escalatedIncidents }}</div>
          </div>

          <div class="kpi-card">
            <h3>Resolved Tickets</h3>
            <div class="kpi-number text-green">{{ resolvedIncidents }}</div>
          </div>

          <div class="kpi-card">
            <h3>Users Online</h3>
            <div class="kpi-number text-yellow">{{ onlineUsers.length }}</div>
          </div>
        </div>

        <div class="grid-col center-column">
          <div class="card chart-card">
            <h3 class="card-title">Incidents Status Overview</h3>
            <div class="chart-container">
              <BarChart v-if="totalIncidents > 0" :data="chartData" :options="chartOptions" />
              <div v-else class="empty-state">No data available</div>
            </div>
          </div>

          <div class="card creation-card">
            <h3 class="card-title">Register New Incident</h3>
            <div class="input-group">
              <input v-model="newTitle" @keyup.enter="createIncident" placeholder="Describe the incident..." class="modern-input dark-input" />
              <button @click="createIncident" class="modern-btn magenta-btn" :disabled="!newTitle.trim()">Submit</button>
            </div>
          </div>
        </div>

        <div class="grid-col right-column">
          <div class="card list-card">
            <div class="card-header">
              <h3 class="card-title">Live Action Feed</h3>
            </div>

            <div v-if="incidents.length === 0" class="empty-state">
              <div class="spinner"></div><p>Waiting for events...</p>
            </div>

            <div class="scrollable-list">
              <TransitionGroup name="list" tag="ul" class="incident-list">
                <li v-for="inc in incidents" :key="inc._id" class="incident-item">
                  <div class="incident-info">
                    <span class="incident-title" :class="{ 'resolved-text': inc.status === 'closed' }">{{ inc.title }}</span>
                    <span class="incident-author">Reported by: <strong>{{ inc.createdBy || 'Anonimo' }}</strong></span>
                    
                    <span v-if="inc.status === 'closed' && inc.closedBy" class="incident-author text-green">
                      ✓ Resolved by: <strong>{{ inc.closedBy }}</strong>
                    </span>
                    <span v-if="inc.lockedBy" class="incident-author text-orange">
                      🔒 Locked by: <strong>{{ inc.lockedBy }}</strong>
                    </span>
                  </div>
                  
                  <div class="incident-status-group">
                    <span :class="['badge', inc.status]">{{ inc.status.toUpperCase() }}</span>
                    
                    <template v-if="(inc.status === 'open' || inc.status === 'escalated')">
                      <button v-if="!inc.lockedBy" @click="claimIncident(inc)" class="claim-btn" title="Prendi in carico">
                        🔒
                      </button>
                      <button v-if="inc.lockedBy === username" @click="resolveIncident(inc)" class="resolve-btn" title="Risolvi">
                        ✓
                      </button>
                    </template>
                  </div>
                </li>
              </TransitionGroup>
            </div>
          </div>
        </div>

      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { io } from 'socket.io-client';

import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Bar as BarChart } from 'vue-chartjs';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const isJoined = ref(false);
const tempName = ref('');
const username = ref('');
const incidents = ref([]);
const newTitle = ref('');
const onlineUsers = ref([]);
let socket = null;

// -- KPI COMPUTED PROPERTIES --
const totalIncidents = computed(() => incidents.value.length);
const openIncidents = computed(() => incidents.value.filter(i => i.status === 'open').length);
const escalatedIncidents = computed(() => incidents.value.filter(i => i.status === 'escalated').length);
const resolvedIncidents = computed(() => incidents.value.filter(i => i.status === 'closed').length);

// -- DATI PER IL GRAFICO A BARRE (Aggiornato con Escalated) --
const chartData = computed(() => {
  return {
    labels: ['Open', 'Escalated', 'Resolved'],
    datasets: [
      {
        label: 'Tickets',
        backgroundColor: ['#E94560', '#f59e0b', '#10b981'], 
        data: [openIncidents.value, escalatedIncidents.value, resolvedIncidents.value],
        borderRadius: 4, 
        barThickness: 40 
      }
    ]
  };
});

const chartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(255, 255, 255, 0.1)' },
      ticks: { color: '#a1a1aa', stepSize: 1 }
    },
    x: {
      grid: { display: false },
      ticks: { color: '#ffffff' }
    }
  }
});

const joinBoard = async () => {
  if (!tempName.value.trim()) return;
  username.value = tempName.value.trim();
  isJoined.value = true;

  socket = io('/', { path: '/socket.io', auth: { username: username.value } });
  
  socket.on('connect', async () => {
    try {
      const response = await fetch('/api/incidents');
      incidents.value = await response.json();
    } catch (err) {
      console.error("Errore durante la sincronizzazione:", err);
    }
  });

  socket.on('incident_update', (change) => {
    if (change.operationType === 'insert') {
      incidents.value.unshift(change.fullDocument);
    } else if (change.operationType === 'update') {
      const index = incidents.value.findIndex(inc => inc._id === change.documentKey._id);
      if (index !== -1 && change.fullDocument) {
        // Manteniamo l'info del lock locale se presente
        const currentLock = incidents.value[index].lockedBy;
        incidents.value[index] = { ...change.fullDocument, lockedBy: currentLock };
      }
    }
  });

  // Gestione Lock via WebSocket
  socket.on('incident_locked', ({ id, lockedBy }) => {
    const inc = incidents.value.find(i => i._id === id);
    if (inc) inc.lockedBy = lockedBy;
  });

  socket.on('incident_unlocked', ({ id }) => {
    const inc = incidents.value.find(i => i._id === id);
    if (inc) delete inc.lockedBy;
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

const claimIncident = async (inc) => {
  try {
    const response = await fetch(`/api/incidents/${inc._id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value })
    });
    if (!response.ok) {
      const data = await response.json();
      alert(`Impossibile prendere in carico: ${data.message}`);
    }
  } catch (err) {
    console.error("Errore claim:", err);
  }
};

const resolveIncident = async (inc) => {
  try {
    const response = await fetch(`/api/incidents/${inc._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        status: 'closed',
        version: inc.version,
        closedBy: username.value
      })
    });
    if (response.status === 409) {
      alert("⚠️ CONFLITTO! Questo ticket è stato già modificato.");
    }
  } catch (err) {
    console.error("Errore resolve:", err);
  }
};
</script>

<style scoped>
* { box-sizing: border-box; }

.app-container { 
  min-height: 100vh; 
  background-color: #1A1A2E; 
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
  color: #ffffff; 
  padding: 2rem; 
}

.text-light { color: #ffffff; }
.text-yellow { color: #FBBF24; } 
.text-magenta { color: #E94560; } 
.text-orange { color: #f59e0b; }
.text-green { color: #10b981; }

.app-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 2rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem;
}
.header-titles h1 { margin: 0; font-size: 2rem; font-weight: 400; }
.subtitle { color: #a1a1aa; font-size: 0.9rem; margin-top: 0.5rem; }

.header-status {
  display: flex; align-items: center; gap: 10px;
  background: rgba(16, 185, 129, 0.1); padding: 5px 12px; border-radius: 20px;
  color: #10b981; font-size: 0.85rem;
}

.pulse-indicator { width: 10px; height: 10px; background-color: #10b981; border-radius: 50%; animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); } 70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }

.dashboard-wrapper { max-width: 1400px; margin: 0 auto; width: 100%; }
.dashboard-grid {
  display: grid; grid-template-columns: 1fr 2fr 1.5fr; gap: 1.5rem; align-items: start;
}

.card { 
  background-color: #22223B; border-radius: 8px; padding: 1.5rem; 
  box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05);
}
.card-title { margin-top: 0; font-size: 1rem; color: #ffffff; text-align: center; margin-bottom: 1.5rem; font-weight: 500; }

.kpi-column { display: flex; flex-direction: column; gap: 1rem; }
.kpi-card { background-color: #22223B; border-radius: 8px; padding: 1rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); }
.kpi-card h3 { margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #e2e8f0; font-weight: 400; }
.kpi-number {
  font-size: 2rem; font-weight: bold; background-color: rgba(255, 255, 255, 0.05);
  display: inline-block; padding: 0.2rem 1.5rem; border-radius: 50px;
}

.center-column { display: flex; flex-direction: column; gap: 1.5rem; }
.chart-container { position: relative; height: 300px; width: 100%; }

.input-group { display: flex; gap: 1rem; }
.dark-input {
  flex: 1; padding: 0.75rem 1rem; font-size: 1rem; background-color: #1A1A2E; color: white;
  border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; outline: none;
}
.dark-input:focus { border-color: #E94560; }
.magenta-btn {
  background-color: #E94560; color: white; border: none; padding: 0 1.5rem; 
  font-weight: 600; border-radius: 4px; cursor: pointer; transition: 0.2s;
}
.magenta-btn:hover:not(:disabled) { background-color: #d13d56; }
.magenta-btn:disabled { background-color: #4b5563; cursor: not-allowed; }

.scrollable-list { max-height: 500px; overflow-y: auto; padding-right: 5px; }
.scrollable-list::-webkit-scrollbar { width: 6px; }
.scrollable-list::-webkit-scrollbar-track { background: #1A1A2E; }
.scrollable-list::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }

.incident-list { list-style: none; padding: 0; margin: 0; }
.incident-item {
  display: flex; justify-content: space-between; align-items: center; 
  padding: 1rem; background-color: #1A1A2E; border: 1px solid rgba(255,255,255,0.1); 
  border-radius: 4px; margin-bottom: 0.75rem;
}
.incident-info { display: flex; flex-direction: column; gap: 0.25rem; }
.incident-title { font-weight: 600; color: #ffffff; font-size: 1rem; }
.resolved-text { color: #6b7280; text-decoration: line-through; }
.incident-author { font-size: 0.8rem; color: #9ca3af; }

.incident-status-group { display: flex; align-items: center; gap: 0.75rem; }
.resolve-btn, .claim-btn {
  color: white; border: none; border-radius: 50%; width: 28px; height: 28px; 
  cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center;
}
.resolve-btn { background-color: #10b981; }
.resolve-btn:hover { background-color: #0d9488; transform: scale(1.1); }
.claim-btn { background-color: #f59e0b; font-size: 0.8rem; }
.claim-btn:hover { background-color: #d97706; transform: scale(1.1); }

.badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: bold; }
.badge.open { background-color: rgba(233, 69, 96, 0.2); color: #E94560; border: 1px solid #E94560; }
.badge.closed { background-color: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; }
.badge.escalated { background-color: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid #f59e0b; }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 2rem 0; color: #6b7280; }
.list-enter-active, .list-leave-active { transition: all 0.5s ease; }
.list-enter-from { opacity: 0; transform: translateX(-30px); }
.list-leave-to { opacity: 0; transform: translateX(30px); }

.login-wrapper { display: flex; align-items: center; justify-content: center; height: 80vh; width: 100%; }
.login-card { width: 100%; max-width: 450px; text-align: center; }
</style>