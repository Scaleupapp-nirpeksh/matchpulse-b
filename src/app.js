const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const { generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth.routes');
const organizationRoutes = require('./routes/organization.routes');
const tournamentRoutes = require('./routes/tournament.routes');
const teamRoutes = require('./routes/team.routes');
const playerRoutes = require('./routes/player.routes');
const matchRoutes = require('./routes/match.routes');
const scoringRoutes = require('./routes/scoring.routes');
const standingsRoutes = require('./routes/standings.routes');
const notificationRoutes = require('./routes/notification.routes');
const auditRoutes = require('./routes/audit.routes');
const uploadRoutes = require('./routes/upload.routes');

const app = express();

// --- Security Middleware ---
app.use(helmet());
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform'],
}));

// --- Body Parsing ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Logging ---
if (env.isDev()) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// --- Rate Limiting ---
app.use('/api/', generalLimiter);

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'matchpulse-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/scoring', scoringRoutes);
app.use('/api/standings', standingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/upload', uploadRoutes);

// --- API Info ---
app.get('/api', (req, res) => {
  res.json({
    name: 'MatchPulse API',
    version: '1.0.0',
    description: 'Live Sports Tournament Platform',
    docs: '/api/docs',
    endpoints: {
      auth: '/api/auth',
      organizations: '/api/organizations',
      tournaments: '/api/tournaments',
      teams: '/api/teams',
      players: '/api/players',
      matches: '/api/matches',
      scoring: '/api/scoring',
      standings: '/api/standings',
      notifications: '/api/notifications',
      audit: '/api/audit',
      upload: '/api/upload',
    },
  });
});

// --- 404 Handler ---
app.use(notFoundHandler);

// --- Global Error Handler ---
app.use(errorHandler);

module.exports = app;
