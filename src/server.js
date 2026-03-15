const http = require('http');
const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');
const { initSocket } = require('./config/socket');
const { setupHandlers } = require('./socket');

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize Socket.io
    const io = initSocket(server);
    setupHandlers(io);
    console.log('🔌 Socket.io initialized');

    // Start listening
    server.listen(env.PORT, () => {
      console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║   🏆  MatchPulse Backend Server              ║
║                                              ║
║   Environment : ${env.NODE_ENV.padEnd(28)}║
║   Port        : ${String(env.PORT).padEnd(28)}║
║   MongoDB     : Connected                    ║
║   Socket.io   : Ready                        ║
║                                              ║
║   API         : http://localhost:${env.PORT}/api     ║
║   Health      : http://localhost:${env.PORT}/health  ║
║                                              ║
╚══════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n⚠️  ${signal} received. Shutting down gracefully...`);

      server.close(() => {
        console.log('✅ HTTP server closed');
      });

      // Close socket connections
      io.close(() => {
        console.log('✅ Socket.io connections closed');
      });

      // Close MongoDB connection
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed');

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection:', reason);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

startServer();
