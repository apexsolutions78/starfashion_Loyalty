// Runs before test files are loaded (setupFiles), so values set here win over .env:
// dotenv does not override existing process.env entries.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '500000';
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '500000';

// Keep jest output readable; the app's winston logger would otherwise print
// every request-scoped line to the console during tests.
try {
  require('./src/utils/logger').logger.silent = true;
} catch {
  // logger not loadable in this context — leave logging alone
}
