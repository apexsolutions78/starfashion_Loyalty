import request from 'supertest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '../config/database';
import { hashToken } from '../utils/crypto';
import { PointsEngineService } from '../services/PointsEngineService';
import {
  balanceOf,
  cleanup,
  createTestApp,
  createUser,
  DEFAULT_RULES,
  freshSession,
  ledgerTypes,
  loginAs,
  resetDb,
  seedActiveRule,
  submitClaim,
  type Agent,
} from '../test-utils/integration';

let app: Express;

jest.setTimeout(60000);

beforeAll(async () => {
  app = await createTestApp();
});

afterEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await cleanup();
});

async function createActiveOffer(
  masterAgent: Agent,
  csrf: string,
  conditions: Record<string, unknown>,
  offerType: 'multiplier' | 'fixed_bonus' = 'multiplier',
): Promise<string> {
  const res = await masterAgent
    .post('/api/offers')
    .set('x-csrf-token', csrf)
    .send({
      name: 'Test Offer',
      offerType,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      maxUsesPerCustomer: 5,
      conditions,
    });
  if (res.status !== 201) throw new Error(`offer create failed: ${JSON.stringify(res.body)}`);
  const offerId = res.body.offer.id as string;
  const act = await masterAgent.post(`/api/offers/${offerId}/activate`).set('x-csrf-token', csrf);
  if (act.status !== 200) throw new Error(`offer activate failed: ${JSON.stringify(act.body)}`);
  return offerId;
}

describe('health & error format', () => {
  it('serves /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns the documented error envelope for unknown API routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error.code');
    expect(res.body).toHaveProperty('requestId');
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request with no CSRF token', async () => {
    const { agent } = await freshSession(app);
    const res = await agent.post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    expect(res.body.requestId).toBeTruthy();
  });

  it('rejects a state-changing request from a foreign Origin', async () => {
    const { agent, csrf } = await freshSession(app);
    const res = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
    expect(res.body.requestId).toBeTruthy();
  });

  it('accepts a valid synchronizer token', async () => {
    const { agent, csrf } = await freshSession(app);
    const res = await agent.post('/api/auth/forgot-password').set('x-csrf-token', csrf).send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });
});

describe('authentication', () => {
  it('registers a customer and returns a fresh CSRF token', async () => {
    const { agent, csrf } = await freshSession(app);
    const res = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', csrf)
      .send({
        email: 'new@example.com',
        mobile: '+923001234567',
        password: 'Password123',
        fullName: 'New Customer',
        loyaltyConsent: true,
        marketingConsent: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.csrfToken).toEqual(expect.any(String));
    expect(res.body.csrfToken).not.toBe(csrf);
    expect(res.body.user.role).toBe('customer');
  });

  it('logs in and out, and rejects a bad password with a generic message', async () => {
    const user = await createUser({ email: 'login@example.com', password: 'Password123' });

    const bad = await loginAs(app, user.email, 'WrongPassword1').catch((e) => e);
    expect(bad).toBeInstanceOf(Error);
    expect(String(bad)).toContain('401');

    const session = await loginAs(app, user.email, 'Password123');
    const me = await session.agent.get('/api/auth/me').set('x-csrf-token', session.csrf);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);

    const out = await session.agent.post('/api/auth/logout').set('x-csrf-token', session.csrf);
    expect(out.status).toBe(200);

    const after = await session.agent.get('/api/auth/me').set('x-csrf-token', session.csrf);
    expect(after.status).toBe(401);
  });
});

