const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const {
  registerEmailValidation,
  registerPhoneValidation,
  loginEmailValidation,
  sendOtpValidation,
  verifyOtpValidation,
  refreshTokenValidation,
  changePasswordValidation,
  updateProfileValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
} = require('../validators/auth.validator');

// Public routes (with auth rate limiting)
router.post('/register/email', authLimiter, registerEmailValidation, validate, authController.registerEmail);
router.post('/register/phone', authLimiter, registerPhoneValidation, validate, authController.registerPhone);
router.post('/login/email', authLimiter, loginEmailValidation, validate, authController.loginEmail);
router.post('/login/phone', authLimiter, authController.loginPhone);
router.post('/otp/send', authLimiter, sendOtpValidation, validate, authController.sendOtp);
router.post('/otp/verify', authLimiter, verifyOtpValidation, validate, authController.verifyOtp);
router.post('/refresh', refreshTokenValidation, validate, authController.refreshToken);
router.post('/forgot-password', authLimiter, forgotPasswordValidation, validate, authController.forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPasswordValidation, validate, authController.resetPassword);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, updateProfileValidation, validate, authController.updateProfile);
router.put('/change-password', authenticate, changePasswordValidation, validate, authController.changePassword);

module.exports = router;
