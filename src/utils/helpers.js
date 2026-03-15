// ============================================
// MatchPulse — Utility Helpers
// ============================================

const crypto = require('crypto');

/**
 * Generate a random invite code
 */
const generateInviteCode = (length = 8) => {
  return crypto.randomBytes(length).toString('hex').slice(0, length).toUpperCase();
};

/**
 * Generate a random 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Slugify a string (URL-safe)
 */
const createSlug = (str) => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Parse pagination params from query
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Build pagination response metadata
 */
const paginationMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});

/**
 * Pick specific keys from an object
 */
const pick = (obj, keys) => {
  return keys.reduce((acc, key) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

/**
 * Omit specific keys from an object
 */
const omit = (obj, keys) => {
  return Object.keys(obj).reduce((acc, key) => {
    if (!keys.includes(key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

/**
 * Get client IP from request
 */
const getClientIP = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.connection?.remoteAddress
    || req.ip;
};

/**
 * Get device info from request
 */
const getDeviceInfo = (req) => {
  return {
    userAgent: req.headers['user-agent'] || 'unknown',
    platform: req.headers['x-platform'] || 'web',
  };
};

/**
 * Generate CloudFront URL for S3 object or fallback to S3 URL
 */
const getFileUrl = (key, cloudfrontUrl, bucket, region) => {
  if (cloudfrontUrl) {
    return `${cloudfrontUrl}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
};

/**
 * Calculate net run rate (cricket)
 */
const calculateNRR = (runsScored, oversPlayed, runsConceded, oversBowled) => {
  if (oversPlayed === 0 || oversBowled === 0) return 0;
  return (runsScored / oversPlayed) - (runsConceded / oversBowled);
};

/**
 * Convert overs to balls (e.g., 4.3 overs = 27 balls)
 */
const oversToBalls = (overs) => {
  const fullOvers = Math.floor(overs);
  const balls = Math.round((overs - fullOvers) * 10);
  return fullOvers * 6 + balls;
};

/**
 * Convert balls to overs display (e.g., 27 balls = 4.3)
 */
const ballsToOvers = (balls) => {
  const fullOvers = Math.floor(balls / 6);
  const remainingBalls = balls % 6;
  return parseFloat(`${fullOvers}.${remainingBalls}`);
};

/**
 * Sleep for given ms (used in retry logic)
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  generateInviteCode,
  generateOTP,
  createSlug,
  parsePagination,
  paginationMeta,
  pick,
  omit,
  getClientIP,
  getDeviceInfo,
  getFileUrl,
  calculateNRR,
  oversToBalls,
  ballsToOvers,
  sleep,
};
