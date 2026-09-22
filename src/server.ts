import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import path from 'path';
import { env } from './config';
import { testConnection, closeConnection } from './config/database';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(helmet());
app.use(cors({ origin: env.APP_URL, credentials: true }));
app.use(requestIdMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
  }),
);

app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }),
);

app.use(express.static('public'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import claimRoutes from './routes/claims';
import reviewRoutes from './routes/review';
import pointsRoutes from './routes/points';
import rulesRoutes from './routes/rules';
import offersRoutes from './routes/offers';
import redemptionRoutes from './routes/redemptions';
import pageRoutes from './routes/pages';
import adminPageRoutes from './routes/adminPages';

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/review', reviewRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/admin/rules', rulesRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/redemptions', redemptionRoutes);

app.use('/', pageRoutes);
app.use('/admin', adminPageRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer(): Promise<void> {
  const connected = await testConnection();
  if (!connected) {
    logger.error('Failed to connect to database. Exiting.');
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
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
