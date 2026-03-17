const notificationService = require('../services/notification.service');

class NotificationController {
  /**
   * GET /api/notifications
   */
  async list(req, res, next) {
    try {
      const result = await notificationService.getUserNotifications(req.userId, req.query);

      res.json({
        success: true,
        data: result.notifications,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/notifications/unread-count
   */
  async unreadCount(req, res, next) {
    try {
      const count = await notificationService.getUnreadCount(req.userId);

      res.json({
        success: true,
        data: { unreadCount: count },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/notifications/:notificationId/read
   */
  async markAsRead(req, res, next) {
    try {
      const notification = await notificationService.markAsRead(
        req.params.notificationId,
        req.userId
      );

      res.json({
        success: true,
        data: notification,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/notifications/read-all
   */
  async markAllAsRead(req, res, next) {
    try {
      await notificationService.markAllAsRead(req.userId);

      res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/notifications/push-subscription
   */
  async registerPushSubscription(req, res, next) {
    try {
      const { platform, token, keys, endpoint } = req.body;

      const subscription = await notificationService.registerPushSubscription(
        req.userId,
        { platform, token, keys, endpoint }
      );

      res.status(201).json({
        success: true,
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/notifications/push-subscription/:token
   */
  async unregisterPushSubscription(req, res, next) {
    try {
      await notificationService.unregisterPushSubscription(
        req.userId,
        req.params.token
      );

      res.json({
        success: true,
        message: 'Push subscription removed',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/notifications/preferences
   */
  async getPreferences(req, res, next) {
    try {
      const preferences = await notificationService.getPreferences(req.userId);

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/notifications/preferences
   */
  async updatePreferences(req, res, next) {
    try {
      const preferences = await notificationService.updatePreferences(
        req.userId,
        req.body
      );

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();
