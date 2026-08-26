<template>
  <div class="app-container">
    <!-- Schermata di Login (Dark Mode) -->
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

    <!-- Dashboard Layout (Kanban Edition con Filtri) -->
    <div v-else class="dashboard-wrapper">
      <header class="app-header">
        <div class="header-titles">
          <h1>Real-Time Incident Kanban Board</h1>
          <p class="subtitle">Following dashboard illustrates KPIs and Ticket Flow in real-time. Connected as: <strong>{{ username }}</strong></p>
        </div>
        <div class="header-status">
          <div class="pulse-indicator"></div>
          <span>Live Sync Active</span>
        </div>
      </header>

      <main class="dashboard-grid">
        
        <!-- RIGA 1: KPI Cards Orizzontali -->
        <div class="kpi-row">
          <div class="kpi-card">
            <h3>Total Tickets</h3>
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

        <!-- RIGA 2: Grafico e Creazione -->
        <div class="middle-row">
          <div class="card chart-card">
            <h3 class="card-title">Incidents Status Overview</h3>
            <div class="chart-container">
              <BarChart v-if="totalIncidents > 0" :data="chartData" :options="chartOptions" />
              <div v-else class="empty-state">No data available</div>
            </div>
          </div>

          <div class="card creation-card">
            <h3 class="card-title">Register New Incident</h3>
            <div class="input-group col-input">
              <input v-model="newTitle" @keyup.enter="createIncident" placeholder="Describe the incident..." class="modern-input dark-input" />
              <button @click="createIncident" class="modern-btn magenta-btn" :disabled="!newTitle.trim()">Submit</button>
            </div>
          </div>
        </div>

        <!-- NUOVA RIGA 2.5: FILTRI E RICERCA REATTIVA -->
        <div class="filters-row">
          <div class="search-box">
            <input 
              v-model="searchQuery" 
              placeholder="🔍 Cerca per titolo dell'incidente..." 
              class="modern-input dark-input search-input" 
            />
          </div>
          <div class="toggle-group">
            <button 
              @click="showOnlyEscalated = !showOnlyEscalated" 
              :class="['toggle-btn', { 'active-orange': showOnlyEscalated }]"
            >
              ⚠️ Mostra solo Escalated
            </button>
            <button 
              @click="showMyTickets = !showMyTickets" 
              :class="['toggle-btn', { 'active-blue': showMyTickets }]"
            >
              👤 I Miei Ticket
            </button>
          </div>
        </div>

        <!-- RIGA 3: LA KANBAN BOARD -->
        <div class="kanban-board">
          
          <!-- Colonna: OPEN -->
          <div class="kanban-col col-open">
            <h3 class="kanban-title">Open <span class="count-badge">{{ kanbanOpen.length }}</span></h3>
            <div class="kanban-cards">
              <TransitionGroup name="kanban" tag="div" class="kanban-list">
                <div v-for="inc in kanbanOpen" :key="inc._id" class="kanban-card">
                  <div class="card-head">
                    <span class="ticket-title">{{ inc.title }}</span>
                  </div>
                  <div class="card-body">
                    <small class="text-muted">Reported by: {{ inc.createdBy || 'Anonimo' }}</small>
                  </div>
                  <div class="card-actions">
                    <button @click="claimIncident(inc)" class="claim-btn wide-btn" title="Prendi in carico">
                      🔒 Claim Ticket
                    </button>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- Colonna: IN PROGRESS (Locked) -->
          <div class="kanban-col col-progress">
            <h3 class="kanban-title">In Progress <span class="count-badge">{{ kanbanInProgress.length }}</span></h3>
            <div class="kanban-cards">
              <TransitionGroup name="kanban" tag="div" class="kanban-list">
                <div v-for="inc in kanbanInProgress" :key="inc._id" class="kanban-card in-progress-card">
                  <div class="card-head">
                    <span class="ticket-title">{{ inc.title }}</span>
                    <span v-if="inc.status === 'escalated'" class="badge escalated">ESCALATED</span>
                  </div>
                  <div class="card-body">
                    <small class="text-blue">🔒 Locked by: <strong>{{ inc.lockedBy }}</strong></small>
                  </div>
                  <div class="card-actions dual-actions" v-if="inc.lockedBy === username">
                    <button @click="resolveIncident(inc)" class="resolve-btn wide-btn" title="Risolvi">✓ Resolve</button>
                    <button @click="releaseClaim(inc)" class="release-btn wide-btn" title="Rilascia">✕ Release</button>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- Colonna: ESCALATED -->
          <div class="kanban-col col-escalated">
            <h3 class="kanban-title text-orange">Escalated <span class="count-badge">{{ kanbanEscalated.length }}</span></h3>
            <div class="kanban-cards">
              <TransitionGroup name="kanban" tag="div" class="kanban-list">
                <div v-for="inc in kanbanEscalated" :key="inc._id" class="kanban-card escalated-card">
                  <div class="card-head">
                    <span class="ticket-title">{{ inc.title }}</span>
                  </div>
                  <div class="card-body">
                    <small class="text-orange">⚠️ Exceeded SLA Time</small>
                  </div>
                  <div class="card-actions">
                    <button @click="claimIncident(inc)" class="claim-btn wide-btn" title="Prendi in carico">
                      🔒 Claim Escalation
                    </button>
                  </div>
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- Colonna: RESOLVED -->
          <div class="kanban-col col-resolved">
            <h3 class="kanban-title text-green">Resolved <span class="count-badge">{{ kanbanResolved.length }}</span></h3>
            <div class="kanban-cards">
              <TransitionGroup name="kanban" tag="div" class="kanban-list">
                <div v-for="inc in kanbanResolved" :key="inc._id" class="kanban-card resolved-card">
                  <div class="card-head">
                    <span class="ticket-title resolved-text">{{ inc.title }}</span>
                  </div>
                  <div class="card-body">
                    <small class="text-green">✓ Solved by: <strong>{{ inc.closedBy }}</strong></small>
                  </div>
                </div>
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
import { useToast } from 'vue-toastification';

