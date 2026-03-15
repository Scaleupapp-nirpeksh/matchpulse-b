const { validationResult } = require('express-validator');

/**
 * Express-validator result handler middleware
 * Place after validation chain to return errors
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array().map((err) => ({
          field: err.path,
          message: err.msg,
          value: err.value,
        })),
      },
    });
  }

  next();
};

module.exports = { validate };
