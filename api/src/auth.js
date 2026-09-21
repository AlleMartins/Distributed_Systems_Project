// Autenticazione JWT, condivisa fra REST e WebSocket.
// Stanno insieme di proposito: sono due porte d'ingresso allo stesso
// sistema e devono verificare la stessa identità con lo stesso secret.
// Separarle inviterebbe a farle divergere, ed è proprio la divergenza che
// in passato aveva lasciato l'handshake socket senza verifica.
//
// Nessuna delle due è una factory: non dipendono da `db` né da Redis,
// perché il token porta con sé tutto il necessario per essere verificato.
// È esattamente ciò che rende l'auth stateless e quindi compatibile con
// richieste dello stesso utente che atterrano su repliche diverse.
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('./config');

// Middleware REST.
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token di autenticazione mancante' });
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = { username: payload.sub };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

// Middleware sull'handshake Socket.IO: prima lo username veniva preso a
// occhi chiusi da socket.handshake.auth.username, cioè qualunque client
// poteva connettersi dichiarando l'identità di un altro utente.
// L'identità finisce in socket.data ed è da lì che va letta: mai dal
// payload dei messaggi.
function authenticateSocket(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    return next(new Error('unauthorized'));
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    socket.data.username = payload.sub;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
}

module.exports = { authenticate, authenticateSocket };
