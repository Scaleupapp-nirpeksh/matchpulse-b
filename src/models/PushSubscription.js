const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    platform: {
      type: String,
      enum: ['ios_apns', 'web_push', 'web_fcm'],
      required: true,
    },
    // APNs device token or FCM registration token
    token: {
      type: String,
      required: true,
    },
    // Web Push VAPID keys (for web_push platform only)
    keys: {
      p256dh: { type: String, default: null },
      auth: { type: String, default: null },
    },
    // Web Push endpoint (for web_push platform only)
    endpoint: {
      type: String,
      default: null,
    },
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
pushSubscriptionSchema.index({ userId: 1, platform: 1 });
pushSubscriptionSchema.index({ token: 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
