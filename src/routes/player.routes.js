const express = require('express');
const router = express.Router();
const playerController = require('../controllers/player.controller');
const { authenticate } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');

// Public routes
router.get('/:playerId', playerController.getProfile);
router.get('/:playerId/stats', playerController.getStats);
router.get('/:playerId/matches', playerController.getMatches);
router.get('/org/:orgId', playerController.getByOrg);

// Protected routes (admin only)
router.put('/:playerId', authenticate, requireMinRole('tournament_admin'), playerController.update);

module.exports = router;
