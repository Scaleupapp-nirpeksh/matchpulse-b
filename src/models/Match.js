const mongoose = require('mongoose');
const { SPORT_LIST } = require('../utils/constants');

const matchSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    sportType: {
      type: String,
      enum: SPORT_LIST,
      required: true,
    },
    teamA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    teamB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    venue: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'completed', 'cancelled', 'postponed'],
      default: 'scheduled',
    },
    // Tournament stage info
    stage: {
      type: String,
      default: 'group', // group, quarterfinal, semifinal, final, third_place, round_X (swiss)
    },
    groupName: {
      type: String,
      default: null,
    },
    matchNumber: {
      type: Number,
      default: null,
    },
    // Dependency: e.g., "Winner of Match 5 vs Winner of Match 6"
    dependsOn: {
      teamASource: {
        type: String, // "winner_of_<matchId>" or "loser_of_<matchId>"
        default: null,
      },
      teamBSource: {
        type: String,
        default: null,
      },
    },
    // Assigned scorer
    scorerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Sport-specific live state — polymorphic by sport
    currentState: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Result summary
    resultSummary: {
      winnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        default: null,
      },
      scoreA: { type: String, default: null }, // Flexible: "145/6 (15)" or "98" or "3-1"
      scoreB: { type: String, default: null },
      margin: { type: String, default: null }, // "5 wickets", "12 points", "2-1 (sets)"
      resultType: {
        type: String,
        enum: ['normal', 'draw', 'tie', 'abandoned', 'walkover', 'dls', null],
        default: null,
      },
      motm: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
    // AI summary (post-match, enhanced with AI narrative)
    aiSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Match insights (rule-based, always available after match end)
    matchInsights: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Win probability (live)
    winProbability: {
      a: { type: Number, default: 50 },
      b: { type: Number, default: 50 },
    },
    // Toss (cricket specific but stored here for convenience)
    toss: {
      winnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        default: null,
      },
      decision: {
        type: String,
        enum: ['bat', 'bowl', null],
        default: null,
      },
    },
    startedAt: Date,
    completedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
matchSchema.index({ tournamentId: 1, status: 1 });
matchSchema.index({ status: 1 });
matchSchema.index({ sportType: 1, status: 1 });
matchSchema.index({ teamA: 1 });
matchSchema.index({ teamB: 1 });
matchSchema.index({ scorerUserId: 1 });
matchSchema.index({ scheduledAt: 1 });

module.exports = mongoose.model('Match', matchSchema);
