const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      maxlength: 100,
    },
    shortName: {
      type: String,
      trim: true,
      maxlength: 5,
      uppercase: true,
    },
    color: {
      type: String,
      default: '#1D9E75',
    },
    logoUrl: {
      type: String,
      default: null,
    },
    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    groupName: {
      type: String,
      default: null, // e.g., "A", "B", "C"
    },
    seed: {
      type: Number,
      default: null,
    },
    players: [{
      playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      jerseyNumber: {
        type: Number,
        default: null,
      },
      position: {
        type: String,
        default: null, // sport-specific (batsman, goalkeeper, point guard, etc.)
      },
      role: {
        type: String,
        default: null, // captain, vice-captain, etc.
      },
      isPlaying: {
        type: Boolean,
        default: true,
      },
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
teamSchema.index({ tournamentId: 1 });
teamSchema.index({ tournamentId: 1, groupName: 1 });
teamSchema.index({ 'players.playerId': 1 });

module.exports = mongoose.model('Team', teamSchema);
