<template>
  <div :class="['kanban-col', `col-${variant}`]">
    <h3 :class="['kanban-title', titleColor]">
      {{ title }} <span class="count-badge">{{ incidents.length }}</span>
    </h3>
    <div class="kanban-cards">
      <TransitionGroup name="kanban" tag="div" class="kanban-list">
        <IncidentCard
          v-for="inc in incidents"
          :key="inc._id"
          :incident="inc"
          :variant="variant"
          :current-user="currentUser"
          @claim="emit('claim', $event)"
          @resolve="emit('resolve', $event)"
          @release="emit('release', $event)"
        />
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup>
import IncidentCard from './IncidentCard.vue';

defineProps({
  title: { type: String, required: true },
  variant: { type: String, required: true }, // 'open' | 'progress' | 'escalated' | 'resolved'
  incidents: { type: Array, required: true },
  currentUser: { type: String, required: true },
  // Classe di colore del titolo: solo due colonne ce l'hanno.
  titleColor: { type: String, default: '' }
});

const emit = defineEmits(['claim', 'resolve', 'release']);
</script>

<style scoped>
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

/* Animazioni Vue (TransitionGroup). Stanno qui e non in IncidentCard perché
   le classi le applica la TransitionGroup ai figli che ha in questo template:
   nello scope del figlio non aggancerebbero nulla. */
.kanban-enter-active, .kanban-leave-active { transition: all 0.4s ease; }
.kanban-enter-from, .kanban-leave-to { opacity: 0; transform: translateY(15px); }
.kanban-move { transition: transform 0.4s ease; }
</style>
