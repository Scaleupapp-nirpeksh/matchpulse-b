const mongoose = require('mongoose');
const { SPORT_LIST, DEFAULT_RULES } = require('../utils/constants');

const tournamentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Tournament name is required'],
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      maxlength: 1000,
      default: '',
    },
    logoUrl: {
      type: String,
      default: null,
    },
    sportType: {
      type: String,
      enum: SPORT_LIST,
      required: [true, 'Sport type is required'],
    },
    format: {
      type: String,
      enum: ['round_robin', 'knockout', 'groups_knockout', 'swiss'],
      required: [true, 'Tournament format is required'],
    },
    // Group stage config
    numGroups: {
      type: Number,
      default: 1,
      min: 1,
      max: 16,
    },
    teamsPerGroup: {
      type: Number,
      default: null,
    },
    teamsAdvancing: {
      type: Number,
      default: 2,
      min: 1,
    },
    // Seeding
    seeding: {
      type: String,
      enum: ['random', 'manual', 'performance'],
      default: 'random',
    },
    // Sport-specific rules — fully customizable
    rulesConfig: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Schedule
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    // Venues
    venues: [{
      name: { type: String, required: true },
      address: { type: String, default: '' },
    }],
    status: {
      type: String,
      enum: ['draft', 'registration', 'active', 'completed', 'cancelled'],
      default: 'draft',
    },
    // Swiss system specific
    swissRounds: {
      type: Number,
      default: null,
    },
    // Knockout specific
    thirdPlaceMatch: {
      type: Boolean,
      default: false,
    },
    // Public team registration settings
    registrationSettings: {
      isOpen: { type: Boolean, default: false },
      requireApproval: { type: Boolean, default: true },
      maxTeams: { type: Number, default: null },
      deadline: { type: Date, default: null },
      instructions: { type: String, maxlength: 500, default: '' },
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
tournamentSchema.index({ organizationId: 1, status: 1 });
tournamentSchema.index({ sportType: 1 });
tournamentSchema.index({ status: 1 });
tournamentSchema.index({ createdBy: 1 });

// Pre-validate: set default rules if not provided
tournamentSchema.pre('validate', function (next) {
  if (!this.rulesConfig || Object.keys(this.rulesConfig).length === 0) {
    this.rulesConfig = DEFAULT_RULES[this.sportType] || {};
  }
  next();
});

module.exports = mongoose.model('Tournament', tournamentSchema);
