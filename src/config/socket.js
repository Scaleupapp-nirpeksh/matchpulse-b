const { Server } = require('socket.io');
const env = require('./env');

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Join match room
    socket.on('join:match', (matchId) => {
      socket.join(`match:${matchId}`);
      console.log(`Socket ${socket.id} joined match:${matchId}`);
    });

    // Leave match room
    socket.on('leave:match', (matchId) => {
      socket.leave(`match:${matchId}`);
    });

    // Join tournament room
    socket.on('join:tournament', (tournamentId) => {
      socket.join(`tournament:${tournamentId}`);
    });

    // Leave tournament room
    socket.on('leave:tournament', (tournamentId) => {
      socket.leave(`tournament:${tournamentId}`);
    });

    // Join org room
    socket.on('join:org', (orgId) => {
      socket.join(`org:${orgId}`);
    });

    // Leave org room
    socket.on('leave:org', (orgId) => {
      socket.leave(`org:${orgId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initSocket(httpServer) first.');
  }
  return io;
};

module.exports = { initSocket, getIO };
