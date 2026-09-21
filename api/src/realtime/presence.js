// Utenti online.
// NOTA: prima qui si manteneva manualmente un Hash su Redis
// (active_users) aggiornato via hSet/hDel. Il problema: se un pod viene
// terminato in modo non pulito (rollout restart, crash, OOM), il
// 'disconnect' non scatta mai lato server per quei socket, e le loro entry
// restano per sempre nell'hash — contatore "utenti online" che cresce
// all'infinito ad ogni riavvio non pulito.
// Fix: io.fetchSockets(), che interroga in tempo reale (via adapter Redis)
// TUTTI i pod per sapere chi è REALMENTE connesso in questo momento.
// Nessuno stato duplicato da mantenere sincronizzato: Socket.IO rileva le
// connessioni morte tramite il proprio protocollo di heartbeat (ping/pong
// su engine.io), indipendentemente da un 'disconnect' pulito, quindi il
// conteggio si autocorregge da solo.
// Non reintrodurre un registro su Redis.
const { authenticateSocket } = require('../auth');

const registerPresence = (io) => {
  // Autenticazione dell'handshake. Vive in auth.js insieme al middleware
  // REST perché le due porte devono verificare la stessa identità con lo
  // stesso secret.
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const broadcastActiveUsers = async () => {
      const sockets = await io.fetchSockets();
      const uniqueUsers = [...new Set(sockets.map(s => s.data.username))];
      io.emit('users_update', uniqueUsers);
    };

    await broadcastActiveUsers();

    socket.on('disconnect', async () => {
      await broadcastActiveUsers();
    });
  });
};

module.exports = { registerPresence };
