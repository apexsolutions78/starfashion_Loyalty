import winston from 'winston';
import { env } from '../config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const reqStr = requestId ? ` [${requestId}]` : '';
    return `${timestamp} ${level}${reqStr}: ${message}${metaStr}`;
  }),
);

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'starfashion-loyalty' },
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

if (env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

export function createRequestLogger(requestId: string) {
  return {
    info: (message: string, meta?: object) => logger.info(message, { requestId, ...meta }),
    warn: (message: string, meta?: object) => logger.warn(message, { requestId, ...meta }),
    error: (message: string, meta?: object) => logger.error(message, { requestId, ...meta }),
    debug: (message: string, meta?: object) => logger.debug(message, { requestId, ...meta }),
  };
}
