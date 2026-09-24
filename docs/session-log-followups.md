# Session Log — Remaining Audit Follow-ups

**Date:** 2026-09-24
**Status:** COMPLETED

Completed all follow-ups from `docs/session-log-audit-fixes.md` (lines 98–106).

## 1. Full CSRF tokens (synchronizer token)

- New `src/middleware/csrf.ts`:
  - `issueCsrfToken` — 32-byte hex token on session
  - `originCheck` — existing Origin middleware (extracted, still first line)
  - `ensureCsrfToken` — issues token if missing, exposes `res.locals.csrfToken`
  - `verifyCsrfToken` — timing-safe check of `X-CSRF-Token` header or `_csrf` body on state-changing methods
- Session type: `csrfToken` added (`src/types/session.d.ts`)
- Pipeline order in `src/server.ts`: Origin check → body parsers → session → `loadSessionUser` → ensure → verify
- `views/layout.ejs`: `<meta name="csrf-token">`
- `public/js/app.js`: `API.request` attaches `X-CSRF-Token` on non-GET; `getCsrfToken`/`setCsrfToken` helpers
- Login/register re-issue token after `session.regenerate` and return `csrfToken` in JSON; auth pages update meta before redirect

## 2. DB migration: indexes / CHECK / FKs

- New `migrations/20260924000001_indexes_checks_fks.ts`
- **Indexes (both SQLite + MySQL):** users, receipt_claims, points_ledger, redemption_vouchers (incl. `expires_at`), audit_logs, offers (active window + priority), notifications, contact_verifications, password_reset_tokens
- **MySQL only — FKs:** `points_ledger.voucher_id` → vouchers, `redemption_vouchers.used_by` → users, `points_ledger.reversal_reference` → points_ledger
- **MySQL only — CHECKs:** role/status enums, claim status/amounts, ledger type + non-zero points, voucher status/points, offer type + use counts
- **SQLite:** indexes only — cannot `ALTER TABLE ADD CONSTRAINT`, and `PRAGMA foreign_keys` is a no-op inside Knex migration transactions (app-layer validation remains)

## 3. Voucher-expiry scheduler

- `RedemptionService.expireDueVouchers()` — batch-flips `ACTIVE` → `EXPIRED` past `expires_at`, restores points as ledger type `EXPIRY` (idempotency `expiry-<id>`), writes `VOUCHER_EXPIRED` audit
- `src/jobs/voucherExpiry.ts` — hourly `setInterval` + immediate first run; started/stopped in server lifecycle
- Lazy expiry in `useVoucher` kept as race fallback

## 4. Offer bonus in points engine

- `PointsEngineService.calculatePoints(amount, { ruleId?, customerId? })` now evaluates active offers:
  - Conditions: `minimumPurchaseAmount`, plus bonus fields `multiplier` / `bonusPoints` / `bonusPercentage` in `conditions_json`
  - Types: `multiplier`, `fixed_bonus`, `percentage_bonus`, birthday/referral/coupon (use `bonusPoints`)
  - Stackable/priority selection; per-customer usage + global max uses
  - Total capped by `maxPointsPerClaim`
- `OfferService.checkOfferUsage` made portable (no MySQL `JSON_EXTRACT`); accepts `client` for transactions
- `OfferService.recordOfferUse` increments `current_global_uses` with global-max guard
- `ReviewService.approveClaim`: passes `customerId`, writes `receipt_claims.offer_snapshot`, records offer uses in the approval transaction
- Offers API zod schema accepts the new condition fields

## 5. Seed script configurable identity

- `scripts/seed-admin.js` now reads:
  - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_MOBILE`, `SEED_ADMIN_NAME`, `SEED_ADMIN_DEPARTMENT`, `SEED_ADMIN_DB_PATH`
- Defaults preserved for local dev; production still requires `SEED_ADMIN_PASSWORD`
- `.env.example` documents the new vars
- npm script: `seed:admin`

## 6. Security unit-test rewrite

- Replaced pseudo-tests (inline `replace()`, tautological env check) with real coverage of:
  - CSRF issue/match/ensure/verify (header + body + safe methods)
  - Origin check (allow missing/same, reject evil/unparseable)
  - RBAC: `authorize`, `authorizeAdmin`, `authorizeCustomer`
  - AppError shape
  - Real zod schemas vs SQLi-like / weak-password / bad-amount payloads
  - Password + token crypto (kept)

## 7. sharp image re-encoding

- New `src/utils/imageSanitizer.ts` — re-encodes JPEG/PNG via sharp (strips EXIF/metadata), PDF passthrough, removes file + throws `INVALID_IMAGE` on corrupt input
- Called after multer on claim create + resubmit (`src/routes/claims.ts`)

## Files changed/created

```
src/middleware/csrf.ts                 (new)
src/jobs/voucherExpiry.ts              (new)
src/utils/imageSanitizer.ts            (new)
migrations/20260924000001_indexes_checks_fks.ts (new)
src/server.ts, src/types/session.d.ts, src/routes/auth.ts
src/routes/claims.ts, src/routes/offers.ts
src/services/{PointsEngine,Offer,Review,Redemption}Service.ts
public/js/app.js, views/layout.ejs, views/auth/{login,register}.ejs
scripts/seed-admin.js, .env.example, package.json
src/__tests__/security.test.ts         (rewritten)
```

## Verification

- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 errors**
- `npm test`: **68/68 pass**
- `npm run migrate`: Batch 2 ran `20260924000001_indexes_checks_fks` OK

## Follow-ups (new / still open)

- Full double-submit cookie alternative not needed (synchronizer token done)
- SQLite still lacks DB-level CHECK/FK (MySQL prod has them)
- Offer `eligibleArticles` / `eligibleCategories` / `eligibleTiers` not yet evaluated at approval (only min purchase + bonus math)
- OFFER_BONUS ledger type unused (bonus is folded into PURCHASE_EARN total + offer_snapshot)
- Security integration tests (supertest against `app`) still not added
- Seed script still SQLite-path based (not Knex/MySQL)

## Safest next step

Hard-refresh any open tab, login again (new CSRF meta), then smoke-test: create claim, approve with an active multiplier offer, cancel/expire a voucher, upload a JPEG receipt and confirm EXIF is stripped.
