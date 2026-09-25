import { env } from './config';
import { testConnection, closeConnection } from './config/database';
import { createApp } from './app';
import { logger } from './utils/logger';
import { startVoucherExpiryJob, stopVoucherExpiryJob } from './jobs/voucherExpiry';
import { startPointExpiryJob, stopPointExpiryJob } from './jobs/pointExpiry';

const app = createApp();

async function startServer(): Promise<void> {
  const connected = await testConnection();
  if (!connected) {
    logger.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });

  startVoucherExpiryJob();
  startPointExpiryJob();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    stopVoucherExpiryJob();
    stopPointExpiryJob();
    server.close(async () => {
      await closeConnection();
      logger.info('Server shut down');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

export { app };
