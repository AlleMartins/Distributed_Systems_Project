<template>
  <div class="filters-row">
    <div class="search-box">
      <input
        v-model="search"
        placeholder="🔍 Cerca per titolo dell'incidente..."
        class="dark-input search-input"
      />
    </div>
    <div class="toggle-group">
      <button
        @click="onlyEscalated = !onlyEscalated"
        :class="['toggle-btn', { 'active-orange': onlyEscalated }]"
      >
        ⚠️ Mostra solo Escalated
      </button>
      <button
        @click="onlyMine = !onlyMine"
        :class="['toggle-btn', { 'active-blue': onlyMine }]"
      >
        👤 I Miei Ticket
      </button>
    </div>
  </div>
</template>

<script setup>
// I filtri sono puramente locali: nessuna chiamata al backend, la lista è già
// tutta in memoria e le viste derivate si ricalcolano da sole.
const search = defineModel('search', { type: String, required: true });
const onlyEscalated = defineModel('onlyEscalated', { type: Boolean, required: true });
const onlyMine = defineModel('onlyMine', { type: Boolean, required: true });
</script>

<style scoped>
.filters-row { display: flex; gap: 1rem; align-items: center; background-color: #22223B; padding: 1rem 1.5rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
.search-box { flex: 1; }
.search-input { width: 100%; border-radius: 20px; padding: 0.6rem 1.5rem; font-size: 0.95rem; }
.toggle-group { display: flex; gap: 0.75rem; }
.toggle-btn { background-color: #1A1A2E; color: #a1a1aa; border: 1px solid rgba(255,255,255,0.2); padding: 0.6rem 1.2rem; border-radius: 20px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; font-size: 0.9rem; }
.toggle-btn:hover { border-color: #ffffff; color: #ffffff; }
.toggle-btn.active-orange { background-color: rgba(245, 158, 11, 0.2); border-color: #f59e0b; color: #f59e0b; }
.toggle-btn.active-blue { background-color: rgba(59, 130, 246, 0.2); border-color: #3b82f6; color: #3b82f6; }
</style>
