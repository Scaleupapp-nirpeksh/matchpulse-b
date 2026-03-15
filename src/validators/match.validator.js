const { body, param } = require('express-validator');
const { SPORT_LIST } = require('../utils/constants');

const createMatchValidation = [
  body('tournamentId')
    .notEmpty().withMessage('Tournament ID is required')
    .isMongoId().withMessage('Invalid tournament ID'),
  body('teamA')
    .notEmpty().withMessage('Team A is required')
    .isMongoId().withMessage('Invalid team A ID'),
  body('teamB')
    .notEmpty().withMessage('Team B is required')
    .isMongoId().withMessage('Invalid team B ID'),
  body('scheduledAt')
    .optional()
    .isISO8601().withMessage('Invalid date format'),
  body('venue')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Venue must be under 200 characters'),
  body('stage')
    .optional()
    .trim(),
  body('groupName')
    .optional()
    .trim(),
  body('matchNumber')
    .optional()
    .isInt({ min: 1 }).withMessage('Match number must be positive'),
];

const updateMatchValidation = [
  param('matchId').isMongoId().withMessage('Invalid match ID'),
  body('scheduledAt')
    .optional()
    .isISO8601().withMessage('Invalid date format'),
  body('venue')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Venue must be under 200 characters'),
  body('scorerUserId')
    .optional()
    .isMongoId().withMessage('Invalid scorer user ID'),
  body('status')
    .optional()
    .isIn(['scheduled', 'live', 'completed', 'cancelled', 'postponed']).withMessage('Invalid status'),
];

const assignScorerValidation = [
  param('matchId').isMongoId().withMessage('Invalid match ID'),
  body('scorerUserId')
    .notEmpty().withMessage('Scorer user ID is required')
    .isMongoId().withMessage('Invalid scorer user ID'),
];

const matchLifecycleValidation = [
  param('matchId').isMongoId().withMessage('Invalid match ID'),
  body('action')
    .notEmpty().withMessage('Action is required')
    .isIn(['start', 'pause', 'resume', 'end']).withMessage('Invalid action'),
  body('toss')
    .optional()
    .isObject().withMessage('Toss must be an object'),
];

module.exports = {
  createMatchValidation,
  updateMatchValidation,
  assignScorerValidation,
  matchLifecycleValidation,
};
