const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/**
 * General API rate limiter
 */
const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: env.isDev() ? 1000 : env.RATE_LIMIT_MAX_REQUESTS, // 1000 in dev, 100 in production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Too many requests, please try again later',
    },
  },
});

/**
 * Strict rate limiter for auth endpoints (login, register, OTP)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.isDev() ? 100 : 10, // 100 in dev, 10 in production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Too many authentication attempts, please try again later',
    },
  },
});

/**
 * Scoring rate limiter (higher limit for fast-paced sports)
 */
const scoringLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 events per minute (2 per second — handles basketball)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Scoring rate limit exceeded',
    },
  },
});

/**
 * Upload rate limiter
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,                    // 50 uploads per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Upload rate limit exceeded, please try again later',
    },
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
  scoringLimiter,
  uploadLimiter,
};
