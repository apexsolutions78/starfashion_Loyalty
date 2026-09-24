import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { createAppError } from './errorHandler';
import { env } from '../config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(session: { csrfToken?: string }): string {
  const token = crypto.randomBytes(32).toString('hex');
  session.csrfToken = token;
  return token;
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Reject cross-origin state-changing requests when Origin is present. */
export function originCheck(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  const origin = req.headers.origin;
  if (origin) {
    let allowed = false;
    try {
      allowed = new URL(origin).origin === new URL(env.APP_URL).origin;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      res.status(403).json({
        error: { code: 'CSRF_ORIGIN', message: 'Cross-origin request blocked' },
      });
      return;
    }
  }
  next();
}

/** Ensure a CSRF token exists on the session and expose it to views via res.locals. */
export function ensureCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.csrfToken) {
    issueCsrfToken(req.session);
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/** Synchronizer-token check for state-changing requests (after session + body parsers). */
export function verifyCsrfToken(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  const headerToken = req.get('x-csrf-token');
  const bodyToken =
    req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? (req.body as Record<string, unknown>)._csrf
      : undefined;
  const presented = typeof headerToken === 'string' ? headerToken : typeof bodyToken === 'string' ? bodyToken : '';
  const expected = req.session.csrfToken;

  if (!expected || !presented || !tokensMatch(presented, expected)) {
    return next(createAppError('Invalid or missing CSRF token', 403, 'CSRF_INVALID'));
  }
  next();
}
