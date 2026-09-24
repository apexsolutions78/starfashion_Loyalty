import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().default(3306),
  DATABASE_USER: isDev ? z.string().optional() : z.string().min(1),
  DATABASE_PASSWORD: isDev ? z.string().optional() : z.string().min(1),
  DATABASE_NAME: isDev ? z.string().optional() : z.string().min(1),

  SESSION_SECRET: isProd
    ? z
        .string()
        .min(32, 'SESSION_SECRET must be at least 32 characters in production')
        .refine(
          (v) => !v.includes('dev-session-secret') && !v.includes('change-in-production'),
          'SESSION_SECRET must not be a placeholder value',
        )
    : z.string().min(16).default('dev-session-secret-change-in-production-1234'),

  UPLOAD_DIR: z.string().default('./private-storage/receipts'),
  MAX_UPLOAD_MB: z.coerce.number().default(8),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(2000),

  RECEIPT_NUMBER_REGEX: z.string().default('^\\d{2}-\\d{2}-\\d{4}-\\d{2}$'),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