import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Bar as BarChart } from 'vue-chartjs';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const toast = useToast();
const isJoined = ref(false);
const tempName = ref('');
const username = ref('');
const incidents = ref([]);
const newTitle = ref('');
const onlineUsers = ref([]);
let socket = null;

// -- STATO DEI FILTRI --
const searchQuery = ref('');
const showOnlyEscalated = ref(false);
const showMyTickets = ref(false);

// -- KPI COMPUTED PROPERTIES (Non filtrate per mostrare lo stato globale) --
const totalIncidents = computed(() => incidents.value.length);
const openIncidents = computed(() => incidents.value.filter(i => i.status === 'open').length);
const escalatedIncidents = computed(() => incidents.value.filter(i => i.status === 'escalated').length);
const resolvedIncidents = computed(() => incidents.value.filter(i => i.status === 'closed').length);

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
    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#a1a1aa', stepSize: 1 } },
    x: { grid: { display: false }, ticks: { color: '#ffffff' } }
  }
});

// -- LISTA INCIDENTI FILTRATA REATTIVA --
const filteredIncidents = computed(() => {
  return incidents.value.filter(inc => {
    // 1. Filtro di ricerca testo (case-insensitive)
    const matchesSearch = inc.title.toLowerCase().includes(searchQuery.value.toLowerCase());
    
    // 2. Filtro per stato Escalated
    const matchesEscalated = showOnlyEscalated.value ? inc.status === 'escalated' : true;
    
    // 3. Filtro per "I Miei Ticket" (Creati da me o bloccati da me o chiusi da me)
    const matchesMine = showMyTickets.value 
      ? (inc.createdBy === username.value || inc.lockedBy === username.value || inc.closedBy === username.value) 
      : true;

    return matchesSearch && matchesEscalated && matchesMine;
  });
});

// -- KANBAN COMPUTED PROPERTIES (Ora leggono da filteredIncidents anziché da incidents) --
const kanbanOpen = computed(() => filteredIncidents.value.filter(i => i.status === 'open' && !i.lockedBy));
const kanbanInProgress = computed(() => filteredIncidents.value.filter(i => i.lockedBy && i.status !== 'closed'));const kanbanEscalated = computed(() => filteredIncidents.value.filter(i => i.status === 'escalated' && !i.lockedBy));
const kanbanResolved = computed(() => filteredIncidents.value.filter(i => i.status === 'closed'));

