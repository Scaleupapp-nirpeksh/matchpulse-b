const express = require('express');
const router = express.Router();
const multer = require('multer');
const teamController = require('../controllers/team.controller');
const { authenticate } = require('../middleware/auth');
const { requireMinRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createTeamValidation,
  updateTeamValidation,
  addPlayerValidation,
  updatePlayerValidation,
  removePlayerValidation,
} = require('../validators/team.validator');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Public routes
router.get('/tournament/:tournamentId', teamController.getByTournament);
router.get('/:teamId', teamController.getById);

// Protected routes (tournament admin+)
router.post('/', authenticate, requireMinRole('tournament_admin'), createTeamValidation, validate, teamController.create);
router.put('/:teamId', authenticate, requireMinRole('tournament_admin'), updateTeamValidation, validate, teamController.update);
router.delete('/:teamId', authenticate, requireMinRole('tournament_admin'), teamController.delete);

// Player management
router.post('/:teamId/players', authenticate, requireMinRole('tournament_admin'), addPlayerValidation, validate, teamController.addPlayer);
router.put('/:teamId/players/:playerId', authenticate, requireMinRole('tournament_admin'), updatePlayerValidation, validate, teamController.updatePlayer);
router.delete('/:teamId/players/:playerId', authenticate, requireMinRole('tournament_admin'), removePlayerValidation, validate, teamController.removePlayer);

// Bulk import
router.post('/tournament/:tournamentId/bulk-import', authenticate, requireMinRole('tournament_admin'), upload.single('file'), teamController.bulkImport);

module.exports = router;
