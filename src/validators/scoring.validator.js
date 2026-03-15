const { body, param } = require('express-validator');

const submitEventValidation = [
  param('matchId').isMongoId().withMessage('Invalid match ID'),
  body('eventType')
    .notEmpty().withMessage('Event type is required')
    .trim(),
  body('eventData')
    .notEmpty().withMessage('Event data is required')
    .isObject().withMessage('Event data must be an object'),
  body('playerId')
    .optional()
    .isMongoId().withMessage('Invalid player ID'),
  body('teamId')
    .optional()
    .isMongoId().withMessage('Invalid team ID'),
];

const undoEventValidation = [
  param('matchId').isMongoId().withMessage('Invalid match ID'),
  param('eventId').isMongoId().withMessage('Invalid event ID'),
  body('reason')
    .notEmpty().withMessage('Undo reason is required (mandatory for audit)')
    .trim()
    .isLength({ min: 3, max: 500 }).withMessage('Reason must be 3-500 characters'),
];

module.exports = {
  submitEventValidation,
  undoEventValidation,
};
