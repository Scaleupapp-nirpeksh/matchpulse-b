const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    type: {
      type: String,
      required: true,
      // match_starting, score_update, match_completed, wicket, goal, red_card,
      // milestone, lead_change, tournament_update, invite, assignment
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      maxlength: 500,
    },
    // Navigation data
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      /*
        { matchId, tournamentId, teamId, sportType, screen }
      */
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
