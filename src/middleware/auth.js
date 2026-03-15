const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Authenticate JWT token from Authorization header
 * Sets req.user with the authenticated user
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Access token required');
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-passwordHash -refreshTokens');

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('Invalid access token'));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED'));
    }
    next(error);
  }
};

/**
 * Optional authentication — sets req.user if token is present, but doesn't fail
 * Used for public endpoints that optionally benefit from knowing the user
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-passwordHash -refreshTokens');

    if (user && user.isActive) {
      req.user = user;
      req.userId = user._id;
    }
  } catch (error) {
    // Silently ignore auth errors for optional auth
  }
  next();
};

module.exports = { authenticate, optionalAuth };
