const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');
const env = require('../config/env');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { BadRequestError } = require('../utils/errors');

const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

class UploadService {
  /**
   * Upload a file to S3
   * @param {Buffer} buffer - File buffer
   * @param {string} mimetype - File MIME type
   * @param {string} folder - S3 folder (e.g., 'avatars', 'logos', 'media')
   * @returns {object} { key, url }
   */
  async uploadFile(buffer, mimetype, folder = 'uploads') {
    if (!ALLOWED_MIME_TYPES[mimetype]) {
      throw new BadRequestError(`File type ${mimetype} is not allowed. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`);
    }

    if (buffer.length > MAX_FILE_SIZE) {
      throw new BadRequestError(`File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const ext = ALLOWED_MIME_TYPES[mimetype];
    const key = `${folder}/${uuidv4()}${ext}`;

    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
      CacheControl: 'public, max-age=31536000', // 1 year cache
    });

    await s3Client.send(command);

    const url = this.getPublicUrl(key);

    return { key, url };
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key) {
    const command = new DeleteObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
    });

    await s3Client.send(command);
  }

  /**
   * Generate a pre-signed upload URL (for direct client uploads)
   */
  async getPresignedUploadUrl(folder, filename, mimetype) {
    if (!ALLOWED_MIME_TYPES[mimetype]) {
      throw new BadRequestError(`File type ${mimetype} is not allowed`);
    }

    const ext = path.extname(filename) || ALLOWED_MIME_TYPES[mimetype];
    const key = `${folder}/${uuidv4()}${ext}`;

    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: mimetype,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    return {
      presignedUrl,
      key,
      publicUrl: this.getPublicUrl(key),
    };
  }

  /**
   * Generate a pre-signed download URL
   */
  async getPresignedDownloadUrl(key) {
    const command = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    return presignedUrl;
  }

  /**
   * Get public URL for a file
   */
  getPublicUrl(key) {
    if (env.AWS_CLOUDFRONT_URL) {
      return `${env.AWS_CLOUDFRONT_URL}/${key}`;
    }
    return `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  }
}

module.exports = new UploadService();
