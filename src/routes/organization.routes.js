const express = require('express');
const router = express.Router();
const orgController = require('../controllers/organization.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireOrgMembership } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createOrgValidation,
  updateOrgValidation,
  inviteValidation,
} = require('../validators/organization.validator');

// Public routes
router.get('/', orgController.list);
router.get('/slug/:slug', orgController.getBySlug);
router.get('/:orgId', orgController.getById);

// Protected routes
router.post('/', authenticate, createOrgValidation, validate, orgController.create);
router.put('/:orgId', authenticate, requireRole('org_admin', 'platform_admin'), updateOrgValidation, validate, orgController.update);
router.post('/:orgId/invite', authenticate, requireRole('org_admin', 'platform_admin'), inviteValidation, validate, orgController.invite);
router.post('/join/:inviteCode', authenticate, orgController.joinByInvite);
router.get('/:orgId/members', authenticate, requireOrgMembership, orgController.getMembers);

module.exports = router;
