import { z } from 'zod';

export const emailSchema = z.string().email().toLowerCase().trim();

export const mobileSchema = z
  .string()
  .min(10)
  .max(20)
  .regex(/^\+?[0-9\s\-()]+$/, 'Invalid mobile number format')
  .transform((val) => val.replace(/[\s\-()]/g, ''));

export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const receiptNumberSchema = z.string().min(1).max(100).trim();

export const amountSchema = z
  .coerce.number()
  .positive()
  .max(99999999.99)
  .transform((val) => Math.round(val * 100) / 100);

export const uuidSchema = z.string().uuid();
