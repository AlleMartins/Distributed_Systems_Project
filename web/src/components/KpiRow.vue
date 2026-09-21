<template>
  <div class="kpi-row">
    <div class="kpi-card">
      <h3>Total Tickets</h3>
      <div class="kpi-number text-yellow">{{ total }}</div>
    </div>
    <div class="kpi-card">
      <h3>Open Tickets</h3>
      <div class="kpi-number text-magenta">{{ open }}</div>
    </div>
    <div class="kpi-card">
      <h3>Escalated Tickets</h3>
      <div class="kpi-number text-orange">{{ escalated }}</div>
    </div>
    <div class="kpi-card">
      <h3>Resolved Tickets</h3>
      <div class="kpi-number text-green">{{ resolved }}</div>
    </div>
    <div class="kpi-card">
      <h3>Users Online</h3>
      <div class="kpi-number text-yellow">{{ online }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  total: { type: Number, required: true },
  open: { type: Number, required: true },
  escalated: { type: Number, required: true },
  resolved: { type: Number, required: true },
  online: { type: Number, required: true }
});
</script>

<style scoped>
.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; }
.kpi-card { background-color: #22223B; border-radius: 8px; padding: 1rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
.kpi-card h3 { margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #e2e8f0; font-weight: 400; }
.kpi-number { font-size: 2rem; font-weight: bold; background-color: rgba(255, 255, 255, 0.05); display: inline-block; padding: 0.2rem 1.5rem; border-radius: 50px; }
</style>
