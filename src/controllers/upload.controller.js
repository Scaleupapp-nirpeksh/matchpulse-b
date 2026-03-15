const uploadService = require('../services/upload.service');
const User = require('../models/User');

class UploadController {
  /**
   * POST /api/upload/avatar
   */
  async uploadAvatar(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const { key, url } = await uploadService.uploadFile(
        req.file.buffer,
        req.file.mimetype,
        'avatars'
      );

      // Update user avatar
      await User.findByIdAndUpdate(req.userId, { avatarUrl: url });

      res.json({
        success: true,
        data: { key, url },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/upload/logo
   */
  async uploadLogo(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const { key, url } = await uploadService.uploadFile(
        req.file.buffer,
        req.file.mimetype,
        'logos'
      );

      res.json({
        success: true,
        data: { key, url },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/upload/media
   */
  async uploadMedia(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const { key, url } = await uploadService.uploadFile(
        req.file.buffer,
        req.file.mimetype,
        'media'
      );

      res.json({
        success: true,
        data: { key, url },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/upload/presigned
   * Get pre-signed URL for direct client upload
   */
  async getPresignedUrl(req, res, next) {
    try {
      const { folder, filename, mimetype } = req.body;

      const result = await uploadService.getPresignedUploadUrl(
        folder || 'uploads',
        filename,
        mimetype
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/upload/:key
   */
  async deleteFile(req, res, next) {
    try {
      await uploadService.deleteFile(req.params.key);

      res.json({
        success: true,
        message: 'File deleted',
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UploadController();
