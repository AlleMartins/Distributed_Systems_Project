<template>
  <header class="app-header">
    <div class="header-titles">
      <h1>Real-Time Incident Management Dashboard</h1>
      <p class="subtitle">Connected as: <strong>{{ username }}</strong></p>
    </div>
    <div class="header-status">
      <div class="pulse-indicator"></div>
      <span>Live Sync Active</span>
      <button @click="emit('logout')" class="logout-btn" title="Esci">Esci</button>
    </div>
  </header>
</template>

<script setup>
defineProps({
  username: { type: String, required: true }
});

const emit = defineEmits(['logout']);
</script>

<style scoped>
.app-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem;
}
.header-titles h1 { margin: 0; font-size: 2rem; font-weight: 400; }

.header-status {
  display: flex; align-items: center; gap: 10px;
  background: rgba(16, 185, 129, 0.1); padding: 5px 12px; border-radius: 20px;
  color: #10b981; font-size: 0.85rem;
}

.logout-btn { background: none; border: 1px solid rgba(255,255,255,0.2); color: #a1a1aa; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; cursor: pointer; transition: 0.2s; }
.logout-btn:hover { border-color: #E94560; color: #E94560; }
</style>
