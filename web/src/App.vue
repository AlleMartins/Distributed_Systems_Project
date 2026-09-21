<template>
  <div class="app-container">
    <!-- Schermata di Login / Registrazione -->
    <AuthCard
      v-if="!isJoined"
      :error="authError"
      :loading="authLoading"
      @submit="submitAuth"
      @mode-change="resetError"
    />

    <!-- Dashboard (Kanban + KPI + filtri) -->
    <div v-else class="dashboard-wrapper">
      <AppHeader :username="username" @logout="signOut" />

      <main class="dashboard-grid">
        <KpiRow
          :total="totalIncidents"
          :open="openIncidents"
          :escalated="escalatedIncidents"
          :resolved="resolvedIncidents"
          :online="onlineUsers.length"
        />

        <div class="middle-row">
          <IncidentsChart
            :total="totalIncidents"
            :open="openIncidents"
            :escalated="escalatedIncidents"
            :resolved="resolvedIncidents"
          />
          <NewIncidentForm v-model="newTitle" @submit="submitNewIncident" />
        </div>

        <FiltersBar
          v-model:search="searchQuery"
          v-model:only-escalated="showOnlyEscalated"
          v-model:only-mine="showMyTickets"
        />

        <KanbanBoard
          :open="kanbanOpen"
          :in-progress="kanbanInProgress"
          :escalated="kanbanEscalated"
          :resolved="kanbanResolved"
          :current-user="username"
          @claim="claimIncident"
          @resolve="resolveIncident"
          @release="releaseClaim"
        />
      </main>
    </div>
  </div>
</template>

<script setup>
/*
 * Wiring dell'applicazione: qui si creano i composable e si collegano fra
 * loro, come index.js fa lato backend. La logica sta nei moduli
 * (composables/, services/), la presentazione nei componenti.
 *
 * Le dipendenze si passano esplicitamente invece di essere importate da uno
 * stato globale, così ogni modulo dichiara nella firma di cosa ha bisogno e
 * non esistono due copie dello stesso stato.
 */
import { ref, onMounted } from 'vue';
import { useToast } from 'vue-toastification';

import AuthCard from './components/AuthCard.vue';
import AppHeader from './components/AppHeader.vue';
import KpiRow from './components/KpiRow.vue';
import IncidentsChart from './components/IncidentsChart.vue';
import NewIncidentForm from './components/NewIncidentForm.vue';
import FiltersBar from './components/FiltersBar.vue';
import KanbanBoard from './components/KanbanBoard.vue';

import { createIncidentsApi } from './services/api.js';
import { createAuth } from './composables/useAuth.js';
import { createIncidentsStore } from './composables/useIncidentsStore.js';
import { createIncidentViews } from './composables/useIncidentViews.js';
import { createIncidentActions } from './composables/useIncidentActions.js';
import { createRealtime } from './composables/useRealtime.js';

const toast = useToast();

// Sessione, client REST e stato della board.
const { token, username, isJoined, error: authError, loading: authLoading,
        login, register, restoreSession, clearSession, resetError } = createAuth({ toast });
const api = createIncidentsApi(token);
const store = createIncidentsStore({ username, toast });
const { totalIncidents, openIncidents, escalatedIncidents, resolvedIncidents,
        searchQuery, showOnlyEscalated, showMyTickets,
        kanbanOpen, kanbanInProgress, kanbanEscalated, kanbanResolved } =
  createIncidentViews({ incidents: store.incidents, username });
const { createIncident, claimIncident, releaseClaim, resolveIncident } =
  createIncidentActions({ api, toast });

// Il realtime non conosce il login: se l'handshake viene rifiutato chiede solo
// di chiudere la sessione, e la chiusura la orchestra questo file.
const { onlineUsers, connect, disconnect } = createRealtime({
  token,
  api,
  store,
  toast,
  onUnauthorized: () => signOut()
});

const newTitle = ref('');

const submitAuth = async ({ mode, credentials }) => {
  const authenticated = mode === 'login' ? await login(credentials) : await register(credentials);
  if (authenticated) connect();
};

const signOut = () => {
  disconnect();
  store.reset();
  clearSession();
};

// L'input si svuota solo se l'incidente è stato davvero creato.
const submitNewIncident = async () => {
  if (await createIncident(newTitle.value)) newTitle.value = '';
};

// Un reload della pagina non deve costringere a rifare il login: il token è in
// sessionStorage e la board si ri-idrata da sola al 'connect'.
onMounted(() => {
  if (restoreSession()) connect();
});
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background-color: #1A1A2E;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #ffffff;
  padding: 2rem;
}

.dashboard-wrapper { max-width: 1600px; margin: 0 auto; width: 100%; }
.dashboard-grid { display: flex; flex-direction: column; gap: 1.5rem; }

/* Grafico (largo) accanto al form di creazione (stretto). */
.middle-row { display: grid; grid-template-columns: 2.5fr 1fr; gap: 1.5rem; }
</style>
