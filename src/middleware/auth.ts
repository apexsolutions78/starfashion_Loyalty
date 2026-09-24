import { Request, Response, NextFunction } from 'express';
import { createAppError } from './errorHandler';
import { UserModel } from '../models/UserModel';

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

export function loadSessionUser(req: Request, _res: Response, next: NextFunction): void {
  if (req.session.userId && !req.user) {
    req.user = {
      id: req.session.userId,
      email: '',
      role: req.session.userRole as Role,
    };
  }
  next();
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    return next(createAppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }
  try {
    // Re-validate role/status from DB so suspend/role-change takes effect immediately
    const user = await UserModel.findById(req.user.id);
    if (!user || user.status !== 'active') {
      return next(createAppError('Account is not active', 403, 'ACCOUNT_INACTIVE'));
    }
    req.user.role = user.role as Role;
    req.user.email = user.email;
    if (req.session.userRole !== user.role) {
      req.session.userRole = user.role;
    }
    next();
  } catch (error) {
    next(error);
  }
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
