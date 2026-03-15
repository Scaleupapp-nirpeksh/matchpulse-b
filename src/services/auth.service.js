const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const User = require('../models/User');
const { BadRequestError, UnauthorizedError, ConflictError, NotFoundError } = require('../utils/errors');

class AuthService {
  /**
   * Register with email and password
   */
  async registerWithEmail({ fullName, email, password, organizationId = null, role = 'player' }) {
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    const user = new User({
      fullName,
      email,
      passwordHash: password, // Pre-save hook will hash it
      organizationId,
      role,
    });

    await user.save();

    const tokens = this.generateTokens(user);
    await this.saveRefreshToken(user._id, tokens.refreshToken);

    return {
      user: user.toPublicJSON(),
      ...tokens,
    };
  }

  /**
   * Register with phone (after OTP verification)
   */
  async registerWithPhone({ fullName, phone, organizationId = null, role = 'player' }) {
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      throw new ConflictError('Phone number already registered');
    }

    const user = new User({
      fullName,
      phone,
      organizationId,
      role,
    });

    await user.save();

    const tokens = this.generateTokens(user);
    await this.saveRefreshToken(user._id, tokens.refreshToken);

    return {
      user: user.toPublicJSON(),
      ...tokens,
    };
  }

  /**
   * Login with email and password
   */
  async loginWithEmail({ email, password }) {
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    const tokens = this.generateTokens(user);
    await this.saveRefreshToken(user._id, tokens.refreshToken);

    return {
      user: user.toPublicJSON(),
      ...tokens,
    };
  }

  /**
   * Login with phone (after OTP verification)
   */
  async loginWithPhone({ phone }) {
    const user = await User.findOne({ phone });
    if (!user) {
      throw new NotFoundError('Phone number not registered');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    user.lastLoginAt = new Date();
    await user.save();

    const tokens = this.generateTokens(user);
    await this.saveRefreshToken(user._id, tokens.refreshToken);

    return {
      user: user.toPublicJSON(),
      ...tokens,
    };
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token required');
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User not found or deactivated');
    }

    // Verify refresh token exists in user's stored tokens
    const tokenExists = user.refreshTokens.some(
      (rt) => rt.token === refreshToken && rt.expiresAt > new Date()
    );

    if (!tokenExists) {
      throw new UnauthorizedError('Refresh token revoked or expired');
    }

    // Remove old refresh token and generate new pair
    user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== refreshToken);
    await user.save();

    const tokens = this.generateTokens(user);
    await this.saveRefreshToken(user._id, tokens.refreshToken);

    return {
      user: user.toPublicJSON(),
      ...tokens,
    };
  }

  /**
   * Logout — revoke refresh token
   */
  async logout(userId, refreshToken) {
    const user = await User.findById(userId);
    if (user) {
      user.refreshTokens = user.refreshTokens.filter((rt) => rt.token !== refreshToken);
      await user.save();
    }
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId) {
    await User.findByIdAndUpdate(userId, { refreshTokens: [] });
  }

  /**
   * Generate access and refresh tokens
   */
  generateTokens(user) {
    const accessToken = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Save refresh token to user document
   */
  async saveRefreshToken(userId, refreshToken, deviceInfo = 'unknown') {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await User.findByIdAndUpdate(userId, {
      $push: {
        refreshTokens: {
          token: refreshToken,
          deviceInfo,
          expiresAt,
        },
      },
    });

    // Clean up expired tokens
    await User.findByIdAndUpdate(userId, {
      $pull: {
        refreshTokens: { expiresAt: { $lt: new Date() } },
      },
    });
  }

  /**
   * Get user profile
   */
  async getProfile(userId) {
    const user = await User.findById(userId)
      .select('-passwordHash -refreshTokens')
      .populate('organizationId', 'name slug logoUrl');

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user.toPublicJSON();
  }

  /**
   * Update user profile
   */
  async updateProfile(userId, updates) {
    const allowedUpdates = ['fullName', 'bio', 'avatarUrl', 'preferredSports', 'privacySettings', 'notificationPreferences'];
    const filteredUpdates = {};

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: filteredUpdates },
      { new: true, runValidators: true }
    ).select('-passwordHash -refreshTokens');

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user.toPublicJSON();
  }

  /**
   * Change password
   */
  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await User.findById(userId).select('+passwordHash');
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.passwordHash) {
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        throw new BadRequestError('Current password is incorrect');
      }
    }

    user.passwordHash = newPassword; // Pre-save hook will hash
    user.refreshTokens = []; // Logout from all devices
    await user.save();

    const tokens = this.generateTokens(user);
    await this.saveRefreshToken(user._id, tokens.refreshToken);

    return tokens;
  }
}

module.exports = new AuthService();
