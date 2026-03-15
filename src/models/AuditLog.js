const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userRole: {
      type: String,
      required: true,
    },
    actionType: {
      type: String,
      required: true,
      // e.g., 'tournament_create', 'score_event', 'score_undo', 'match_start', etc.
    },
    entityType: {
      type: String,
      required: true,
      // e.g., 'tournament', 'match', 'scoring_event', 'team', 'player', etc.
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    deviceInfo: {
      userAgent: { type: String, default: null },
      platform: { type: String, default: null },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only: no updates
  }
);

// Indexes
auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ actionType: 1, createdAt: -1 });

// Prevent updates and deletes — append-only
auditLogSchema.pre('updateOne', function () {
  throw new Error('Audit logs cannot be updated');
});
auditLogSchema.pre('updateMany', function () {
  throw new Error('Audit logs cannot be updated');
});
auditLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('Audit logs cannot be updated');
});
auditLogSchema.pre('findOneAndDelete', function () {
  throw new Error('Audit logs cannot be deleted');
});
auditLogSchema.pre('deleteOne', function () {
  throw new Error('Audit logs cannot be deleted');
});
auditLogSchema.pre('deleteMany', function () {
  throw new Error('Audit logs cannot be deleted');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
