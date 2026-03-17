const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    bio: {
      type: String,
      maxlength: 500,
      default: '',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    role: {
      type: String,
      enum: ['platform_admin', 'org_admin', 'tournament_admin', 'scorer', 'player'],
      default: 'player',
    },
    // Tournament-specific roles (a user can be scorer for specific tournaments)
    tournamentRoles: [{
      tournamentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tournament',
      },
      role: {
        type: String,
        enum: ['tournament_admin', 'scorer'],
      },
    }],
    // Player-specific fields
    jerseyNumber: {
      type: Number,
      default: null,
    },
    preferredSports: [{
      type: String,
      enum: [
        'cricket', 'football', 'basketball_5v5', 'basketball_3x3',
        'volleyball', 'tennis', 'table_tennis', 'badminton', 'squash',
      ],
    }],
    privacySettings: {
      showPhoto: { type: Boolean, default: true },
      showStats: { type: Boolean, default: true },
    },
    notificationPreferences: {
      push: { type: Boolean, default: true },
      emailDigest: { type: Boolean, default: false },
      dndStart: { type: String, default: null }, // "22:00"
      dndEnd: { type: String, default: null },   // "07:00"
      subscribedTournaments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tournament',
      }],
      subscribedTeams: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
      }],
    },
    // Password reset fields
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpiry: {
      type: Date,
      select: false,
    },
    // OTP fields
    otp: {
      code: { type: String, select: false },
      expiresAt: { type: Date, select: false },
      attempts: { type: Number, default: 0, select: false },
    },
    refreshTokens: [{
      token: { type: String, required: true },
      deviceInfo: { type: String },
      createdAt: { type: Date, default: Date.now },
      expiresAt: { type: Date, required: true },
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes (email and phone have unique+sparse set at field level)
userSchema.index({ organizationId: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'tournamentRoles.tournamentId': 1 });

// Pre-save: hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash') || !this.passwordHash) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Clean user object for API responses
userSchema.methods.toPublicJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.refreshTokens;
  delete obj.otp;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpiry;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
