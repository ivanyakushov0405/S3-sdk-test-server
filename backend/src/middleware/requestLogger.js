const { randomUUID } = require('crypto');
const { logger } = require('../logger');

function requestLogger(req, res, next) {
    req.id = randomUUID();
    const start = Date.now();
    const apiLogger = logger.child({ 
        type: 'HTTP api',
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        ip: req.clientIp, 
    });
    req.logger = apiLogger;

    res.on('finish', () => {
        const duration = Date.now() - start;
        apiLogger.info(`${req.method} ${req.originalUrl} => ${res.statusCode} (${duration}ms)`, {
            type: 'HTTP response',
            status: res.statusCode,
            durationMs: duration,
        });
    });

    next();
}




module.exports = requestLogger;