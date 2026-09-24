import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { ConnectSessionKnexStore } from 'connect-session-knex';
import expressLayouts from 'express-ejs-layouts';
import path from 'path';
import { env } from './config';
import { db, testConnection, closeConnection } from './config/database';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { loadSessionUser } from './middleware/auth';
import { originCheck, ensureCsrfToken, verifyCsrfToken } from './middleware/csrf';
import { logger } from './utils/logger';
import { startVoucherExpiryJob, stopVoucherExpiryJob } from './jobs/voucherExpiry';

const app = express();

// Required for correct client IPs / secure cookies behind a reverse proxy
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        upgradeInsecureRequests: null,
      },
    },
  }),
);
app.use(cors({ origin: env.APP_URL, credentials: true }));
app.use(requestIdMiddleware);

// CSRF line 1: reject cross-origin state-changing requests when Origin is present
app.use(originCheck);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === '/health' ||
      req.path.startsWith('/css/') ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/images/') ||
      req.path.startsWith('/fonts/') ||
      /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?|ttf|eot)$/i.test(req.path),
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMIT', message: 'Too many requests. Please wait a moment and try again.' },
      });
    },
  }),
);

const sessionStore = new ConnectSessionKnexStore({
  knex: db,
  createTable: true,
  cleanupInterval: 60000,
});

app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }),
);

app.use(loadSessionUser);
app.use(ensureCsrfToken);
app.use(verifyCsrfToken);
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

  startVoucherExpiryJob();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    stopVoucherExpiryJob();
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
