// ============================================
// MatchPulse — Socket.io Event Handlers
// ============================================
// Room-based real-time event system
// Rooms: match:{id}, tournament:{id}, org:{id}

const Match = require('../models/Match');

/**
 * Set up socket event handlers
 * Called from config/socket.js after connection
 */
const setupHandlers = (io) => {
  io.on('connection', (socket) => {
    // --- Room Management ---

    socket.on('join:match', async (matchId) => {
      socket.join(`match:${matchId}`);

      // Send current match state on join
      try {
        const match = await Match.findById(matchId)
          .select('currentState status winProbability sportType')
          .lean();

        if (match) {
          socket.emit('match_state', {
            matchId,
            currentState: match.currentState,
            status: match.status,
            winProbability: match.winProbability,
          });
        }
      } catch (err) {
        console.error('Error fetching match state:', err.message);
      }
    });

    socket.on('leave:match', (matchId) => {
      socket.leave(`match:${matchId}`);
    });

    socket.on('join:tournament', (tournamentId) => {
      socket.join(`tournament:${tournamentId}`);
    });

    socket.on('leave:tournament', (tournamentId) => {
      socket.leave(`tournament:${tournamentId}`);
    });

    socket.on('join:org', (orgId) => {
      socket.join(`org:${orgId}`);
    });

    socket.on('leave:org', (orgId) => {
      socket.leave(`org:${orgId}`);
    });

    // --- Basketball Clock Sync ---
    // Spectator requests clock sync
    socket.on('request:clock_sync', async (matchId) => {
      try {
        const match = await Match.findById(matchId)
          .select('currentState sportType')
          .lean();

        if (match && match.currentState) {
          socket.emit('clock_sync', {
            matchId,
            clockSeconds: match.currentState.clockSeconds,
            clockRunning: match.currentState.clockRunning,
            clockStartedAt: match.currentState.clockStartedAt,
            serverTime: Date.now(),
          });
        }
      } catch (err) {
        console.error('Clock sync error:', err.message);
      }
    });

    // --- Typing/Activity Indicators ---
    socket.on('scorer:active', (matchId) => {
      socket.to(`match:${matchId}`).emit('scorer_active', {
        matchId,
        timestamp: Date.now(),
      });
    });

    // --- Connection Quality ---
    socket.on('ping_check', () => {
      socket.emit('pong_check', { serverTime: Date.now() });
    });

    // --- Disconnect ---
    socket.on('disconnect', (reason) => {
      // Rooms are auto-cleaned up on disconnect
    });
  });
};

/**
 * Emit score update to match and tournament rooms
 */
const emitScoreUpdate = (io, matchId, tournamentId, data) => {
  io.to(`match:${matchId}`).emit('score_update', data);
  io.to(`tournament:${tournamentId}`).emit('match_update', {
    matchId,
    currentState: data.currentState,
  });
};

/**
 * Emit match lifecycle event
 */
const emitLifecycleEvent = (io, matchId, tournamentId, action, match) => {
  io.to(`match:${matchId}`).emit('match_lifecycle', { action, match });
  io.to(`tournament:${tournamentId}`).emit('match_update', {
    matchId,
    status: match.status,
    ...(action === 'end' ? { resultSummary: match.resultSummary } : {}),
  });
};

/**
 * Emit AI commentary
 */
const emitCommentary = (io, matchId, eventId, text) => {
  io.to(`match:${matchId}`).emit('commentary', { eventId, text });
};

/**
 * Get room stats (for monitoring)
 */
const getRoomStats = async (io) => {
  const rooms = io.sockets.adapter.rooms;
  const stats = {
    totalConnections: io.sockets.sockets.size,
    matchRooms: 0,
    tournamentRooms: 0,
    orgRooms: 0,
  };

  for (const [room] of rooms) {
    if (room.startsWith('match:')) stats.matchRooms++;
    else if (room.startsWith('tournament:')) stats.tournamentRooms++;
    else if (room.startsWith('org:')) stats.orgRooms++;
  }

  return stats;
};

module.exports = {
  setupHandlers,
  emitScoreUpdate,
  emitLifecycleEvent,
  emitCommentary,
  getRoomStats,
};
