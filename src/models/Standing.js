const mongoose = require('mongoose');

const standingSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    groupName: {
      type: String,
      default: null,
    },
    played: {
      type: Number,
      default: 0,
    },
    won: {
      type: Number,
      default: 0,
    },
    lost: {
      type: Number,
      default: 0,
    },
    drawn: {
      type: Number,
      default: 0,
    },
    points: {
      type: Number,
      default: 0,
    },
    // Generic for/against values (sport-specific meaning)
    // Cricket: runs scored / runs conceded; Football: goals for / goals against
    // Basketball: points for / points against, etc.
    forValue: {
      type: Number,
      default: 0,
    },
    againstValue: {
      type: Number,
      default: 0,
    },
    netValue: {
      type: Number,
      default: 0, // NRR for cricket, goal difference for football, etc.
    },
    rank: {
      type: Number,
      default: 0,
    },
    // Additional sport-specific standing data
    additionalData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      /*
        Cricket: { oversPlayed, oversBowled, nrr }
        Football: { goalsFor, goalsAgainst, goalDifference }
      */
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
standingSchema.index({ tournamentId: 1, groupName: 1, rank: 1 });
standingSchema.index({ tournamentId: 1, teamId: 1 }, { unique: true });
standingSchema.index({ teamId: 1 });

module.exports = mongoose.model('Standing', standingSchema);
