const bcrypt = require('bcryptjs');
const env = require('../config/env');
const User = require('../models/User');
const { BadRequestError } = require('../utils/errors');
const { generateOTP } = require('../utils/helpers');

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

let twilioClient = null;

const getTwilioClient = () => {
  if (!twilioClient && env.TWILIO_ACCOUNT_SID) {
    const twilio = require('twilio');
    twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
};

class OTPService {
  /**
   * Send OTP via Twilio SMS
   * Generates a 6-digit OTP, stores hashed in DB, sends via SMS
   */
  async sendOTP(phone) {
    if (!phone) {
      throw new BadRequestError('Phone number is required');
    }

    const otpCode = generateOTP(); // 6-digit random code
    const otpHash = await bcrypt.hash(otpCode, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP (hashed) on user — or create a temporary record
    const user = await User.findOneAndUpdate(
      { phone },
      {
        $set: {
          'otp.code': otpHash,
          'otp.expiresAt': expiresAt,
          'otp.attempts': 0,
        },
      },
      { upsert: false }
    );

    // If user doesn't exist yet (new registration), store in a temporary way
    // The OTP will be verified before registration completes
    if (!user) {
      // Store temporarily — we'll check during registration
      // For now, store as a lightweight document
      await User.findOneAndUpdate(
        { phone },
        {
          $set: {
            phone,
            fullName: 'Pending Registration',
            'otp.code': otpHash,
            'otp.expiresAt': expiresAt,
            'otp.attempts': 0,
            isActive: false, // Not yet registered
          },
        },
        { upsert: true, new: true }
      );
    }

    // Always send real SMS via Twilio (dev and production)
    const client = getTwilioClient();
    if (!client) {
      throw new BadRequestError(
        'SMS service not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your .env file.'
      );
    }

    try {
      const message = await client.messages.create({
        body: `Your MatchPulse verification code is: ${otpCode}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
        from: env.TWILIO_PHONE_NUMBER,
        to: phone,
      });

      console.log(`📱 OTP sent to ${phone} (SID: ${message.sid})`);

      return {
        success: true,
        message: 'OTP sent successfully',
      };
    } catch (error) {
      console.error('❌ Twilio SMS send error:', error.message);
      throw new BadRequestError('Failed to send OTP. Please try again.');
    }
  }

  /**
   * Verify OTP code
   * Checks against the hashed OTP stored in DB
   */
  async verifyOTP(phone, code) {
    if (!phone || !code) {
      throw new BadRequestError('Phone number and OTP code are required');
    }

    // Find user with OTP fields
    const user = await User.findOne({ phone }).select('+otp.code +otp.expiresAt +otp.attempts');

    if (!user || !user.otp?.code) {
      throw new BadRequestError('No OTP requested for this number. Please request a new OTP.');
    }

    // Check expiry
    if (user.otp.expiresAt < new Date()) {
      // Clear expired OTP
      await User.findByIdAndUpdate(user._id, {
        $unset: { 'otp.code': 1 },
      });
      throw new BadRequestError('OTP has expired. Please request a new one.');
    }

    // Check max attempts
    if (user.otp.attempts >= MAX_OTP_ATTEMPTS) {
      await User.findByIdAndUpdate(user._id, {
        $unset: { 'otp.code': 1 },
      });
      throw new BadRequestError('Too many failed attempts. Please request a new OTP.');
    }

    // Verify OTP (compare against hash)
    const isValid = await bcrypt.compare(code, user.otp.code);

    if (!isValid) {
      // Increment attempts
      await User.findByIdAndUpdate(user._id, {
        $inc: { 'otp.attempts': 1 },
      });
      const remaining = MAX_OTP_ATTEMPTS - user.otp.attempts - 1;
      throw new BadRequestError(
        `Invalid OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      );
    }

    // OTP is valid — clear it
    await User.findByIdAndUpdate(user._id, {
      $unset: { 'otp.code': 1, 'otp.expiresAt': 1 },
      $set: { 'otp.attempts': 0 },
    });

    // Activate user if they were pending
    if (!user.isActive && user.fullName === 'Pending Registration') {
      // User will be fully activated during registration
    }

    return {
      success: true,
      message: 'OTP verified successfully',
      isExistingUser: user.isActive && user.fullName !== 'Pending Registration',
    };
  }
}

module.exports = new OTPService();
