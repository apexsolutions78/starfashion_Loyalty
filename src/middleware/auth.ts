import { Request, Response, NextFunction } from 'express';
import { createAppError } from './errorHandler';

export type Role = 'customer' | 'cashier' | 'reviewer' | 'manager' | 'master_admin';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(createAppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }
  next();
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createAppError('Authentication required', 401, 'AUTH_REQUIRED'));
    }
    if (!roles.includes(req.user.role)) {
      return next(createAppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export function authorizeCustomer(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(createAppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }
  if (req.user.role !== 'customer') {
    return next(createAppError('Customer access required', 403, 'FORBIDDEN'));
  }
  next();
}

export function authorizeAdmin(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createAppError('Authentication required', 401, 'AUTH_REQUIRED'));
    }
    const adminRoles: Role[] = ['reviewer', 'manager', 'master_admin'];
    if (!adminRoles.includes(req.user.role)) {
      return next(createAppError('Admin access required', 403, 'FORBIDDEN'));
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return next(createAppError('Insufficient admin permissions', 403, 'FORBIDDEN'));
    }
    next();
  };
}
