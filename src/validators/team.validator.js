const { body, param } = require('express-validator');

const createTeamValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Team name is required')
    .isLength({ max: 100 }).withMessage('Name must be under 100 characters'),
  body('tournamentId')
    .notEmpty().withMessage('Tournament ID is required')
    .isMongoId().withMessage('Invalid tournament ID'),
  body('shortName')
    .optional()
    .trim()
    .isLength({ max: 5 }).withMessage('Short name must be under 5 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('groupName')
    .optional()
    .trim()
    .isLength({ max: 2 }).withMessage('Group name must be 1-2 characters'),
  body('seed')
    .optional()
    .isInt({ min: 1 }).withMessage('Seed must be a positive integer'),
];

const updateTeamValidation = [
  param('teamId').isMongoId().withMessage('Invalid team ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Name must be under 100 characters'),
  body('shortName')
    .optional()
    .trim()
    .isLength({ max: 5 }).withMessage('Short name must be under 5 characters'),
  body('color')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('groupName')
    .optional()
    .trim(),
];

const addPlayerValidation = [
  param('teamId').isMongoId().withMessage('Invalid team ID'),
  body('playerId')
    .notEmpty().withMessage('Player ID is required')
    .isMongoId().withMessage('Invalid player ID'),
  body('jerseyNumber')
    .optional()
    .isInt({ min: 0, max: 99 }).withMessage('Jersey number must be 0-99'),
  body('position')
    .optional()
    .trim(),
  body('role')
    .optional()
    .trim(),
];

const updatePlayerValidation = [
  param('teamId').isMongoId().withMessage('Invalid team ID'),
  param('playerId').isMongoId().withMessage('Invalid player ID'),
  body('jerseyNumber')
    .optional()
    .isInt({ min: 0, max: 99 }).withMessage('Jersey number must be 0-99'),
  body('position')
    .optional()
    .trim(),
  body('role')
    .optional()
    .trim(),
  body('isPlaying')
    .optional()
    .isBoolean().withMessage('isPlaying must be a boolean'),
];

const removePlayerValidation = [
  param('teamId').isMongoId().withMessage('Invalid team ID'),
  param('playerId').isMongoId().withMessage('Invalid player ID'),
];

module.exports = {
  createTeamValidation,
  updateTeamValidation,
  addPlayerValidation,
  updatePlayerValidation,
  removePlayerValidation,
};
