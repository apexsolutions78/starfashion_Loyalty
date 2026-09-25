import request from 'supertest';
import type { Express } from 'express';
import argon2 from 'argon2';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { db } from '../config/database';

export type Agent = ReturnType<typeof request.agent>;

/** Children first — safe delete order under foreign keys (better-sqlite3 FK pragma is ON). */
const TABLES = [
  'redemption_vouchers', // -> points_ledger
  'points_ledger', // -> receipt_claims, users
  'notifications', // -> receipt_claims, users
  'receipt_claims', // -> users
  'audit_logs', // -> users
  'consents', // -> users
  'password_reset_tokens', // -> users
  'contact_verifications', // -> users
  'offers', // -> users
  'loyalty_rules', // -> users
  'article_categories', // -> users
  'admin_profiles', // -> users
  'customer_profiles', // -> users
  'users',
  'system_settings',
  'sessions',
];

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Mirrors the seed data created by migrations/20260925000001. */
export const SEED_CATEGORIES = [
  { category: 'three-piece', article_prefix: 'SF-3PC', description: 'Ready-made 3-piece suits' },
  { category: 'two-piece', article_prefix: 'SF-2PC', description: 'Ready-made 2-piece suits' },
  { category: 'stitched', article_prefix: 'SF-STCH', description: 'Stitched articles' },
  { category: 'unstitched', article_prefix: 'SF-UNST', description: 'Unstitched fabric' },
];

export async function createTestApp(): Promise<Express> {
  await db.migrate.latest();
  // A stale test DB from a previous run must not leak into the first test.
  await resetDb();
  const { createApp } = await import('../app');
  return createApp();
}

export async function resetDb(): Promise<void> {
  const images = (await db.schema.hasTable('receipt_claims'))
    ? await db('receipt_claims').select('receipt_image_path')
    : [];
  for (const table of TABLES) {
    // `sessions` only exists once createApp() has built the session store.
    if (await db.schema.hasTable(table)) {
      await db(table).del();
    }
  }
  for (const row of images) {
    if (row?.receipt_image_path) {
      await fs.unlink(row.receipt_image_path).catch(() => undefined);
    }
  }
  // Migrations only run once, so the lookup table has to be restored after every wipe.
  await db('article_categories').insert(
    SEED_CATEGORIES.map((c) => ({ id: randomUUID(), ...c })),
  );
}

export const DEFAULT_RULES = {
  currencyThreshold: 1000,
  pointsPerThreshold: 10,
  minimumPurchaseAmount: 0,
  eligibleCategories: [] as string[],
  excludedCategories: [] as string[],
  maxPointsPerClaim: 0,
  pointExpiryDays: null as number | null,
  redemptionConversion: 100,
  minimumRedemptionPoints: 100,
  maxRedemptionPercentage: 100,
  maxFixedDiscount: 0,
  earnOnPointsPayment: false,
  claimSubmissionWindowDays: 30,
};

export async function seedActiveRule(overrides: Partial<typeof DEFAULT_RULES> = {}): Promise<void> {
  await db('loyalty_rules').insert({
    id: randomUUID(),
    version: 1,
    name: 'Test Rule v1',
    rules_json: JSON.stringify({ ...DEFAULT_RULES, ...overrides }),
    is_active: true,
    effective_from: new Date('2020-01-01T00:00:00Z'),
    effective_to: null,
  });
}

export interface TestUserOptions {
  role?: 'customer' | 'reviewer' | 'manager' | 'master_admin';
  email?: string;
  mobile?: string;
  password?: string;
  fullName?: string;
  tier?: string;
}

export async function createUser(opts: TestUserOptions = {}): Promise<{ id: string; email: string; password: string }> {
  const id = randomUUID();
  const email = opts.email ?? `user-${id.slice(0, 8)}@example.com`;
  const mobile = opts.mobile ?? `+92300${id.replace(/-/g, '').slice(0, 8)}`;
  const password = opts.password ?? 'Password123';
  const role = opts.role ?? 'customer';

  const hash = await argon2.hash(password, { type: argon2.argon2id });

  await db('users').insert({
    id,
    role,
    email,
    mobile,
    password_hash: hash,
    status: 'active',
    email_verified: true,
    mobile_verified: true,
  });

  if (role === 'customer') {
    await db('customer_profiles').insert({
      id: randomUUID(),
      user_id: id,
      full_name: opts.fullName ?? `Test ${id.slice(0, 4)}`,
      marketing_consent: true,
      loyalty_consent: true,
      tier: opts.tier ?? 'standard',
    });
  } else {
    await db('admin_profiles').insert({
      id: randomUUID(),
      user_id: id,
      full_name: opts.fullName ?? `Admin ${id.slice(0, 4)}`,
      department: 'QA',
    });
  }

  return { id, email, password };
}

/** Boots a fresh session and returns its CSRF token (read from the login page). */
export async function freshSession(app: Express): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(app);
  const res = await agent.get('/login');
  const match = /name="csrf-token"\s+content="([^"]+)"/.exec(res.text);
  if (!match) throw new Error('csrf meta not found on /login');
  return { agent, csrf: match[1] };
}

export async function loginAs(
  app: Express,
  email: string,
  password: string,
): Promise<{ agent: Agent; csrf: string; userId: string }> {
  const { agent, csrf } = await freshSession(app);
  const res = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });

  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return { agent, csrf: res.body.csrfToken as string, userId: res.body.user.id as string };
}

export interface ClaimInput {
  receiptNumber?: string;
  purchaseDate?: string;
  submittedAmount?: number;
  submittedArticles?: string[];
}

export async function submitClaim(
  agent: Agent,
  csrf: string,
  input: ClaimInput = {},
) {
  const today = new Date().toISOString().slice(0, 10);
  return agent
    .post('/api/claims')
    .set('x-csrf-token', csrf)
    .field('receiptNumber', input.receiptNumber ?? '25-09-2026-01')
    .field('purchaseDate', input.purchaseDate ?? today)
    .field('submittedAmount', String(input.submittedAmount ?? 5000))
    .field(
      'submittedArticles',
      JSON.stringify(input.submittedArticles ?? ['SF-3PC-001']),
    )
    .attach('receiptImage', ONE_BY_ONE_PNG, {
      filename: 'receipt.png',
      contentType: 'image/png',
    });
}

export async function balanceOf(customerId: string): Promise<number> {
  const row = await db('points_ledger')
    .where('customer_id', customerId)
    .select(db.raw('COALESCE(SUM(points), 0) as balance'))
    .first();
  return Number(row?.balance || 0);
}

/**
 * Sorted list of ledger types for a customer. Sorted because SQLite's
 * `CURRENT_TIMESTAMP` default only has second precision, so rows written in
 * the same second have no stable ordering.
 */
export async function ledgerTypes(customerId: string): Promise<string[]> {
  const rows = await db('points_ledger').where('customer_id', customerId).select('type');
  return rows.map((r) => String(r.type)).sort();
}

export async function cleanup(): Promise<void> {
  await resetDb();
  await db.destroy();
}
