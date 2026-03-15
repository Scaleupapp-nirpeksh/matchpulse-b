const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');
const { authenticate } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// All upload routes require auth + rate limiting
router.use(authenticate);
router.use(uploadLimiter);

router.post('/avatar', upload.single('file'), uploadController.uploadAvatar);
router.post('/logo', upload.single('file'), uploadController.uploadLogo);
router.post('/media', upload.single('file'), uploadController.uploadMedia);
router.post('/presigned', uploadController.getPresignedUrl);
router.delete('/:key(*)', uploadController.deleteFile);

module.exports = router;
