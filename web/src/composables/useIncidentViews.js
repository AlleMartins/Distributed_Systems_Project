import { ref, computed } from 'vue';

/*
 * Viste derivate dalla lista degli incidenti: KPI, filtri e colonne della
 * Kanban. Tutto computed, quindi si ricalcolano da sole a ogni evento
 * applicato allo store.
 */
export const createIncidentViews = ({ incidents, username }) => {
  // -- STATO DEI FILTRI --
  const searchQuery = ref('');
  const showOnlyEscalated = ref(false);
  const showMyTickets = ref(false);

  // -- KPI (NON filtrati: descrivono lo stato globale della board) --
  const totalIncidents = computed(() => incidents.value.length);
  const openIncidents = computed(() => incidents.value.filter(i => i.status === 'open').length);
  const escalatedIncidents = computed(() => incidents.value.filter(i => i.status === 'escalated').length);
  const resolvedIncidents = computed(() => incidents.value.filter(i => i.status === 'closed').length);

  // -- LISTA INCIDENTI FILTRATA --
  const filteredIncidents = computed(() => {
    const query = searchQuery.value.toLowerCase();
    return incidents.value.filter(inc => {
      // 1. Filtro di ricerca testo (case-insensitive)
      const matchesSearch = inc.title.toLowerCase().includes(query);

      // 2. Filtro per stato Escalated
      const matchesEscalated = showOnlyEscalated.value ? inc.status === 'escalated' : true;

      // 3. Filtro per "I Miei Ticket" (creati da me, bloccati da me o chiusi da me)
      const matchesMine = showMyTickets.value
        ? (inc.createdBy === username.value || inc.lockedBy === username.value || inc.closedBy === username.value)
        : true;

      return matchesSearch && matchesEscalated && matchesMine;
    });
  });

  // -- COLONNE DELLA KANBAN (leggono da filteredIncidents) --
  const kanbanOpen = computed(() => filteredIncidents.value.filter(i => i.status === 'open' && !i.lockedBy));
  const kanbanInProgress = computed(() => filteredIncidents.value.filter(i => i.lockedBy && i.status !== 'closed'));
  const kanbanEscalated = computed(() => filteredIncidents.value.filter(i => i.status === 'escalated' && !i.lockedBy));
  const kanbanResolved = computed(() => filteredIncidents.value.filter(i => i.status === 'closed'));

  return {
    searchQuery,
    showOnlyEscalated,
    showMyTickets,
    totalIncidents,
    openIncidents,
    escalatedIncidents,
    resolvedIncidents,
    kanbanOpen,
    kanbanInProgress,
    kanbanEscalated,
    kanbanResolved
  };
};
