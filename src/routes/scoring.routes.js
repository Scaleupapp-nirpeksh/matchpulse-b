const express = require('express');
const router = express.Router();
const scoringController = require('../controllers/scoring.controller');
const { authenticate } = require('../middleware/auth');
const { requireScorerOrAdmin } = require('../middleware/rbac');
const { scoringLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const {
  submitEventValidation,
  undoEventValidation,
} = require('../validators/scoring.validator');

// Public routes
router.get('/:matchId/events', scoringController.getEvents);
router.get('/:matchId/stats', scoringController.getMatchStats);

// Scorer routes (with scoring rate limiter)
router.post(
  '/:matchId/events',
  authenticate,
  requireScorerOrAdmin,
  scoringLimiter,
  submitEventValidation,
  validate,
  scoringController.submitEvent
);

router.post(
  '/:matchId/events/:eventId/undo',
  authenticate,
  requireScorerOrAdmin,
  undoEventValidation,
  validate,
  scoringController.undoEvent
);

module.exports = router;
