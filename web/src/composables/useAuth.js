import { ref } from 'vue';
import { authApi, ApiError } from '../services/api.js';

const TOKEN_KEY = 'authToken';
const USERNAME_KEY = 'authUsername';

/*
 * Sessione dell'utente. L'auth del backend è stateless (JWT firmato con un
 * secret condiviso da tutte le repliche), quindi al client basta conservare
 * il token: non esiste una sessione lato server da ristabilire, né un pod
 * "suo" a cui tornare dopo un reload.
 *
 * Qui NON si tocca il socket: connessione e disconnessione le orchestra
 * App.vue, così questo modulo non deve conoscere il trasporto realtime e il
 * realtime non deve conoscere il form di login.
 */
export const createAuth = ({ toast }) => {
  const token = ref('');
  const username = ref('');
  const isJoined = ref(false);
  const error = ref('');
  const loading = ref(false);

  const resetError = () => { error.value = ''; };

  // Ritorna true se l'autenticazione è riuscita: chi chiama lo usa per
  // decidere se aprire la connessione realtime.
  const login = async (credentials) => {
    error.value = '';
    loading.value = true;
    try {
      const data = await authApi.login(credentials);
      token.value = data.token;
      username.value = data.username;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      sessionStorage.setItem(USERNAME_KEY, data.username);
      isJoined.value = true;
      toast.success(`Benvenuto nella dashboard, ${username.value}!`);
      return true;
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Errore di rete durante il login.';
      return false;
    } finally {
      loading.value = false;
    }
  };

  const register = async (credentials) => {
    error.value = '';
    loading.value = true;
    try {
      await authApi.register(credentials);
      toast.success('Registrazione completata, accesso in corso...');
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Errore di rete durante la registrazione.';
      return false;
    } finally {
      loading.value = false;
    }
    return login(credentials); // gestisce da sé loading e stato di sessione
  };

  // Il token sopravvive a un reload della pagina (sessionStorage, quindi non
  // alla chiusura della tab): true se c'era una sessione da riprendere.
  const restoreSession = () => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    const savedUsername = sessionStorage.getItem(USERNAME_KEY);
    if (!savedToken || !savedUsername) return false;
    token.value = savedToken;
    username.value = savedUsername;
    isJoined.value = true;
    return true;
  };

  const clearSession = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USERNAME_KEY);
    token.value = '';
    username.value = '';
    error.value = '';
    isJoined.value = false;
  };

  return { token, username, isJoined, error, loading, login, register, restoreSession, clearSession, resetError };
};
