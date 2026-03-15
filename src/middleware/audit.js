const AuditLog = require('../models/AuditLog');
const { getClientIP, getDeviceInfo } = require('../utils/helpers');

/**
 * Create an audit log entry
 * Can be called directly from controllers/services
 */
const createAuditEntry = async ({
  organizationId = null,
  userId,
  userRole,
  actionType,
  entityType,
  entityId,
  oldValue = null,
  newValue = null,
  reason = null,
  req = null,
}) => {
  try {
    const entry = new AuditLog({
      organizationId,
      userId,
      userRole,
      actionType,
      entityType,
      entityId,
      oldValue,
      newValue,
      reason,
      ipAddress: req ? getClientIP(req) : null,
      deviceInfo: req ? getDeviceInfo(req) : { userAgent: 'system', platform: 'server' },
    });

    await entry.save();
    return entry;
  } catch (error) {
    // Audit logging should not break the main flow
    console.error('❌ Audit log creation failed:', error.message);
    return null;
  }
};

/**
 * Express middleware for automatic audit logging on mutation routes
 * Usage: router.post('/endpoint', auditMiddleware('action_type', 'entity_type'), controller)
 */
const auditMiddleware = (actionType, entityType) => {
  return (req, res, next) => {
    // Store audit context on request for the controller to use
    req.auditContext = {
      actionType,
      entityType,
      createEntry: async (entityId, { oldValue, newValue, reason } = {}) => {
        if (!req.user) return null;
        return createAuditEntry({
          organizationId: req.user.organizationId,
          userId: req.user._id,
          userRole: req.user.role,
          actionType,
          entityType,
          entityId,
          oldValue,
          newValue,
          reason,
          req,
        });
      },
    };
    next();
  };
};

module.exports = { createAuditEntry, auditMiddleware };
