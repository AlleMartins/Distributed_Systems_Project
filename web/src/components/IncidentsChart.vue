<template>
  <div class="card">
    <h3 class="card-title">Incidents Status Overview</h3>
    <div class="chart-container">
      <BarChart v-if="total > 0" :data="chartData" :options="chartOptions" />
      <div v-else class="empty-state">No data available</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Bar as BarChart } from 'vue-chartjs';

// La registrazione dei moduli Chart.js sta qui, nell'unico componente che
// disegna un grafico, invece che nell'avvio dell'applicazione.
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps({
  total: { type: Number, required: true },
  open: { type: Number, required: true },
  escalated: { type: Number, required: true },
  resolved: { type: Number, required: true }
});

const chartData = computed(() => ({
  labels: ['Open', 'Escalated', 'Resolved'],
  datasets: [
    {
      label: 'Tickets',
      backgroundColor: ['#E94560', '#f59e0b', '#10b981'],
      data: [props.open, props.escalated, props.resolved],
      borderRadius: 4,
      barThickness: 40
    }
  ]
}));

// Costanti: non cambiano mai, quindi non serve renderle reattive.
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#a1a1aa', stepSize: 1 } },
    x: { grid: { display: false }, ticks: { color: '#ffffff' } }
  }
};
</script>

<style scoped>
.chart-container { position: relative; height: 250px; width: 100%; }
.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af; }
</style>
