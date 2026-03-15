const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const { parsePagination, paginationMeta } = require('../utils/helpers');

class NotificationService {
  /**
   * Create and deliver a notification
   */
  async createNotification({
    userId,
    organizationId = null,
    type,
    title,
    body,
    data = {},
  }) {
    const notification = new Notification({
      userId,
      organizationId,
      type,
      title,
      body,
      data,
    });

    await notification.save();

    // Send push notification asynchronously
    this.sendPushNotification(userId, { title, body, data }).catch((err) => {
      console.error('❌ Push notification failed:', err.message);
    });

    return notification;
  }

  /**
   * Create notifications for all subscribers of a tournament/team
   */
  async notifySubscribers({
    tournamentId = null,
    teamId = null,
    organizationId = null,
    type,
    title,
    body,
    data = {},
    excludeUserId = null,
  }) {
    try {
      const query = {
        isActive: true,
        'notificationPreferences.push': true,
      };

      if (tournamentId) {
        query['notificationPreferences.subscribedTournaments'] = tournamentId;
      }
      if (teamId) {
        query['notificationPreferences.subscribedTeams'] = teamId;
      }

      const subscribers = await User.find(query).select('_id');

      const notifications = [];
      for (const subscriber of subscribers) {
        if (excludeUserId && subscriber._id.toString() === excludeUserId.toString()) {
          continue;
        }

        notifications.push({
          userId: subscriber._id,
          organizationId,
          type,
          title,
          body,
          data,
        });
      }

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);

        // Send push to all subscribers (fire and forget)
        for (const notif of notifications) {
          this.sendPushNotification(notif.userId, { title, body, data }).catch(() => {});
        }
      }

      return notifications.length;
    } catch (error) {
      console.error('❌ Notify subscribers error:', error.message);
      return 0;
    }
  }

  /**
   * Send push notification to a user's devices
   */
  async sendPushNotification(userId, { title, body, data }) {
    const subscriptions = await PushSubscription.find({ userId, isActive: true });

    for (const sub of subscriptions) {
      try {
        switch (sub.platform) {
          case 'web_push':
            await this.sendWebPush(sub, { title, body, data });
            break;
          case 'web_fcm':
            // FCM fallback — implement when needed
            break;
          case 'ios_apns':
            // APNs — the iOS app handles this natively
            // We just prepare the payload; actual delivery needs APNs server
            break;
        }
      } catch (error) {
        console.error(`❌ Push failed for ${sub.platform}:`, error.message);
        // Deactivate invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          sub.isActive = false;
          await sub.save();
        }
      }
    }
  }

  /**
   * Send Web Push notification
   */
  async sendWebPush(subscription, { title, body, data }) {
    try {
      const webpush = require('web-push');
      const env = require('../config/env');

      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

      webpush.setVapidDetails(
        env.VAPID_SUBJECT,
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
      );

      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      };

      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify({ title, body, data })
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(userId, query = {}) {
    const { page, limit, skip } = parsePagination(query);

    const filter = { userId };
    if (query.unreadOnly === 'true') {
      filter.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(filter),
    ]);

    return {
      notifications,
      pagination: paginationMeta(total, page, limit),
    };
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId) {
    return Notification.countDocuments({ userId, isRead: false });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true },
      { new: true }
    );
    return notification;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );
  }

  /**
   * Register push subscription
   */
  async registerPushSubscription(userId, { platform, token, keys, endpoint }) {
    // Remove existing subscription with same token
    await PushSubscription.deleteMany({ token });

    const subscription = new PushSubscription({
      userId,
      platform,
      token,
      keys,
      endpoint,
    });

    await subscription.save();
    return subscription;
  }

  /**
   * Unregister push subscription
   */
  async unregisterPushSubscription(userId, token) {
    await PushSubscription.deleteMany({ userId, token });
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(userId, preferences) {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { notificationPreferences: preferences } },
      { new: true }
    ).select('notificationPreferences');

    return user?.notificationPreferences;
  }
}

module.exports = new NotificationService();
