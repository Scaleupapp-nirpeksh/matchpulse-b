const mongoose = require('mongoose');
const { SPORT_LIST } = require('../utils/constants');

const scoringEventSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
    },
    sportType: {
      type: String,
      enum: SPORT_LIST,
      required: true,
    },
    eventType: {
      type: String,
      required: true,
      // ball, wicket, goal, card, shot_made, rally_point, point, etc.
    },
    // Sport-specific event data (polymorphic)
    eventData: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      /*
        Cricket ball: { runs, extras: { type, runs }, isWicket, wicketType, batter, bowler, fielder, overNumber, ballNumber }
        Football goal: { scorer, assister, minute, half }
        Basketball shot: { shotType, player, team, made, clockSeconds, quarter }
        Volleyball rally: { scoringTeam, setNumber, serverTeam }
        Tennis point: { winner, setNumber, gameNumber, pointScore }
        etc.
      */
    },
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
    // Sequential ordering within a match
    sequenceNumber: {
      type: Number,
      required: true,
    },
    // AI commentary for this event
    aiCommentary: {
      type: String,
      default: null,
    },
    // Should this event trigger a push notification?
    isNotificationWorthy: {
      type: Boolean,
      default: false,
    },
    // Undo tracking
    isUndone: {
      type: Boolean,
      default: false,
    },
    undoneBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    undoReason: {
      type: String,
      default: null,
    },
    undoneAt: {
      type: Date,
      default: null,
    },
    // Match state snapshot after this event (for rollback)
    stateSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
scoringEventSchema.index({ matchId: 1, sequenceNumber: 1 });
scoringEventSchema.index({ matchId: 1, isUndone: 1 });
scoringEventSchema.index({ matchId: 1, eventType: 1 });
scoringEventSchema.index({ playerId: 1 });

module.exports = mongoose.model('ScoringEvent', scoringEventSchema);
