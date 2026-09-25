# Testing Guide

## Test Commands

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run integration tests
npm run test:integration

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- src/__tests__/auth.test.ts
```

## Test Structure

### Unit Tests
- `src/__tests__/crypto.test.ts` - Password hashing, tokens
- `src/__tests__/validators.test.ts` - Input validation
- `src/__tests__/errorHandler.test.ts` - Error handling
- `src/__tests__/auth.test.ts` - Authentication logic
- `src/__tests__/claim.test.ts` - Claim processing
- `src/__tests__/security.test.ts` - Security controls

### Integration Tests
- `src/__tests__/api.integration.test.ts` - HTTP tests against the real Express app (supertest)

Coverage, all driven through the public API:

- **CSRF** – missing token → `403 CSRF_INVALID`; foreign `Origin` → `403 CSRF_ORIGIN`
- **Auth** – register/login/logout, generic `401 INVALID_CREDENTIALS` on a bad password
- **Authorization / IDOR** – anonymous → `401`, customer → admin routes `403`, reviewer →
  master-admin-only routes `403`, customer B → customer A's claim/image `404`, and a
  non-UUID `:id` on any detail route → `400 VALIDATION_ERROR`
- **Path leak** – claim JSON contains `imageAvailable` and never `receiptImagePath` or a
  filesystem path
- **Claim lifecycle** – duplicate receipt → `409 RECEIPT_ALREADY_EXISTS`, approval credits
  exactly one `PURCHASE_EARN`, rejection credits nothing, approved/eligible capped at
  submitted amount
- **Offer eligibility** – `OFFER_BONUS` split from `PURCHASE_EARN`; ineligible by article
  number / category / tier → no bonus; `article_categories` prefix lookup resolves
  categories; one recorded offer use per claim
- **Reversal** – reviewer blocked (`403`), manager reverses to `CORRECTION_REVERSAL`,
  claim → `REVERSED`, second reversal → `409`
- **Manual adjustments** – credit/debit, `400 INSUFFICIENT_BALANCE`, idempotency key reuse
- **Redemption** – quote, voucher creation, single use, reuse → `400 INVALID_VOUCHER`,
  overdraft → `400 INSUFFICIENT_BALANCE`, below minimum → `400 BELOW_MINIMUM`
- **Password change** – wrong current password → `401 INVALID_PASSWORD`, weak new password →
  `400 VALIDATION_ERROR`, successful change invalidates the old password (customer and admin),
  profile pages render only for their own role
- **Password security** – a self-change keeps the caller's session and kills every other one
  (`GET /api/auth/me` → `401`); an emailed reset link signs the account out everywhere;
  a manager resets a customer's password (old password → `401`, audit
  `PASSWORD_RESET_BY_ADMIN`, manager's own session survives) while a reviewer or customer
  gets `403` and an unknown id `404`
- **Point expiry** – `expires_at` stamped from `pointExpiryDays`, left `NULL` when the rule
  disables expiry, overdue credits become a negative `EXPIRY` entry (balance drops, second
  run is a no-op), expired points refuse redemption with `400 INSUFFICIENT_BALANCE`, an
  already-redeemed credit cannot drive the balance negative, reversal after expiry unwinds
  only the remainder, manual credits expire but debits do not
- **Article categories & tiers** – CRUD + `409 PREFIX_ALREADY_EXISTS`, RBAC, tier change
  writes `CUSTOMER_TIER_CHANGED` audit
- **Page rendering** – every customer page (`/`, `/dashboard`, `/claims`, `/claims/new`,
  `/points`, `/redemptions`, `/offers`, `/profile`) and every admin page
  (`/admin`, `/review`, `/users`, `/customers`, `/rules`, `/offers`, `/ledger`, `/audit`,
  `/profile`) returns `200` for the matching role

#### Test harness
- `src/test-utils/integration.ts` exports `createTestApp`, `resetDb`, `createUser`,
  `freshSession`, `loginAs`, `submitClaim`, `seedActiveRule`, `balanceOf`, `ledgerTypes`.
- The app is built once per suite via `createApp()` (see `src/app.ts`); `resetDb()` wipes
  every table children-first (FK pragma is ON for the test DB) and restores the seeded
  `article_categories` rows that migrations only insert once.
- Each test gets a fresh supertest agent; the CSRF token is read from the
  `<meta name="csrf-token">` tag on `GET /login`.
- `jest.setup.js` runs before every test file and raises `RATE_LIMIT_MAX` /
  `AUTH_RATE_LIMIT_MAX` (dotenv will not override values already in `process.env`).
- Unit tests and integration tests are split: `npm test` ignores `*.integration.test.ts`,
  `npm run test:integration` runs only those.

## Writing Tests

### Unit Test Example
```typescript
describe('Feature', () => {
  it('should do something', () => {
    const result = doSomething(input);
    expect(result).toBe(expected);
  });
});
```

### Integration Test Example
```typescript
describe('API Endpoint', () => {
  it('should handle request', async () => {
    const response = await request(app)
      .post('/api/endpoint')
      .send(data)
      .expect(200);
    
    expect(response.body).toHaveProperty('id');
  });
});
```

## Coverage Requirements

- Statements: 80%
- Branches: 75%
- Functions: 80%
- Lines: 80%

## Acceptance Tests

### Manual Testing Checklist
1. Customer registration
2. Email verification
3. Receipt upload
4. Admin review
5. Points crediting
6. Redemption request
7. Voucher usage
8. Password reset
9. Profile update
10. Mobile responsiveness
