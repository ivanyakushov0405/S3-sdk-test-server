const { logger } = require('../logger');
function errorHandler(err, req, res, next) {
  const log = req.logger || logger;
  log.error('Unhandled error', {
    type: 'HTTP unhandled error',
    error: err.message,
    stack: err.stack,
  });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message,
  });
}

module.exports = errorHandler;