const express = require('express');
const router = express.Router();
const standingsController = require('../controllers/standings.controller');
const { authenticate } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');

// Public routes
router.get('/tournament/:tournamentId', standingsController.getStandings);

// Admin routes
router.post('/tournament/:tournamentId/recalculate', authenticate, requireMinRole('tournament_admin'), standingsController.recalculate);

module.exports = router;
