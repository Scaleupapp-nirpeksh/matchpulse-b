const { body, param } = require('express-validator');
const { SPORT_LIST } = require('../utils/constants');

const createTournamentValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Tournament name is required')
    .isLength({ max: 150 }).withMessage('Name must be under 150 characters'),
  body('organizationId')
    .notEmpty().withMessage('Organization ID is required')
    .isMongoId().withMessage('Invalid organization ID'),
  body('sportType')
    .notEmpty().withMessage('Sport type is required')
    .isIn(SPORT_LIST).withMessage(`Sport must be one of: ${SPORT_LIST.join(', ')}`),
  body('format')
    .notEmpty().withMessage('Format is required')
    .isIn(['round_robin', 'knockout', 'groups_knockout', 'swiss']).withMessage('Invalid format'),
  body('numGroups')
    .optional()
    .isInt({ min: 1, max: 16 }).withMessage('Number of groups must be 1-16'),
  body('teamsAdvancing')
    .optional()
    .isInt({ min: 1 }).withMessage('Teams advancing must be at least 1'),
  body('startDate')
    .optional()
    .isISO8601().withMessage('Invalid start date'),
  body('endDate')
    .optional()
    .isISO8601().withMessage('Invalid end date'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Description must be under 1000 characters'),
  body('rulesConfig')
    .optional()
    .isObject().withMessage('Rules config must be an object'),
];

const updateTournamentValidation = [
  param('tournamentId').isMongoId().withMessage('Invalid tournament ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 150 }).withMessage('Name must be under 150 characters'),
  body('format')
    .optional()
    .isIn(['round_robin', 'knockout', 'groups_knockout', 'swiss']).withMessage('Invalid format'),
  body('status')
    .optional()
    .isIn(['draft', 'registration', 'active', 'completed', 'cancelled']).withMessage('Invalid status'),
  body('rulesConfig')
    .optional()
    .isObject().withMessage('Rules config must be an object'),
];

module.exports = {
  createTournamentValidation,
  updateTournamentValidation,
};