const joinBoard = async () => {
  if (!tempName.value.trim()) return;
  username.value = tempName.value.trim();
  isJoined.value = true;
  toast.success(`Benvenuto nella dashboard, ${username.value}!`);

  socket = io('/', { path: '/socket.io', auth: { username: username.value } });

  // Contatore di "generazione" della connessione: incrementato ad ogni
  // 'connect' (prima connessione + ogni reconnect automatico). Serve a
  // scartare risposte fetch "in ritardo": se nel frattempo il socket si è
  // già riconnesso di nuovo (es. durante un rolling update dei pod api) e
  // arriva un evento più recente, non vogliamo che la fetch di resync
  // della connessione precedente, risolta tardi, sovrascriva uno stato
  // già più fresco con uno stale.
  let connectionGeneration = 0;

  socket.on('connect', async () => {
    const myGeneration = ++connectionGeneration;
    try {
      const response = await fetch('/api/incidents');
      const data = await response.json();
      // Se nel frattempo c'è stato un altro reconnect (myGeneration stale),
      // scartiamo questa risposta invece di applicarla comunque.
      if (myGeneration === connectionGeneration) {
        incidents.value = data;
      }
    } catch (err) {
      console.error("Errore durante la sincronizzazione:", err);
      toast.error("Errore di connessione al database.");
    }
  });

  socket.on('incident_update', (change) => {
    if (change.operationType === 'insert') {
      incidents.value.unshift(change.fullDocument);
      if (change.fullDocument.createdBy !== username.value) {
        toast.info(`Nuovo ticket registrato: ${change.fullDocument.title}`);
      }
    } else if (change.operationType === 'update') {
      const index = incidents.value.findIndex(inc => inc._id === change.documentKey._id);
      if (index !== -1 && change.fullDocument) {
        const oldIncident = incidents.value[index];
        const currentLock = oldIncident.lockedBy;

        if (oldIncident.status !== 'escalated' && change.fullDocument.status === 'escalated') {
          toast.warning(`⚠️ Attenzione: Il ticket "${change.fullDocument.title}" ha superato i limiti SLA ed è stato ESCALATO!`, { timeout: 8000 });
        }
        if (oldIncident.status !== 'closed' && change.fullDocument.status === 'closed' && change.fullDocument.closedBy !== username.value) {
          toast.success(`Il ticket "${change.fullDocument.title}" è stato risolto da ${change.fullDocument.closedBy}`);
        }

        incidents.value[index] = { ...change.fullDocument, lockedBy: currentLock };
      }
    }
  });

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
  toast.success("Incidente registrato con successo!");
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
      let message = `HTTP ${response.status}`;
      try { const data = await response.json(); message = data.message || data.error || message; } catch {}
      toast.error(`Impossibile prendere in carico: ${message}`);
    } else {
      toast.success("Hai preso in carico il ticket.");
    }
  } catch (err) {
    console.error("Errore claim:", err);
    toast.error('Errore di rete durante la presa in carico.');
  }
};

const releaseClaim = async (inc) => {
  try {
    const response = await fetch(`/api/incidents/${inc._id}/claim`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value })
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { const data = await response.json(); message = data.error || message; } catch {}
      toast.error(`Impossibile rilasciare: ${message}`);
    } else {
      toast.info("Lock rilasciato.");
    }
  } catch (err) {
    console.error("Errore release:", err);
    toast.error('Errore di rete durante il rilascio.');
  }
};

