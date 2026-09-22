import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';
import { createRequestLogger } from '../utils/logger';
import { env } from '../config';

export interface AppError extends Error {
  statusCode: number;
  code: string;
  isOperational: boolean;
}

export function createAppError(message: string, statusCode: number, code: string): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  error.isOperational = true;
  return error;
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const log = createRequestLogger(req.requestId);

  if (err instanceof ZodError) {
    const zodErr = err as ZodError;
    const message = zodErr.issues.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; ');
    log.warn('Validation error', { errors: zodErr.issues });
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message },
      requestId: req.requestId,
    });
    return;
  }

  if ('statusCode' in err && 'code' in err) {
    const appErr = err as AppError;
    if (appErr.statusCode >= 500) {
      log.error(appErr.message, { stack: appErr.stack, code: appErr.code });
    } else {
      log.warn(appErr.message, { code: appErr.code });
    }
    res.status(appErr.statusCode).json({
      error: { code: appErr.code, message: appErr.message },
      requestId: req.requestId,
    });
    return;
  }

  log.error('Unhandled error', { stack: err.stack, message: err.message });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
    requestId: req.requestId,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    requestId: req.requestId,
  });
}
