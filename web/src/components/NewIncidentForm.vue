<template>
  <div class="card">
    <h3 class="card-title">Register New Incident</h3>
    <div class="col-input">
      <input
        v-model="title"
        @keyup.enter="emit('submit')"
        placeholder="Describe the incident..."
        class="dark-input"
      />
      <button @click="emit('submit')" class="magenta-btn" :disabled="!title.trim()">Submit</button>
    </div>
  </div>
</template>

<script setup>
// Il titolo è in v-model verso il genitore: è lui a sapere se la POST è
// andata a buon fine, e solo in quel caso svuota il campo. Se lo svuotasse
// questo componente, un errore del server farebbe perdere il testo digitato.
const title = defineModel({ type: String, required: true });

const emit = defineEmits(['submit']);
</script>
