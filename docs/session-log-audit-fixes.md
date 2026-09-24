# Session Log - Audit Fixes (XSS, Security, Admin Wiring)

**Date:** 2026-09-24
**Status:** COMPLETED (core fixes + verification)

## What was implemented

### 1. Stored XSS hardening (C1)

- Added global `esc()` HTML-escape helper in `public/js/app.js`
- Escaped all user/admin-controlled interpolations in template literals across admin and customer views (`dashboard`, `review-queue`, `review-detail`, `customers`, `users`, `ledger`, `audit`, `offers`, `rules`, `claims`, `points`, `redemptions`, `offers`)
- `statusBadge` now escapes its label text
- Logout button wrapped in try/catch so a failed API call still redirects

### 2. Session / auth security (C2, H1, H2, M2 partial)

- **SESSION_SECRET:** required in production (min 32 chars, rejects placeholder values); dev keeps a default (`src/config/index.ts`)
- **Session fixation:** `req.session.regenerate()` on login and register before setting `userId` (`src/routes/auth.ts`)
- **Stale session role/status:** `authenticate` now re-validates the user from DB on every request and rejects non-active accounts (`src/middleware/auth.ts`)
- **Auth rate limit:** stricter limiter (20 / 15 min) on login, register, forgot/reset password, verify-contact
- **trust proxy:** set to `1` for correct client IPs / secure cookies behind reverse proxy

### 3. CSRF Origin check (M1 partial)

- Lightweight middleware: rejects state-changing requests when `Origin` is present and does not match `APP_URL` (`src/server.ts`)

### 4. Double-spend / status guards (C3, H4, H9, H10)

- **Voucher create:** balance re-checked inside transaction via `SUM(points)` on `points_ledger`; inserts `VOUCHER_CREATED` audit; checks ledger insert result
- **Voucher use:** UPDATE now `.where('status','ACTIVE')`; throws `VOUCHER_NOT_ACTIVE` (409) if already used/cancelled
- **Voucher cancel:** same status guard + `VOUCHER_CANCELLED` audit + existing `CORRECTION_REVERSAL` ledger restore
- **Approve/reject/request-image:** status-guarded UPDATEs (`.where('status','PENDING_REVIEW')`); 409 if not pending
- **Approve bounds:** `approvedAmount` / `eligibleAmount` must be ≤ `submittedAmount`

### 5. Token / mail logging (H3)

- Production no longer falls through to logging full email bodies (tokens) on SMTP failure or unconfigured SMTP — returns `{delivered:false, mode:'log'}` with metadata only
- Full-text email log + console block is dev-only
- Removed `link` (contains token) from verification-sent log in `AuthService`

### 6. Upload validation (H8)

- Extension allowlist (`.jpg/.jpeg/.png/.pdf`) must match MIME; mismatch rejected
- Stored filename uses allowlisted extension only

### 7. Infra / config (H5, H6, H7)

- **knexfile:** removed `ssl: { rejectUnauthorized: false }`; optional `DATABASE_SSL_CA` / `DATABASE_SSL=true` enables verified TLS
- **seed-admin:** production requires `SEED_ADMIN_PASSWORD` (min 8); no longer prints password; dev default only when env unset
- **purchase_date:** stored as `YYYY-MM-DD` string (matches VARCHAR(10) column); invalid dates rejected

### 8. Reporting — REQUEST_CLEARER_IMAGE not invisible (H-adjacent)

- Dashboard/reports and customer-history `pendingClaims` now count `PENDING_REVIEW` **and** `REQUEST_CLEARER_IMAGE`

### 9. Admin Offers camelCase bug (audit #5)

- `views/admin/offers.ejs` now uses serialized camelCase fields (`offerType`, `isActive`, `startDate`, `endDate`, `currentGlobalUses`, `globalMaxUses`, `maxUsesPerCustomer`)

### 10. Unreachable backend features wired to UI

- **Rules edit:** inactive rules get Edit button; form mode state; `GET /api/admin/rules/:id` + `PATCH /api/admin/rules/:id`; header/submit label swap
- **Claim resubmit:** customer claims list Resubmit for `REQUEST_CLEARER_IMAGE`; upload via `API.upload(POST /api/claims/:id/resubmit)`; backend validates schema and discards orphan files on failure
- **Voucher cancel:** customer redemptions Cancel for `ACTIVE` vouchers with confirm + points restore
- **Notifications mark-read:** individual `PATCH /api/claims/notifications/:id/read` and mark-all `POST .../read-all`; unread dimming

### 11. Review approve UX

- Enter no longer auto-approves (requires explicit submitter + confirm for approve)
- Client-side check: approved/eligible ≤ submitted amount

### 12. Tooling

- `package.json` lint script fixed for Windows (`eslint "src/**/*.ts" --fix` — single quotes were passed literally)

## Files changed (high level)

```
public/js/app.js
views/admin/*.ejs, views/customer/*.ejs
src/config/index.ts, src/config/knexfile.ts
src/middleware/auth.ts, src/middleware/upload.ts
src/routes/auth.ts, src/routes/claims.ts
src/services/{MailService,AuthService,ClaimService,ReviewService,RedemptionService,ReportsService}.ts
scripts/seed-admin.js
package.json
```

## Verification

- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 errors**, 44 pre-existing warnings (no-console / no-explicit-any)
- `npm test`: **45/45 pass**
- Rule form field IDs (`ruleName`, `effectiveFrom`, `currencyThreshold`, …, `createSubmitBtn`, `cancelCreateBtn`) confirmed present in `views/admin/rules.ejs`
- Rules API returns raw snake_case rows + parsed `rules` — view uses `is_active` / `effective_from` (correct)
- Offers API serializes camelCase — view uses camelCase (correct)

## Not done in this pass (follow-ups)

- Full CSRF tokens (Origin check only)
- DB indexes / CHECK constraints / missing FKs migrations
- Voucher-expiry scheduler
- Offer bonus application in points engine (backend offers apply API still not called at claim time)
- Seed script still uses fixed email `admin@starfashion.com` (password now from env)
- Security unit-test rewrite
- `sharp` present in deps but unused for image re-encoding

## Safest next step

Hard-refresh admin Offers and customer Claims/Dashboard/Redemptions pages, then smoke-test: rule edit on an inactive rule, claim resubmit after request-image, voucher cancel, notification mark-read.
