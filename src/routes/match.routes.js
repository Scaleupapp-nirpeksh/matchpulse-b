const express = require('express');
const router = express.Router();
const matchController = require('../controllers/match.controller');
const { authenticate } = require('../middleware/auth');
const { requireMinRole, requireScorerOrAdmin } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createMatchValidation,
  updateMatchValidation,
  assignScorerValidation,
  matchLifecycleValidation,
} = require('../validators/match.validator');

// Public routes
router.get('/live', matchController.getLive);
router.get('/tournament/:tournamentId', matchController.getByTournament);
router.get('/:matchId', matchController.getById);

// Protected routes
router.post('/', authenticate, requireMinRole('tournament_admin'), createMatchValidation, validate, matchController.create);
router.put('/:matchId', authenticate, requireMinRole('tournament_admin'), updateMatchValidation, validate, matchController.update);
router.put('/:matchId/scorer', authenticate, requireMinRole('tournament_admin'), assignScorerValidation, validate, matchController.assignScorer);

// Scorer routes
router.post('/:matchId/lifecycle', authenticate, requireScorerOrAdmin, matchLifecycleValidation, validate, matchController.lifecycle);
router.get('/scorer/my-matches', authenticate, matchController.getScorerMatches);

module.exports = router;
