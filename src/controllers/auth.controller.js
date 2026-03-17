const authService = require('../services/auth.service');
const otpService = require('../services/otp.service');
const { createAuditEntry } = require('../middleware/audit');
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require('../utils/constants');

class AuthController {
  /**
   * POST /api/auth/register/email
   */
  async registerEmail(req, res, next) {
    try {
      const { fullName, email, password, organizationId } = req.body;

      const result = await authService.registerWithEmail({
        fullName,
        email,
        password,
        organizationId,
      });

      // Audit log
      await createAuditEntry({
        organizationId,
        userId: result.user._id,
        userRole: result.user.role,
        actionType: AUDIT_ACTIONS.USER_REGISTER,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: result.user._id,
        newValue: { fullName, email },
        req,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/register/phone
   */
  async registerPhone(req, res, next) {
    try {
      const { fullName, phone, organizationId } = req.body;

      const result = await authService.registerWithPhone({
        fullName,
        phone,
        organizationId,
      });

      await createAuditEntry({
        organizationId,
        userId: result.user._id,
        userRole: result.user.role,
        actionType: AUDIT_ACTIONS.USER_REGISTER,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: result.user._id,
        newValue: { fullName, phone },
        req,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/login/email
   */
  async loginEmail(req, res, next) {
    try {
      const { email, password } = req.body;

      const result = await authService.loginWithEmail({ email, password });

      await createAuditEntry({
        organizationId: result.user.organizationId,
        userId: result.user._id,
        userRole: result.user.role,
        actionType: AUDIT_ACTIONS.USER_LOGIN,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: result.user._id,
        newValue: { method: 'email' },
        req,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/login/phone
   */
  async loginPhone(req, res, next) {
    try {
      const { phone } = req.body;

      const result = await authService.loginWithPhone({ phone });

      await createAuditEntry({
        organizationId: result.user.organizationId,
        userId: result.user._id,
        userRole: result.user.role,
        actionType: AUDIT_ACTIONS.USER_LOGIN,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: result.user._id,
        newValue: { method: 'phone' },
        req,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/otp/send
   */
  async sendOtp(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await otpService.sendOTP(phone);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/otp/verify
   */
  async verifyOtp(req, res, next) {
    try {
      const { phone, code } = req.body;
      const result = await otpService.verifyOTP(phone, code);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/refresh
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const result = await authService.refreshAccessToken(refreshToken);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/logout
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      await authService.logout(req.userId, refreshToken);

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/logout-all
   */
  async logoutAll(req, res, next) {
    try {
      await authService.logoutAll(req.userId);

      res.json({
        success: true,
        message: 'Logged out from all devices',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/auth/profile
   */
  async getProfile(req, res, next) {
    try {
      const profile = await authService.getProfile(req.userId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/auth/profile
   */
  async updateProfile(req, res, next) {
    try {
      const profile = await authService.updateProfile(req.userId, req.body);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/auth/change-password
   */
  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const tokens = await authService.changePassword(req.userId, {
        currentPassword,
        newPassword,
      });

      res.json({
        success: true,
        data: tokens,
        message: 'Password changed. You have been logged out from other devices.',
      });
    } catch (error) {
      next(error);
    }
  }
  /**
   * POST /api/auth/forgot-password
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/reset-password/:token
   */
  async resetPassword(req, res, next) {
    try {
      const { token } = req.params;
      const { password } = req.body;
      const result = await authService.resetPassword(token, password);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
