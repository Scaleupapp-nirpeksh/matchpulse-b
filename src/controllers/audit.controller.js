const AuditLog = require('../models/AuditLog');
const { parsePagination, paginationMeta } = require('../utils/helpers');
const { Parser } = require('json2csv');

class AuditController {
  /**
   * GET /api/audit/org/:orgId
   * List audit logs for an organization
   */
  async list(req, res, next) {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const filter = { organizationId: req.params.orgId };

      // Filters
      if (req.query.actionType) filter.actionType = req.query.actionType;
      if (req.query.entityType) filter.entityType = req.query.entityType;
      if (req.query.userId) filter.userId = req.query.userId;
      if (req.query.startDate || req.query.endDate) {
        filter.createdAt = {};
        if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
        if (req.query.endDate) filter.createdAt.$lte = new Date(req.query.endDate);
      }

      const [logs, total] = await Promise.all([
        AuditLog.find(filter)
          .populate('userId', 'fullName email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        AuditLog.countDocuments(filter),
      ]);

      res.json({
        success: true,
        data: logs,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit/org/:orgId/export
   * Export audit logs as CSV
   */
  async exportCsv(req, res, next) {
    try {
      const filter = { organizationId: req.params.orgId };

      if (req.query.startDate || req.query.endDate) {
        filter.createdAt = {};
        if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
        if (req.query.endDate) filter.createdAt.$lte = new Date(req.query.endDate);
      }

      const logs = await AuditLog.find(filter)
        .populate('userId', 'fullName email')
        .sort({ createdAt: -1 })
        .limit(10000); // Cap at 10k for performance

      const fields = [
        { label: 'Timestamp', value: 'createdAt' },
        { label: 'User', value: (row) => row.userId?.fullName || 'System' },
        { label: 'User Email', value: (row) => row.userId?.email || '' },
        { label: 'Role', value: 'userRole' },
        { label: 'Action', value: 'actionType' },
        { label: 'Entity Type', value: 'entityType' },
        { label: 'Entity ID', value: 'entityId' },
        { label: 'Old Value', value: (row) => JSON.stringify(row.oldValue) },
        { label: 'New Value', value: (row) => JSON.stringify(row.newValue) },
        { label: 'Reason', value: 'reason' },
        { label: 'IP Address', value: 'ipAddress' },
        { label: 'Device', value: (row) => row.deviceInfo?.userAgent || '' },
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(logs);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audit-log-${Date.now()}.csv`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit/entity/:entityType/:entityId
   * Get audit logs for a specific entity
   */
  async getByEntity(req, res, next) {
    try {
      const { entityType, entityId } = req.params;
      const { page, limit, skip } = parsePagination(req.query);

      const [logs, total] = await Promise.all([
        AuditLog.find({ entityType, entityId })
          .populate('userId', 'fullName email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        AuditLog.countDocuments({ entityType, entityId }),
      ]);

      res.json({
        success: true,
        data: logs,
        pagination: paginationMeta(total, page, limit),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuditController();