describe('password change', () => {
  it('rejects a wrong current password', async () => {
    const user = await createUser({ email: 'pwrong@example.com' });
    const s = await loginAs(app, user.email, 'Password123');

    const res = await s.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', s.csrf)
      .send({ currentPassword: 'NotThePassword1', newPassword: 'BrandNewPass1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
  });

  it('rejects a password that fails the strength rules', async () => {
    const user = await createUser({ email: 'pweak@example.com' });
    const s = await loginAs(app, user.email, 'Password123');

    const res = await s.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', s.csrf)
      .send({ currentPassword: 'Password123', newPassword: 'alllowercase' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('changes a customer password and only the new one works afterwards', async () => {
    const user = await createUser({ email: 'pchange@example.com', password: 'Password123' });
    const s = await loginAs(app, user.email, 'Password123');

    const ok = await s.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', s.csrf)
      .send({ currentPassword: 'Password123', newPassword: 'BrandNewPass1' });
    expect(ok.status).toBe(200);

    await loginAs(app, user.email, 'Password123').catch((e) => {
      expect(String(e)).toContain('401');
    });
    const fresh = await loginAs(app, user.email, 'BrandNewPass1');
    expect(fresh.userId).toBe(user.id);
  });

  it('lets an admin change their own password too', async () => {
    const admin = await createUser({ role: 'manager', password: 'Password123' });
    const s = await loginAs(app, admin.email, 'Password123');

    const ok = await s.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', s.csrf)
      .send({ currentPassword: 'Password123', newPassword: 'ManagerPass1' });
    expect(ok.status).toBe(200);

    const fresh = await loginAs(app, admin.email, 'ManagerPass1');
    expect(fresh.userId).toBe(admin.id);
  });

  it('serves the profile pages to the matching role only', async () => {
    const customer = await createUser({ role: 'customer' });
    const cs = await loginAs(app, customer.email, 'Password123');
    const customerPage = await cs.agent.get('/profile');
    expect(customerPage.status).toBe(200);
    expect(customerPage.text).toContain('Change Password');
    const customerAdminPage = await cs.agent.get('/admin/profile');
    expect(customerAdminPage.status).toBe(403);

    const admin = await createUser({ role: 'reviewer' });
    const as = await loginAs(app, admin.email, 'Password123');
    const adminPage = await as.agent.get('/admin/profile');
    expect(adminPage.status).toBe(200);
    expect(adminPage.text).toContain('Change Password');
    const adminCustomerPage = await as.agent.get('/profile');
    expect(adminCustomerPage.status).toBe(403);
  });

  it('keeps the caller signed in but signs out every other session', async () => {
    const user = await createUser({ email: 'pmulti@example.com', password: 'Password123' });
    const deviceA = await loginAs(app, user.email, 'Password123');
    const deviceB = await loginAs(app, user.email, 'Password123');

    const changed = await deviceA.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', deviceA.csrf)
      .send({ currentPassword: 'Password123', newPassword: 'BrandNewPass1' });
    expect(changed.status).toBe(200);

    const stillHere = await deviceA.agent.get('/api/auth/me').set('x-csrf-token', deviceA.csrf);
    expect(stillHere.status).toBe(200);

    const kicked = await deviceB.agent.get('/api/auth/me').set('x-csrf-token', deviceB.csrf);
    expect(kicked.status).toBe(401);

    const audit = await db('audit_logs').where({ user_id: user.id, action: 'PASSWORD_CHANGED' });
    expect(audit).toHaveLength(1);
    expect(audit[0].entity_id).toBe(user.id);
    expect(JSON.stringify(audit[0].new_values ?? '')).not.toContain('Password');
  });

  it('signs out every session after an emailed reset link is used', async () => {
    const user = await createUser({ email: 'pemail@example.com', password: 'Password123' });
    const device = await loginAs(app, user.email, 'Password123');

    const token = randomBytes(32).toString('hex');
    await db('password_reset_tokens').insert({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const anon = await freshSession(app);
    const reset = await anon.agent
      .post('/api/auth/reset-password')
      .set('x-csrf-token', anon.csrf)
      .send({ token, newPassword: 'ResetPass123' });
    expect(reset.status).toBe(200);

    const kicked = await device.agent.get('/api/auth/me').set('x-csrf-token', device.csrf);
    expect(kicked.status).toBe(401);

    const fresh = await loginAs(app, user.email, 'ResetPass123');
    expect(fresh.userId).toBe(user.id);

    const audit = await db('audit_logs').where({ user_id: user.id, action: 'PASSWORD_RESET' });
    expect(audit).toHaveLength(1);
  });

  it('lets a manager reset a customer password, then the old one stops working', async () => {
    const customer = await createUser({ email: 'preset@example.com', password: 'Password123' });
    const session = await loginAs(app, customer.email, 'Password123');
    const manager = await createUser({ role: 'manager', password: 'Password123' });
    const ms = await loginAs(app, manager.email, 'Password123');

    const res = await ms.agent
      .post(`/api/admin/customers/${customer.id}/reset-password`)
      .set('x-csrf-token', ms.csrf)
      .send({ newPassword: 'TempPass123' });
    expect(res.status).toBe(200);

    const kicked = await session.agent.get('/api/auth/me').set('x-csrf-token', session.csrf);
    expect(kicked.status).toBe(401);

    await loginAs(app, customer.email, 'Password123').catch((e) => {
      expect(String(e)).toContain('401');
    });
    const fresh = await loginAs(app, customer.email, 'TempPass123');
    expect(fresh.userId).toBe(customer.id);

    const audit = await db('audit_logs').where({ action: 'PASSWORD_RESET_BY_ADMIN' });
    expect(audit).toHaveLength(1);
    expect(audit[0].user_id).toBe(manager.id);
    expect(audit[0].entity_id).toBe(customer.id);
    // the manager keeps their own session
    const stillHere = await ms.agent.get('/api/auth/me').set('x-csrf-token', ms.csrf);
    expect(stillHere.status).toBe(200);
  });

  it('refuses a password reset from a reviewer or a customer', async () => {
    const customer = await createUser({ email: 'powner@example.com', password: 'Password123' });
    const reviewer = await createUser({ role: 'reviewer', password: 'Password123' });
    const rs = await loginAs(app, reviewer.email, 'Password123');

    const byReviewer = await rs.agent
      .post(`/api/admin/customers/${customer.id}/reset-password`)
      .set('x-csrf-token', rs.csrf)
      .send({ newPassword: 'TempPass123' });
    expect(byReviewer.status).toBe(403);

    const other = await createUser({ role: 'customer', password: 'Password123' });
    const os = await loginAs(app, other.email, 'Password123');
    const byCustomer = await os.agent
      .post(`/api/admin/customers/${customer.id}/reset-password`)
      .set('x-csrf-token', os.csrf)
      .send({ newPassword: 'TempPass123' });
    expect(byCustomer.status).toBe(403);

    expect(await db('audit_logs').where({ action: 'PASSWORD_RESET_BY_ADMIN' })).toHaveLength(0);
  });

  it('rejects an unknown customer id with 404', async () => {
    const manager = await createUser({ role: 'manager', password: 'Password123' });
    const ms = await loginAs(app, manager.email, 'Password123');

    const res = await ms.agent
      .post(`/api/admin/customers/${randomUUID()}/reset-password`)
      .set('x-csrf-token', ms.csrf)
      .send({ newPassword: 'TempPass123' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('authorization & IDOR', () => {
  it('blocks anonymous access to admin APIs', async () => {
    const res = await request(app).get('/api/admin/ledger');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects a malformed id on detail routes with 400 VALIDATION_ERROR', async () => {
    const manager = await createUser({ role: 'manager', password: 'Password123' });
    const ms = await loginAs(app, manager.email, 'Password123');
    const customer = await createUser({ role: 'customer', password: 'Password123' });
    const cs = await loginAs(app, customer.email, 'Password123');
    const bad = 'not-a-uuid';

    const gets = [
      [`/api/review/claims/${bad}`, ms],
      [`/api/offers/${bad}`, ms],
      [`/api/admin/rules/${bad}`, ms],
      [`/api/claims/${bad}`, cs],
      [`/api/claims/${bad}/image`, cs],
    ] as const;

    for (const [path, session] of gets) {
      const res = await session.agent.get(path).set('x-csrf-token', session.csrf);
      expect(`${path} -> ${res.status} ${res.body?.error?.code}`).toBe(
        `${path} -> 400 VALIDATION_ERROR`,
      );
    }

    const patched = await ms.agent
      .patch(`/api/admin/customers/${bad}/tier`)
      .set('x-csrf-token', ms.csrf)
      .send({ tier: 'gold' });
    expect(patched.status).toBe(400);
    expect(patched.body.error.code).toBe('VALIDATION_ERROR');

    const reset = await ms.agent
      .post(`/api/admin/customers/${bad}/reset-password`)
      .set('x-csrf-token', ms.csrf)
      .send({ newPassword: 'TempPass123' });
    expect(reset.status).toBe(400);
    expect(reset.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks a customer from admin APIs', async () => {
    const customer = await createUser({ role: 'customer' });
    const s = await loginAs(app, customer.email, 'Password123');

    const res = await s.agent.get('/api/admin/ledger').set('x-csrf-token', s.csrf);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks a reviewer from managing loyalty rules', async () => {
    const reviewer = await createUser({ role: 'reviewer' });
    const s = await loginAs(app, reviewer.email, 'Password123');

    const res = await s.agent
      .post('/api/admin/rules')
      .set('x-csrf-token', s.csrf)
      .send({ name: 'nope', rules: DEFAULT_RULES, effectiveFrom: '2026-01-01' });
    expect(res.status).toBe(403);
  });

  it('stops a customer reading another customer claim (IDOR)', async () => {
    const owner = await createUser({ role: 'customer' });
    const other = await createUser({ role: 'customer' });

    const ownerSession = await loginAs(app, owner.email, 'Password123');
    const claimRes = await submitClaim(ownerSession.agent, ownerSession.csrf, {
      receiptNumber: '25-09-2026-77',
    });
    expect(claimRes.status).toBe(201);
    const claimId = claimRes.body.claim.id as string;

    const otherSession = await loginAs(app, other.email, 'Password123');
    const res = await otherSession.agent.get(`/api/claims/${claimId}`).set('x-csrf-token', otherSession.csrf);
    expect(res.status).toBe(404);

    const img = await otherSession.agent.get(`/api/claims/${claimId}/image`);
    expect(img.status).toBe(404);
  });
});

describe('claim lifecycle & points ledger', () => {
  it('never exposes a server filesystem path to the customer', async () => {
    const customer = await createUser({ role: 'customer' });
    const s = await loginAs(app, customer.email, 'Password123');

    const created = await submitClaim(s.agent, s.csrf, { receiptNumber: '25-09-2026-10' });
    expect(created.status).toBe(201);

    const list = await s.agent.get('/api/claims').set('x-csrf-token', s.csrf);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain('receiptImagePath');
    expect(raw).not.toContain('private-storage');
    expect(raw).not.toContain(process.cwd());
    expect(raw).not.toContain(process.cwd().replace(/\\/g, '/'));

    const detail = await s.agent
      .get(`/api/claims/${created.body.claim.id}`)
      .set('x-csrf-token', s.csrf);
    expect(JSON.stringify(detail.body)).not.toContain('receiptImagePath');

    const image = await s.agent.get(`/api/claims/${created.body.claim.id}/image`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
  });

  it('rejects a duplicate receipt number', async () => {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const s = await loginAs(app, customer.email, 'Password123');

    const first = await submitClaim(s.agent, s.csrf, { receiptNumber: '25-09-2026-11' });
    expect(first.status).toBe(201);

    const dup = await submitClaim(s.agent, s.csrf, { receiptNumber: '25-09-2026-11' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('RECEIPT_ALREADY_EXISTS');
  });

  it('credits exactly one PURCHASE_EARN on approval and 409s a second approval', async () => {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const reviewer = await createUser({ role: 'reviewer' });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, {
      receiptNumber: '25-09-2026-12',
      submittedAmount: 5000,
    });
    expect(claimRes.status).toBe(201);
    const claimId = claimRes.body.claim.id as string;

    const rs = await loginAs(app, reviewer.email, 'Password123');
    const approve = await rs.agent
      .post(`/api/review/claims/${claimId}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(approve.status).toBe(200);

    expect(await balanceOf(customer.id)).toBe(50);
    expect(await ledgerTypes(customer.id)).toEqual(['PURCHASE_EARN']);

    // approveClaim's pre-transaction guard reports "not pending" as 404
    const again = await rs.agent
      .post(`/api/review/claims/${claimId}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('CLAIM_NOT_FOUND');
    expect(await balanceOf(customer.id)).toBe(50);
    expect(await ledgerTypes(customer.id)).toEqual(['PURCHASE_EARN']);
  });

  it('awards no points when the claim is rejected', async () => {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const reviewer = await createUser({ role: 'reviewer' });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, { receiptNumber: '25-09-2026-13' });
    const claimId = claimRes.body.claim.id as string;

    const rs = await loginAs(app, reviewer.email, 'Password123');
    const res = await rs.agent
      .post(`/api/review/claims/${claimId}/reject`)
      .set('x-csrf-token', rs.csrf)
      .send({ rejectionReason: 'Illegible receipt' });
    expect(res.status).toBe(200);

    expect(await balanceOf(customer.id)).toBe(0);
    expect(await ledgerTypes(customer.id)).toEqual([]);
  });

  it('caps approved/eligible amounts at the submitted amount', async () => {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const reviewer = await createUser({ role: 'reviewer' });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, {
      receiptNumber: '25-09-2026-14',
      submittedAmount: 2000,
    });
    const claimId = claimRes.body.claim.id as string;

    const rs = await loginAs(app, reviewer.email, 'Password123');
    const res = await rs.agent
      .post(`/api/review/claims/${claimId}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 9000, eligibleAmount: 9000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AMOUNT');
  });
});

describe('offer eligibility and OFFER_BONUS ledger entries', () => {
  async function setup() {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer', tier: 'gold' });
    const other = await createUser({ role: 'customer', tier: 'standard' });
    const master = await createUser({ role: 'master_admin' });
    const reviewer = await createUser({ role: 'reviewer' });
    const ms = await loginAs(app, master.email, 'Password123');
    const rs = await loginAs(app, reviewer.email, 'Password123');
    return { customer, other, ms, rs };
  }

  it('splits base earn and offer bonus into separate ledger entries', async () => {
    const { customer, ms, rs } = await setup();
    await createActiveOffer(ms.agent, ms.csrf, { multiplier: 2 });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, {
      receiptNumber: '25-09-2026-20',
      submittedAmount: 5000,
      submittedArticles: ['SF-3PC-001'],
    });
    const claimId = claimRes.body.claim.id as string;

    const approve = await rs.agent
      .post(`/api/review/claims/${claimId}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(approve.status).toBe(200);

    const rows = await db('points_ledger').where('customer_id', customer.id);
    expect(rows.map((r) => r.type).sort()).toEqual(['OFFER_BONUS', 'PURCHASE_EARN']);
    const earn = rows.find((r) => r.type === 'PURCHASE_EARN');
    const bonus = rows.find((r) => r.type === 'OFFER_BONUS');
    expect(Number(earn.points)).toBe(50);
    expect(Number(bonus.points)).toBe(50);
    expect(await balanceOf(customer.id)).toBe(100);

    expect(earn.offer_snapshot).toBeNull();
    expect(bonus.offer_snapshot).toBeTruthy();

    // one recorded use of the offer, even though two ledger rows exist
    const offer = await db('offers').first();
    expect(Number(offer.current_global_uses)).toBe(1);
  });

  it('does not apply an offer restricted to non-matching article numbers', async () => {
    const { customer, ms, rs } = await setup();
    await createActiveOffer(ms.agent, ms.csrf, {
      multiplier: 2,
      eligibleArticles: ['SF-2PC-999'],
    });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, {
      receiptNumber: '25-09-2026-21',
      submittedAmount: 5000,
      submittedArticles: ['SF-3PC-001'],
    });
    const claimId = claimRes.body.claim.id as string;

    await rs.agent
      .post(`/api/review/claims/${claimId}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });

    expect(await ledgerTypes(customer.id)).toEqual(['PURCHASE_EARN']);
    expect(await balanceOf(customer.id)).toBe(50);
  });

  it('applies an offer restricted to a matching article number', async () => {
    const { customer, ms, rs } = await setup();
    await createActiveOffer(ms.agent, ms.csrf, {
      multiplier: 2,
      eligibleArticles: ['SF-3PC-001'],
    });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, {
      receiptNumber: '25-09-2026-22',
      submittedAmount: 5000,
      submittedArticles: ['SF-3PC-001'],
    });

    await rs.agent
      .post(`/api/review/claims/${claimRes.body.claim.id}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });

    expect(await ledgerTypes(customer.id)).toEqual(['OFFER_BONUS', 'PURCHASE_EARN']);
    expect(await balanceOf(customer.id)).toBe(100);
  });

  it('resolves categories through the article_categories lookup table', async () => {
    const { customer, ms, rs } = await setup();
    // seeded lookup: SF-3PC -> three-piece
    await createActiveOffer(ms.agent, ms.csrf, {
      multiplier: 2,
      eligibleCategories: ['three-piece'],
    });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, {
      receiptNumber: '25-09-2026-23',
      submittedArticles: ['SF-3PC-4242'],
    });
    await rs.agent
      .post(`/api/review/claims/${claimRes.body.claim.id}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });

    expect(await ledgerTypes(customer.id)).toEqual(['OFFER_BONUS', 'PURCHASE_EARN']);
    expect(await balanceOf(customer.id)).toBe(100);
  });

  it('honours the customer tier', async () => {
    const { customer, other, ms, rs } = await setup();
    await createActiveOffer(ms.agent, ms.csrf, { multiplier: 2, eligibleTiers: ['gold'] });

    const gold = await loginAs(app, customer.email, 'Password123');
    const goldClaim = await submitClaim(gold.agent, gold.csrf, { receiptNumber: '25-09-2026-24' });
    await rs.agent
      .post(`/api/review/claims/${goldClaim.body.claim.id}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(await balanceOf(customer.id)).toBe(100);

    const std = await loginAs(app, other.email, 'Password123');
    const stdClaim = await submitClaim(std.agent, std.csrf, { receiptNumber: '25-09-2026-25' });
    await rs.agent
      .post(`/api/review/claims/${stdClaim.body.claim.id}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(await balanceOf(other.id)).toBe(50);
  });
});

describe('reversal', () => {
  it('reverses base + bonus entries and marks the claim REVERSED', async () => {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const master = await createUser({ role: 'master_admin' });
    const reviewer = await createUser({ role: 'reviewer' });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, { receiptNumber: '25-09-2026-30' });
    const claimId = claimRes.body.claim.id as string;

    const rs = await loginAs(app, reviewer.email, 'Password123');
    await rs.agent
      .post(`/api/review/claims/${claimId}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(await balanceOf(customer.id)).toBe(50);

    // a reviewer must not be able to reverse
    const denied = await rs.agent
      .post(`/api/admin/claims/${claimId}/reverse`)
      .set('x-csrf-token', rs.csrf)
      .send({ reason: 'not allowed' });
    expect(denied.status).toBe(403);

    const ms = await loginAs(app, master.email, 'Password123');
    const res = await ms.agent
      .post(`/api/admin/claims/${claimId}/reverse`)
      .set('x-csrf-token', ms.csrf)
      .send({ reason: 'Wrong receipt, duplicate of 24-09-2026-01' });
    expect(res.status).toBe(200);
    expect(res.body.entriesReversed).toBe(1);

    expect(await balanceOf(customer.id)).toBe(0);
    expect(await ledgerTypes(customer.id)).toEqual(['CORRECTION_REVERSAL', 'PURCHASE_EARN']);

    const claim = await db('receipt_claims').where('id', claimId).first();
    expect(claim.status).toBe('REVERSED');

    const again = await ms.agent
      .post(`/api/admin/claims/${claimId}/reverse`)
      .set('x-csrf-token', ms.csrf)
      .send({ reason: 'again' });
    expect(again.status).toBe(409);
  });
});

describe('manual adjustments', () => {
  it('applies credits and debits and refuses a debit beyond the balance', async () => {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const manager = await createUser({ role: 'manager' });
    const reviewer = await createUser({ role: 'reviewer' });

    const cs = await loginAs(app, customer.email, 'Password123');
    const claimRes = await submitClaim(cs.agent, cs.csrf, { receiptNumber: '25-09-2026-40' });
    const rs = await loginAs(app, reviewer.email, 'Password123');
    await rs.agent
      .post(`/api/review/claims/${claimRes.body.claim.id}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: 5000, eligibleAmount: 5000 });
    expect(await balanceOf(customer.id)).toBe(50);

    const mgs = await loginAs(app, manager.email, 'Password123');

    const debit = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: -10, reason: 'Correction for mis-scanned receipt' });
    expect(debit.status).toBe(201);
    expect(await balanceOf(customer.id)).toBe(40);

    const credit = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: 25, reason: 'Goodwill credit' });
    expect(credit.status).toBe(201);
    expect(await balanceOf(customer.id)).toBe(65);

    const tooMuch = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: -9999, reason: 'overdraw' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(customer.id)).toBe(65);
  });

  it('is idempotent for a repeated idempotency key', async () => {
    const customer = await createUser({ role: 'customer' });
    const manager = await createUser({ role: 'manager' });
    const mgs = await loginAs(app, manager.email, 'Password123');

    const key = `it-${randomUUID()}`;
    const first = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: 100, reason: 'one', idempotencyKey: key });
    expect(first.status).toBe(201);

    const second = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: 100, reason: 'one again', idempotencyKey: key });
    expect(second.status).toBe(201);
    expect(second.body.entryId).toBe(first.body.entryId);
    expect(await balanceOf(customer.id)).toBe(100);
  });
});

describe('redemption', () => {
  async function withBalance(points: number) {
    await seedActiveRule();
    const customer = await createUser({ role: 'customer' });
    const manager = await createUser({ role: 'manager' });
    const mgs = await loginAs(app, manager.email, 'Password123');
    await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points, reason: 'test balance' });
    const cs = await loginAs(app, customer.email, 'Password123');
    return { customer, cs };
  }

  it('creates a voucher, deducts points, and refuses to reuse it', async () => {
    const { customer, cs } = await withBalance(500);

    const quote = await cs.agent
      .post('/api/redemptions/quote')
      .set('x-csrf-token', cs.csrf)
      .send({ pointsToRedeem: 200 });
    expect(quote.status).toBe(200);
    expect(quote.body.quote.discountAmount).toBe(200);

    const created = await cs.agent
      .post('/api/redemptions')
      .set('x-csrf-token', cs.csrf)
      .send({ pointsToRedeem: 200 });
    expect(created.status).toBe(201);
    const voucherId = created.body.voucher.id as string;
    const code = created.body.voucher.voucherCode as string;
    expect(await balanceOf(customer.id)).toBe(300);

    const master = await createUser({ role: 'master_admin' });
    const ms = await loginAs(app, master.email, 'Password123');
    const used = await ms.agent
      .post(`/api/redemptions/${voucherId}/use`)
      .set('x-csrf-token', ms.csrf)
      .send({ voucherCode: code });
    expect(used.status).toBe(200);

    const reuse = await ms.agent
      .post(`/api/redemptions/${voucherId}/use`)
      .set('x-csrf-token', ms.csrf)
      .send({ voucherCode: code });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_VOUCHER');
    expect(await balanceOf(customer.id)).toBe(300);
  });

  it('refuses to redeem more than the available balance', async () => {
    const { cs } = await withBalance(150);

    const res = await cs.agent
      .post('/api/redemptions')
      .set('x-csrf-token', cs.csrf)
      .send({ pointsToRedeem: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('refuses a quote below the configured minimum', async () => {
    const { cs } = await withBalance(500);
    const res = await cs.agent
      .post('/api/redemptions/quote')
      .set('x-csrf-token', cs.csrf)
      .send({ pointsToRedeem: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BELOW_MINIMUM');
  });
});

describe('article categories & tiers', () => {
  it('lets a master admin manage categories and blocks a reviewer', async () => {
    const master = await createUser({ role: 'master_admin' });
    const reviewer = await createUser({ role: 'reviewer' });
    const ms = await loginAs(app, master.email, 'Password123');
    const rs = await loginAs(app, reviewer.email, 'Password123');

    const created = await ms.agent
      .post('/api/admin/article-categories')
      .set('x-csrf-token', ms.csrf)
      .send({ category: 'formal', articlePrefix: 'SF-FORM', description: 'Formal wear' });
    expect(created.status).toBe(201);
    const id = created.body.category.id as string;

    const duplicate = await ms.agent
      .post('/api/admin/article-categories')
      .set('x-csrf-token', ms.csrf)
      .send({ category: 'other', articlePrefix: 'SF-FORM' });
    expect(duplicate.status).toBe(409);

    const denied = await rs.agent
      .post('/api/admin/article-categories')
      .set('x-csrf-token', rs.csrf)
      .send({ category: 'x', articlePrefix: 'SF-X' });
    expect(denied.status).toBe(403);

    const list = await rs.agent.get('/api/admin/article-categories').set('x-csrf-token', rs.csrf);
    expect(list.status).toBe(200);
    const listed = list.body.categories as Array<{ id: string }>;
    expect(listed.some((c) => c.id === id)).toBe(true);

    const removed = await ms.agent.delete(`/api/admin/article-categories/${id}`).set('x-csrf-token', ms.csrf);
    expect(removed.status).toBe(200);
  });

  it('updates a customer tier and audits the change', async () => {
    const customer = await createUser({ role: 'customer', tier: 'standard' });
    const manager = await createUser({ role: 'manager' });
    const mgs = await loginAs(app, manager.email, 'Password123');

    const res = await mgs.agent
      .patch(`/api/admin/customers/${customer.id}/tier`)
      .set('x-csrf-token', mgs.csrf)
      .send({ tier: 'Gold' });
    expect(res.status).toBe(200);

    const profile = await db('customer_profiles').where('user_id', customer.id).first();
    expect(profile.tier).toBe('gold');

    const audit = await db('audit_logs').where('action', 'CUSTOMER_TIER_CHANGED').first();
    expect(audit).toBeTruthy();
  });
});

describe('point expiry', () => {
  async function earn(
    receiptNumber: string,
    opts: { pointExpiryDays?: number | null; submittedAmount?: number } = {},
  ) {
    await seedActiveRule({ pointExpiryDays: opts.pointExpiryDays === undefined ? 30 : opts.pointExpiryDays });
    const amount = opts.submittedAmount ?? 5000;
    const customer = await createUser({ role: 'customer' });
    const reviewer = await createUser({ role: 'reviewer' });

    const cs = await loginAs(app, customer.email, 'Password123');
    const created = await submitClaim(cs.agent, cs.csrf, { receiptNumber, submittedAmount: amount });
    expect(created.status).toBe(201);

    const rs = await loginAs(app, reviewer.email, 'Password123');
    const approve = await rs.agent
      .post(`/api/review/claims/${created.body.claim.id}/approve`)
      .set('x-csrf-token', rs.csrf)
      .send({ approvedAmount: amount, eligibleAmount: amount });
    expect(approve.status).toBe(200);

    return { customer, claimId: created.body.claim.id as string };
  }

  const agePastWindow = async (customerId: string) => {
    await db('points_ledger')
      .where('customer_id', customerId)
      .where('points', '>', 0)
      .update({ expires_at: new Date(Date.now() - 60 * 1000) });
  };

  it('stamps expires_at on credits when the rule expires points', async () => {
    const { customer } = await earn('25-09-2026-60', { pointExpiryDays: 30 });

    const row = await db('points_ledger').where('customer_id', customer.id).first();
    const daysAway = (new Date(row.expires_at).getTime() - Date.now()) / 86400000;
    expect(daysAway).toBeGreaterThan(29);
    expect(daysAway).toBeLessThanOrEqual(31);
    expect(row.expired_at).toBeNull();
    expect(Number(row.expired_points)).toBe(0);
  });

  it('leaves expires_at null when the rule never expires points', async () => {
    const { customer } = await earn('25-09-2026-61', { pointExpiryDays: null });

    const row = await db('points_ledger').where('customer_id', customer.id).first();
    expect(row.expires_at).toBeNull();
    expect(await PointsEngineService.expireDuePoints('test')).toBe(0);
    expect(await balanceOf(customer.id)).toBe(50);
  });

  it('does nothing while the credit is still inside its window', async () => {
    const { customer } = await earn('25-09-2026-62', { pointExpiryDays: 30 });

    expect(await PointsEngineService.expireDuePoints('test')).toBe(0);
    expect(await balanceOf(customer.id)).toBe(50);
    expect(await ledgerTypes(customer.id)).toEqual(['PURCHASE_EARN']);
  });

  it('turns an overdue credit into a negative EXPIRY entry and drops the balance', async () => {
    const { customer } = await earn('25-09-2026-63', { pointExpiryDays: 30 });
    expect(await balanceOf(customer.id)).toBe(50);

    await agePastWindow(customer.id);
    expect(await PointsEngineService.expireDuePoints('test')).toBe(1);

    expect(await balanceOf(customer.id)).toBe(0);
    expect(await ledgerTypes(customer.id)).toEqual(['EXPIRY', 'PURCHASE_EARN']);

    const expiry = await db('points_ledger')
      .where('customer_id', customer.id)
      .where('type', 'EXPIRY')
      .first();
    expect(Number(expiry.points)).toBe(-50);
    expect(expiry.reversal_reference).toBeTruthy();

    // idempotent: a second run must not double-expire
    expect(await PointsEngineService.expireDuePoints('test')).toBe(0);
    expect(await balanceOf(customer.id)).toBe(0);
  });

  it('refuses to redeem points that have already expired', async () => {
    const { customer } = await earn('25-09-2026-64', {
      pointExpiryDays: 30,
      submittedAmount: 20000,
    });
    expect(await balanceOf(customer.id)).toBe(200);

    await agePastWindow(customer.id);
    await PointsEngineService.expireDuePoints('test');
    expect(await balanceOf(customer.id)).toBe(0);

    const cs = await loginAs(app, customer.email, 'Password123');
    const quote = await cs.agent
      .post('/api/redemptions/quote')
      .set('x-csrf-token', cs.csrf)
      .send({ pointsToRedeem: 150 });
    expect(quote.status).toBe(400);
    expect(quote.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('never drives the balance negative when expired points were already redeemed', async () => {
    const { customer, cs } = await (async () => {
      const earned = await earn('25-09-2026-65', {
        pointExpiryDays: 30,
        submittedAmount: 20000,
      });
      const session = await loginAs(app, earned.customer.email, 'Password123');
      return { ...earned, cs: session };
    })();

    const voucher = await cs.agent
      .post('/api/redemptions')
      .set('x-csrf-token', cs.csrf)
      .send({ pointsToRedeem: 150 });
    expect(voucher.status).toBe(201);
    expect(await balanceOf(customer.id)).toBe(50);

    // 150 of the 200 were already spent, so only the remaining 50 may expire
    await agePastWindow(customer.id);
    expect(await PointsEngineService.expireDuePoints('test')).toBe(1);

    expect(await balanceOf(customer.id)).toBe(0);
    expect(await ledgerTypes(customer.id)).toEqual(['EXPIRY', 'PURCHASE_EARN', 'REDEMPTION']);
  });

  it('reverses only the remainder still outstanding after expiry', async () => {
    const { customer, claimId } = await earn('25-09-2026-66', { pointExpiryDays: 30 });
    await agePastWindow(customer.id);
    await PointsEngineService.expireDuePoints('test');
    expect(await balanceOf(customer.id)).toBe(0);

    const manager = await createUser({ role: 'manager' });
    const mgs = await loginAs(app, manager.email, 'Password123');
    const res = await mgs.agent
      .post(`/api/admin/claims/${claimId}/reverse`)
      .set('x-csrf-token', mgs.csrf)
      .send({ reason: 'Receipt was fraudulent' });
    expect(res.status).toBe(200);
    expect(res.body.entriesReversed).toBe(0);

    expect(await balanceOf(customer.id)).toBe(0);
    expect(await ledgerTypes(customer.id)).toEqual(['EXPIRY', 'PURCHASE_EARN']);
  });

  it('stamps expiry on manual credits but not on manual debits', async () => {
    await seedActiveRule({ pointExpiryDays: 45 });
    const customer = await createUser({ role: 'customer' });
    const manager = await createUser({ role: 'manager' });
    const mgs = await loginAs(app, manager.email, 'Password123');

    const credit = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: 100, reason: 'Goodwill credit' });
    expect(credit.status).toBe(201);

    const debit = await mgs.agent
      .post('/api/admin/adjustments')
      .set('x-csrf-token', mgs.csrf)
      .send({ customerId: customer.id, points: -40, reason: 'Correction' });
    expect(debit.status).toBe(201);

    const creditRow = await db('points_ledger')
      .where('customer_id', customer.id)
      .where('type', 'MANUAL_CREDIT')
      .first();
    const debitRow = await db('points_ledger')
      .where('customer_id', customer.id)
      .where('type', 'MANUAL_DEBIT')
      .first();

    const daysAway = (new Date(creditRow.expires_at).getTime() - Date.now()) / 86400000;
    expect(daysAway).toBeGreaterThan(44);
    expect(debitRow.expires_at).toBeNull();
    expect(await balanceOf(customer.id)).toBe(60);
  });
});

describe('page rendering', () => {
  it('renders every customer page', async () => {
    const customer = await createUser({ role: 'customer' });
    const cs = await loginAs(app, customer.email, 'Password123');

    const paths = [
      '/',
      '/dashboard',
      '/claims',
      '/claims/new',
      '/points',
      '/redemptions',
      '/offers',
      '/profile',
    ];
    for (const path of paths) {
      const res = await cs.agent.get(path);
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`);
      expect(res.text).not.toContain('Failed to lookup');
    }
  });

  it('renders every admin page', async () => {
    const manager = await createUser({ role: 'manager' });
    const ms = await loginAs(app, manager.email, 'Password123');

    const paths = [
      '/admin',
      '/admin/review',
      '/admin/users',
      '/admin/customers',
      '/admin/rules',
      '/admin/offers',
      '/admin/ledger',
      '/admin/audit',
      '/admin/profile',
    ];
    for (const path of paths) {
      const res = await ms.agent.get(path);
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`);
    }
  });
});
