require('dotenv').config();
const http = require('http');
const { redis } = require('./database');
const { logger } = require('./logger');

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { err });
  process.exit(1);
});

const app = require('./app');

async function start() {
  await redis.connect();
  server = http.createServer(app);
  server.listen(4000, () => logger.info(`Api server listening on 4000 with node status ${process.env.NODE_ENV}`, { port: 4000 }));
}

start().catch((err) => {
    logger.error('Не удалось запустить Api server', { err });
    process.exit(1);
});

// graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM получен, завершаю работу...');
  server.close(() => {
    logger.info('Server stopped');
    process.exit(0);
  });
});