const resolveIncident = async (inc) => {
  try {
    const response = await fetch(`/api/incidents/${inc._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed', version: inc.version, closedBy: username.value })
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { const data = await response.json(); message = data.error || message; } catch {}
      toast.error(`⚠️ Conflitto o errore: ${message}`);
    } else {
      toast.success("Ticket risolto correttamente!");
    }
  } catch (err) {
    console.error("Errore resolve:", err);
    toast.error('Errore di rete durante la risoluzione.');
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
.text-blue { color: #3b82f6; }
.text-muted { color: #9ca3af; }

.app-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem;
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

.dashboard-wrapper { max-width: 1600px; margin: 0 auto; width: 100%; }
.dashboard-grid { display: flex; flex-direction: column; gap: 1.5rem; }

/* -- RIGA KPI -- */
.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; }
.kpi-card { background-color: #22223B; border-radius: 8px; padding: 1rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
.kpi-card h3 { margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #e2e8f0; font-weight: 400; }
.kpi-number { font-size: 2rem; font-weight: bold; background-color: rgba(255, 255, 255, 0.05); display: inline-block; padding: 0.2rem 1.5rem; border-radius: 50px; }

/* -- RIGA CHART & CREATION -- */
.middle-row { display: grid; grid-template-columns: 2.5fr 1fr; gap: 1.5rem; }
.card { background-color: #22223B; border-radius: 8px; padding: 1.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); }
.card-title { margin-top: 0; font-size: 1rem; color: #ffffff; text-align: center; margin-bottom: 1.5rem; font-weight: 500; }
.chart-container { position: relative; height: 250px; width: 100%; }
.col-input { flex-direction: column; }
.dark-input { width: 100%; padding: 0.75rem 1rem; font-size: 1rem; background-color: #1A1A2E; color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; outline: none; }
.dark-input:focus { border-color: #E94560; }
.magenta-btn { background-color: #E94560; color: white; border: none; padding: 0.75rem; font-weight: 600; border-radius: 4px; cursor: pointer; transition: 0.2s; }
.magenta-btn:hover:not(:disabled) { background-color: #d13d56; }
.magenta-btn:disabled { background-color: #4b5563; cursor: not-allowed; }

/* -- BARRA DEI FILTRI -- */
.filters-row { display: flex; gap: 1rem; align-items: center; background-color: #22223B; padding: 1rem 1.5rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
.search-box { flex: 1; }
.search-input { width: 100%; border-radius: 20px; padding: 0.6rem 1.5rem; font-size: 0.95rem; }
.toggle-group { display: flex; gap: 0.75rem; }
.toggle-btn { background-color: #1A1A2E; color: #a1a1aa; border: 1px solid rgba(255,255,255,0.2); padding: 0.6rem 1.2rem; border-radius: 20px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; font-size: 0.9rem; }
.toggle-btn:hover { border-color: #ffffff; color: #ffffff; }
.toggle-btn.active-orange { background-color: rgba(245, 158, 11, 0.2); border-color: #f59e0b; color: #f59e0b; }
.toggle-btn.active-blue { background-color: rgba(59, 130, 246, 0.2); border-color: #3b82f6; color: #3b82f6; }

/* -- KANBAN BOARD -- */
.kanban-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; align-items: start; }
.kanban-col { background-color: #1e1e36; border-radius: 8px; padding: 1rem; min-height: 400px; border-top: 4px solid transparent; display: flex; flex-direction: column; }
.col-open { border-top-color: #E94560; }
.col-progress { border-top-color: #3b82f6; }
.col-escalated { border-top-color: #f59e0b; }
.col-resolved { border-top-color: #10b981; }

.kanban-title { font-size: 1.1rem; text-align: center; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); }
.count-badge { background-color: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 10px; font-size: 0.8rem; margin-left: 5px; }

/* Contenitore con scroll per gestire l'overflow */
.kanban-cards { 
  display: flex; 
  flex-direction: column; 
  flex-grow: 1; 
  max-height: 500px; 
  overflow-y: auto;  
  padding-right: 8px; 
}

.kanban-cards::-webkit-scrollbar { width: 6px; }
.kanban-cards::-webkit-scrollbar-track { background: transparent; }
.kanban-cards::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }
.kanban-cards::-webkit-scrollbar-thumb:hover { background: #6b7280; }

.kanban-list { min-height: 100px; display: flex; flex-direction: column; gap: 0.75rem; }

/* Kanban Card Styles */
.kanban-card { background-color: #2A2A4A; border-radius: 6px; padding: 1rem; border-left: 4px solid transparent; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
.kanban-card.in-progress-card { border-left-color: #3b82f6; }
.kanban-card.escalated-card { border-left-color: #f59e0b; }
.kanban-card.resolved-card { border-left-color: #10b981; opacity: 0.8; }

.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.ticket-title { font-weight: 600; font-size: 1rem; }
.resolved-text { text-decoration: line-through; color: #9ca3af; }
.card-body { margin-bottom: 1rem; }

/* Buttons in Kanban */
.card-actions { display: flex; gap: 0.5rem; }
.dual-actions { justify-content: space-between; }
.wide-btn { flex: 1; padding: 0.5rem; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: white; transition: 0.2s; font-size: 0.85rem; }
.claim-btn { background-color: rgba(245, 158, 11, 0.9); }
.claim-btn:hover { background-color: #d97706; }
.resolve-btn { background-color: rgba(16, 185, 129, 0.9); }
.resolve-btn:hover { background-color: #0d9488; }
.release-btn { background-color: rgba(107, 114, 128, 0.9); }
.release-btn:hover { background-color: #4b5563; }

.badge { padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.65rem; font-weight: bold; }
.badge.escalated { background-color: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid #f59e0b; }

/* Animazioni Vue (TransitionGroup) */
.kanban-enter-active, .kanban-leave-active { transition: all 0.4s ease; }
.kanban-enter-from, .kanban-leave-to { opacity: 0; transform: translateY(15px); }
.kanban-move { transition: transform 0.4s ease; }

.login-wrapper { display: flex; align-items: center; justify-content: center; height: 80vh; width: 100%; }
.login-card { width: 100%; max-width: 450px; text-align: center; }
</style>