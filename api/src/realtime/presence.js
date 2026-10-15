const { authenticateSocket } = require('../auth');

const registerPresence = (io) => {
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
