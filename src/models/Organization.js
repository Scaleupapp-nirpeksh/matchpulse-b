const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 50,
    },
    logoUrl: {
      type: String,
      default: null,
    },
    primaryColor: {
      type: String,
      default: '#1D9E75',
    },
    secondaryColor: {
      type: String,
      default: '#378ADD',
    },
    description: {
      type: String,
      maxlength: 500,
      default: '',
    },
    settings: {
      timezone: {
        type: String,
        default: 'Asia/Kolkata',
      },
      defaultSportConfigs: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      notificationDefaults: {
        emailDigest: { type: Boolean, default: true },
        pushEnabled: { type: Boolean, default: true },
      },
    },
    adminUserIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    inviteCodes: [{
      code: { type: String, required: true },
      role: {
        type: String,
        enum: ['org_admin', 'tournament_admin', 'scorer', 'player'],
        required: true,
      },
      tournamentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tournament',
        default: null,
      },
      usedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      usedAt: Date,
      expiresAt: Date,
      createdAt: { type: Date, default: Date.now },
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

// Indexes (slug unique is set at field level)
organizationSchema.index({ adminUserIds: 1 });
organizationSchema.index({ 'inviteCodes.code': 1 });

module.exports = mongoose.model('Organization', organizationSchema);
