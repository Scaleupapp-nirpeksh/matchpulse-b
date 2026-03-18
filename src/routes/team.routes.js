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
  publicRegistrationValidation,
} = require('../validators/team.validator');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv and .xlsx files are allowed'));
    }
  },
});

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

// Public team registration (no auth required)
router.post('/tournament/:tournamentId/register', publicRegistrationValidation, validate, teamController.publicRegister);

// Registration management (admin)
router.get('/tournament/:tournamentId/registrations', authenticate, requireMinRole('tournament_admin'), teamController.getRegistrations);
router.put('/tournament/:tournamentId/registrations/:registrationId', authenticate, requireMinRole('tournament_admin'), teamController.reviewRegistration);

// AI-powered import
router.post('/tournament/:tournamentId/ai-import', authenticate, requireMinRole('tournament_admin'), upload.single('file'), teamController.aiImport);
router.post('/tournament/:tournamentId/ai-import/confirm', authenticate, requireMinRole('tournament_admin'), teamController.confirmAiImport);

module.exports = router;
