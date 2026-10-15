// Autenticazione JWT, condivisa fra REST e WebSocket.
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
