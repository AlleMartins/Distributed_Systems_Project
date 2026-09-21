<template>
  <div :class="['kanban-card', variantClass]">
    <div class="card-head">
      <span :class="['ticket-title', { 'resolved-text': variant === 'resolved' }]">{{ incident.title }}</span>
      <span v-if="variant === 'progress' && incident.status === 'escalated'" class="badge escalated">ESCALATED</span>
    </div>

    <div class="card-body">
      <small v-if="variant === 'open'" class="text-muted">Reported by: {{ incident.createdBy || 'Anonimo' }}</small>
      <small v-else-if="variant === 'progress'" class="text-blue">🔒 Locked by: <strong>{{ incident.lockedBy }}</strong></small>
      <small v-else-if="variant === 'escalated'" class="text-orange">⚠️ Exceeded SLA Time</small>
      <small v-else class="text-green">✓ Solved by: <strong>{{ incident.closedBy }}</strong></small>
    </div>

    <div v-if="variant === 'open' || variant === 'escalated'" class="card-actions">
      <button @click="emit('claim', incident)" class="claim-btn wide-btn" title="Prendi in carico">
        🔒 {{ variant === 'open' ? 'Claim Ticket' : 'Claim Escalation' }}
      </button>
    </div>

    <!-- Resolve e Release esistono solo per il proprietario del lock. Non è
         l'unica difesa: la PATCH lato server pretende comunque di possedere
         il lock, quindi nascondere i bottoni è comodità, non sicurezza. -->
    <div v-else-if="variant === 'progress' && incident.lockedBy === currentUser" class="card-actions dual-actions">
      <button @click="emit('resolve', incident)" class="resolve-btn wide-btn" title="Risolvi">✓ Resolve</button>
      <button @click="emit('release', incident)" class="release-btn wide-btn" title="Rilascia">✕ Release</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  incident: { type: Object, required: true },
  // Colonna di appartenenza: decide corpo della card e azioni disponibili.
  variant: { type: String, required: true }, // 'open' | 'progress' | 'escalated' | 'resolved'
  currentUser: { type: String, required: true }
});

const emit = defineEmits(['claim', 'resolve', 'release']);

const variantClass = computed(() => ({
  open: '',
  progress: 'in-progress-card',
  escalated: 'escalated-card',
  resolved: 'resolved-card'
}[props.variant]));
</script>

<style scoped>
.kanban-card { background-color: #2A2A4A; border-radius: 6px; padding: 1rem; border-left: 4px solid transparent; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
.kanban-card.in-progress-card { border-left-color: #3b82f6; }
.kanban-card.escalated-card { border-left-color: #f59e0b; }
.kanban-card.resolved-card { border-left-color: #10b981; opacity: 0.8; }

.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.ticket-title { font-weight: 600; font-size: 1rem; }
.resolved-text { text-decoration: line-through; color: #9ca3af; }
.card-body { margin-bottom: 1rem; }

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
</style>
