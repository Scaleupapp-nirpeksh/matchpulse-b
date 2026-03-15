const { body, param } = require('express-validator');

const createOrgValidation = [
  body('name')
    .trim()
    .notEmpty().withMessage('Organization name is required')
    .isLength({ max: 100 }).withMessage('Name must be under 100 characters'),
  body('slug')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Slug must be under 50 characters')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug can only contain lowercase letters, numbers, and hyphens'),
  body('primaryColor')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('secondaryColor')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description must be under 500 characters'),
];

const updateOrgValidation = [
  param('orgId').isMongoId().withMessage('Invalid organization ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Name must be under 100 characters'),
  body('primaryColor')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
  body('secondaryColor')
    .optional()
    .matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
];

const inviteValidation = [
  param('orgId').isMongoId().withMessage('Invalid organization ID'),
  body('role')
    .notEmpty().withMessage('Role is required')
    .isIn(['org_admin', 'tournament_admin', 'scorer', 'player']).withMessage('Invalid role'),
  body('email')
    .optional()
    .isEmail().withMessage('Invalid email'),
  body('phone')
    .optional()
    .matches(/^\+[1-9]\d{6,14}$/).withMessage('Invalid phone number'),
];

module.exports = {
  createOrgValidation,
  updateOrgValidation,
  inviteValidation,
};
