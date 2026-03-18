const mongoose = require('mongoose');

const teamRegistrationSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
    },
    teamName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    shortName: {
      type: String,
      trim: true,
      maxlength: 5,
      uppercase: true,
    },
    captain: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      phone: { type: String, trim: true },
    },
    players: [
      {
        name: { type: String, required: true, trim: true },
        jerseyNumber: { type: Number, default: null },
        position: { type: String, default: null },
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

teamRegistrationSchema.index({ tournamentId: 1, status: 1 });
teamRegistrationSchema.index({ tournamentId: 1, teamName: 1 });

module.exports = mongoose.model('TeamRegistration', teamRegistrationSchema);
