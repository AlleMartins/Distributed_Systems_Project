<template>
  <div class="login-wrapper">
    <div class="card login-card">
      <div class="pulse-indicator login-pulse"></div>
      <h2 class="text-light">{{ isLogin ? 'Accedi alla Board' : 'Crea un account' }}</h2>
      <p class="subtitle login-subtitle">
        {{ isLogin
          ? 'Inserisci username e password per accedere alla Dashboard Realtime.'
          : 'Registrati per poter accedere alla Dashboard Realtime.' }}
      </p>

      <form class="col-input" @submit.prevent="submit">
        <input v-model="username" placeholder="Username" class="dark-input" autofocus autocomplete="username" />
        <input v-model="password" type="password" placeholder="Password" class="dark-input" autocomplete="current-password" />
        <p v-if="error" class="auth-error">{{ error }}</p>
        <button type="submit" class="magenta-btn" :disabled="!username.trim() || !password || loading">
          {{ isLogin ? 'Accedi' : 'Registrati' }}
        </button>
      </form>

      <p class="auth-switch">
        <template v-if="isLogin">
          Non hai un account?
          <a href="#" @click.prevent="switchMode('register')">Registrati</a>
        </template>
        <template v-else>
          Hai già un account?
          <a href="#" @click.prevent="switchMode('login')">Accedi</a>
        </template>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

// `error` e `loading` arrivano da chi possiede la sessione: il form non sa
// (e non deve sapere) come si parla con il backend.
defineProps({
  error: { type: String, default: '' },
  loading: { type: Boolean, default: false }
});

const emit = defineEmits(['submit', 'mode-change']);

// Credenziali e modalità sono stato di schermata, non di sessione: restano
// qui e non finiscono nel composable di auth.
const mode = ref('login'); // 'login' | 'register'
const isLogin = computed(() => mode.value === 'login');
const username = ref('');
const password = ref('');

const switchMode = (next) => {
  mode.value = next;
  emit('mode-change');
};

// In caso di errore i campi restano compilati (si corregge e si riprova); in
// caso di successo il componente viene smontato e spariscono con lui.
const submit = () => {
  emit('submit', { mode: mode.value, credentials: { username: username.value.trim(), password: password.value } });
};
</script>

<style scoped>
.login-wrapper { display: flex; align-items: center; justify-content: center; height: 80vh; width: 100%; }
.login-card { width: 100%; max-width: 450px; text-align: center; }
.login-pulse { margin: 0 auto 1rem auto; width: 40px; height: 40px; }
.login-subtitle { margin-bottom: 1.5rem; }
.auth-error { color: #E94560; font-size: 0.85rem; margin: 0; text-align: left; }
.auth-switch { margin-top: 1.25rem; font-size: 0.9rem; color: #a1a1aa; }
.auth-switch a { color: #E94560; text-decoration: none; font-weight: 600; }
.auth-switch a:hover { text-decoration: underline; }
</style>
