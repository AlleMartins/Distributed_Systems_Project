/*
 * Client REST: unico punto del frontend in cui si costruiscono gli URL
 * /api/... e in cui si legge la risposta del server.
 *
 * Distingue due errori che la UI racconta in modo diverso: il server ha
 * risposto con un codice != 2xx e un messaggio (ApiError, si mostra quel
 * messaggio) oppure la fetch è fallita del tutto (errore di rete).
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const request = async (url, { token, method = 'GET', body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  // Il corpo può mancare o non essere JSON (es. un 502 dell'Ingress): in quel
  // caso resta il codice HTTP a descrivere l'errore.
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Le rotte del backend rispondono con { error } e, sul claim in
    // conflitto, con un { message } più parlante.
    throw new ApiError(data?.message || data?.error || `HTTP ${response.status}`, response.status);
  }
  return data;
};

// Rotte pubbliche: non c'è ancora un token da allegare.
export const authApi = {
  login: (credentials) => request('/api/auth/login', { method: 'POST', body: credentials }),
  register: (credentials) => request('/api/auth/register', { method: 'POST', body: credentials })
};

// Rotte protette. La factory riceve il ref del token invece di leggerlo da
// uno stato globale: come per i moduli del backend, le dipendenze si passano
// e si vedono dalla firma. Il valore è letto a ogni chiamata, così un nuovo
// login non lascia in giro closure con il JWT precedente.
export const createIncidentsApi = (token) => ({
  list: () => request('/api/incidents', { token: token.value }),

  // `status` non si manda: il server lo forza a 'open' (primo stato della
  // macchina a stati), quindi inviarlo darebbe l'idea sbagliata che il client
  // possa sceglierlo.
  create: (title) => request('/api/incidents', { token: token.value, method: 'POST', body: { title } }),

  claim: (id) => request(`/api/incidents/${id}/claim`, { token: token.value, method: 'POST' }),
  release: (id) => request(`/api/incidents/${id}/claim`, { token: token.value, method: 'DELETE' }),

  // `version` viaggia insieme allo stato: è il controllo di concorrenza
  // ottimistico lato server (409 se il documento è cambiato nel frattempo).
  resolve: (id, version) => request(`/api/incidents/${id}`, {
    token: token.value,
    method: 'PATCH',
    body: { status: 'closed', version }
  })
});
