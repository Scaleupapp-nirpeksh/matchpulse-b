const express = require('express');
const router = express.Router();
const tournamentController = require('../controllers/tournament.controller');
const { authenticate } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createTournamentValidation,
  updateTournamentValidation,
} = require('../validators/tournament.validator');

// Public routes
router.get('/', tournamentController.listActive);
router.get('/:tournamentId/registration-info', tournamentController.getRegistrationInfo);
router.get('/:tournamentId', tournamentController.getById);
router.get('/org/:orgId', tournamentController.getByOrg);

// Protected routes (tournament admin+)
router.post('/', authenticate, requireMinRole('org_admin'), createTournamentValidation, validate, tournamentController.create);
router.put('/:tournamentId', authenticate, requireMinRole('tournament_admin'), updateTournamentValidation, validate, tournamentController.update);
router.put('/:tournamentId/status', authenticate, requireMinRole('tournament_admin'), tournamentController.updateStatus);
router.post('/:tournamentId/fixtures/generate', authenticate, requireMinRole('tournament_admin'), tournamentController.generateFixtures);

module.exports = router;
