<template>
  <div class="kanban-board">
    <KanbanColumn
      title="Open"
      variant="open"
      :incidents="open"
      :current-user="currentUser"
      v-bind="handlers"
    />
    <KanbanColumn
      title="In Progress"
      variant="progress"
      :incidents="inProgress"
      :current-user="currentUser"
      v-bind="handlers"
    />
    <KanbanColumn
      title="Escalated"
      variant="escalated"
      title-color="text-orange"
      :incidents="escalated"
      :current-user="currentUser"
      v-bind="handlers"
    />
    <KanbanColumn
      title="Resolved"
      variant="resolved"
      title-color="text-green"
      :incidents="resolved"
      :current-user="currentUser"
      v-bind="handlers"
    />
  </div>
</template>

<script setup>
import KanbanColumn from './KanbanColumn.vue';

defineProps({
  open: { type: Array, required: true },
  inProgress: { type: Array, required: true },
  escalated: { type: Array, required: true },
  resolved: { type: Array, required: true },
  currentUser: { type: String, required: true }
});

const emit = defineEmits(['claim', 'resolve', 'release']);

// Le colonne inoltrano gli stessi tre eventi: li rigiriamo tali e quali al
// genitore, che è l'unico a sapere come si parla con il backend.
const handlers = {
  onClaim: (inc) => emit('claim', inc),
  onResolve: (inc) => emit('resolve', inc),
  onRelease: (inc) => emit('release', inc)
};
</script>

<style scoped>
.kanban-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; align-items: start; }
</style>
