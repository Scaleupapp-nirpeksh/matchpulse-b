const express = require('express');
const router = express.Router();
const auditController = require('../controllers/audit.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireOrgMembership } = require('../middleware/rbac');

// All audit routes require org admin+
router.use(authenticate);

router.get('/org/:orgId', requireRole('org_admin', 'platform_admin'), auditController.list);
router.get('/org/:orgId/export', requireRole('org_admin', 'platform_admin'), auditController.exportCsv);
router.get('/entity/:entityType/:entityId', requireRole('org_admin', 'platform_admin'), auditController.getByEntity);

module.exports = router;
