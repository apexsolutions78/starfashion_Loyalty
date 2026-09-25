# Session Log — Eligibility, P0 Fixes, Tests, Password Hardening, Point Expiry

**Date:** 2026-09-25
**Status:** COMPLETED (manual smoke test outstanding — see "Safest next step")

Closes every open follow-up from `docs/session-log-followups.md` (lines 94–99), the four P0
items surfaced by the code audit, and the follow-ups this log itself raised in §6–§7.

| § | Work | State |
| --- | --- | --- |
| 1–2 | Offer eligibility at approval, `article_categories` + customer tier | done |
| 3 | P0 fixes (path leak, own receipt view, reversal, manual adjustment) | done |
| 4 | Split `PURCHASE_EARN` / `OFFER_BONUS` ledger | done |
| 5 | Portability fixes (`.returning()`, `.forUpdate()`, `createApp()`, test env) | done |
| 6 | Supertest integration/security suite | done |
| 7 | Self-service password change UI | done |
| 8 | Session invalidation + audit, admin password reset, `uuidSchema`, point expiry | done |

---

## RESUME HERE

**Last updated:** 2026-09-25, end of session.

**State of the work**
- All 8 sections above are implemented, not just planned.
- Nothing is committed to git yet — everything is sitting as working-tree changes
  (see "Files changed/created"). Committing is the only thing standing between you and
  losing this work.
- Migrations applied to `data/loyalty.db`: batch 4 (`20260925000001`,
  `20260926000001`). The test DB migrates itself on every run.

**Re-verify state from a fresh shell**
```bash
npm run typecheck      # expect 0 errors
npm run lint           # expect 0 errors, 58 warnings
npm test               # expect 68/68
npm run test:integration   # expect 50/50 (~2 min)
```
Any other number means the tree is not where this log left it.

**Open work (nothing is half-finished)**
1. Manual browser smoke test — steps in "Safest next step" below. This is the only
   item in §1–§8 that has not been executed.
2. Backlog items in "Follow-ups" — none of them were started.

**Gotchas for next time**
- `npm run dev` needs no migrate/seed step; the dev DB is already migrated.
- Tests: `npm test` deliberately ignores `*.integration.test.ts`.
- Test rate limits are raised by `jest.setup.js`; do not lower them back.
- Restart/rely on `ts-node-dev` for route changes; EJS views are re-read per request.

---

## 1. Offer eligibility at approval

- New `src/services/OfferEligibilityService.ts`:
  - `resolveArticleCategories(articles, client)` — prefix match against the
    `article_categories` lookup table (`article === prefix || article.startsWith(prefix)`,
    case-insensitive)
  - `getCustomerTier(customerId, client)` — lowercased `customer_profiles.tier`
  - `buildEligibilityContext(customerId, articles, client)` — `{ customerId, articles,
    categories, tier }`
  - `isOfferEligible(offer, ctx)` — **strict**: any declared constraint
    (`eligibleArticles` / `eligibleCategories` / `eligibleTiers`) with no matching claim
    data ⇒ offer does not apply
- `PointsEngineService.evaluateOffers` now takes `articles`, builds the context once and
  filters with `isOfferEligible`
- `ReviewService.approveClaim` parses `receipt_claims.submitted_articles`
  (exported helper `parseSubmittedArticles`) and passes it to `calculatePoints`

## 2. Full article-category lookup table + customer tier

- New `migrations/20260925000001_article_categories_and_tier.ts`
  - `article_categories(id, category, article_prefix UNIQUE, description, created_by, …)`
  - `customer_profiles.tier` `NOT NULL DEFAULT 'standard'`
  - Seeds `SF-3PC → three-piece`, `SF-2PC → two-piece`, `SF-STCH → stitched`,
    `SF-UNST → unstitched`
- New `src/services/ArticleCategoryService.ts` — `list` (reviewer+), `create` / `update` /
  `remove` / `setCustomerTier` (master_admin for mutations, manager+ for tier); audits
  `ARTICLE_CATEGORY_CREATED/UPDATED/DELETED`, `CUSTOMER_TIER_CHANGED`
- `src/routes/admin.ts` — `GET/POST/PATCH/DELETE /api/admin/article-categories`,
  `PATCH /api/admin/customers/:id/tier`; `/api/admin/customers` now returns `tier`

## 3. P0 fixes

| P0 | Fix |
| --- | --- |
| Receipt image path leaked to customers | `serializeClaim` emits `imageAvailable` instead of `receiptImagePath` (src/utils/serialize.ts:44) |
| No way for a customer to view their own receipt | `GET /api/claims/:id/image` with ownership check (src/routes/claims.ts:161) |
| Approved claims could not be reversed | `ReviewService.reverseClaim` + `POST /api/admin/claims/:id/reverse` (manager/master_admin) |
| No manual correction path | `PointsEngineService.applyManualAdjustment` + `POST /api/admin/adjustments` (manager/master_admin, optional `idempotencyKey`) |

Also added (audit follow-through):

- `GET /api/admin/review/claims?status=` — validated against `CLAIM_STATUSES`
- `src/services/ClaimService.getOwnedImagePath` + `resubmitClaim` unlinks the old file
- Review queue/detail views: status filter, claim status badge, reverse card
- Ledger view: new badges/filters for `OFFER_BONUS`, `MANUAL_CREDIT`, `MANUAL_DEBIT`,
  `EXPIRY`, plus a manual-adjustment form

## 4. Split `PURCHASE_EARN` / `OFFER_BONUS` ledger

- `creditPoints(customerId, claimId, basePoints, offerBonus, ruleSnapshot, appliedOffers,
  createdBy, requestId, client)` writes two entries:
  - `PURCHASE_EARN`, idempotency `claim-<id>`, `rule_snapshot` only
  - `OFFER_BONUS`, idempotency `claim-bonus-<id>`, sole holder of `offer_snapshot` so
    `OfferService.checkOfferUsage` counts exactly one use per claim
- `reversePoints(claimId, …, client)` reverses **both** (`reversal-<id>` /
  `reversal-bonus-<id>`), returns the count, guards `ALREADY_REVERSED`
- `recordOfferUse` is called per applied offer inside the approval transaction

## 5. Portability / correctness fixes

- **`.returning()` removed everywhere.** knex's mysql2 compiler no-ops `.returning()`
  (`mysql-querycompiler.js` `_returningCheck`) and `db()` returned `[insertId]`. Every
  insert now does `newId()` + re-select: `ArticleCategoryService`, `ClaimService`,
  `OfferService`, `PointsEngineService`, `RedemptionService`, `RuleService`,
  `scripts/seed-admin.js`.
- **`.forUpdate()` used unconditionally** for claim approval, claim reversal and voucher
  creation — knex emits `for update` on mysql2 and strips it on better-sqlite3 (verified
  via `toSQL()`), so it is a no-op on SQLite and correct on MySQL.
- `src/app.ts` extracted (`createApp()`); `src/server.ts` only listens/shuts down.
- `knex` moved to `dependencies`; `ts-node` added (prod loads `.ts` migrations).
- `src/config/knexfile.ts` — new `test` environment → `data/test-loyalty.db` with
  `foreign_keys = ON` via `pool.afterCreate`.
- `src/middleware/csrf.ts` — `originCheck` 403 body now includes `requestId`.
- `AUTH_RATE_LIMIT_MAX` added to env schema (default 20) and used by the auth limiter —
  the hardcoded `max: 20` would have throttled any HTTP test suite.
- Admin views: `offers.ejs` (full condition editor + category management),
  `customers.ejs` (tier column), `ledger.ejs`, `review-queue.ejs`, `review-detail.ejs`.

## 6. Integration / security test suite (supertest)

- `src/test-utils/integration.ts` (new): `createTestApp`, `resetDb`, `createUser`,
  `freshSession`, `loginAs`, `submitClaim`, `seedActiveRule`, `balanceOf`, `ledgerTypes`
  - `resetDb()` deletes children-first with `hasTable` guards and **re-seeds
    `article_categories`** (migrations only seed once)
  - `loginAs` bootstraps a session from the `<meta name="csrf-token">` on `GET /login` and
    returns the post-login `csrfToken` (sessions are regenerated on login)
- `src/__tests__/api.integration.test.ts` (new) — started at 29 tests covering CSRF
  (missing token, foreign Origin), auth, RBAC, IDOR, path-leak, duplicate receipt,
  approve/reject, offer eligibility + `OFFER_BONUS`, reversal, adjustments, redemption,
  article categories, tiers; §7 and §8 took it to 50
- `jest.setup.js` (new) — raises `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX`, silences the
  winston console transport
- Config split: `npm test` ignores `*.integration.test.ts`; `npm run test:integration` runs
  only those
- `tsconfig.json` still excludes `**/*.test.ts`, so `tsc --noEmit` does not type-check tests
  — `npm run typecheck` now chains `tsc -p tsconfig.test.json` (added in §7) to cover them

## 7. Self-service password change UI

The API (`POST /api/auth/change-password`) already existed but nothing linked to it, so
neither role could change a password from the UI.

- New `views/partials/change-password.ejs` — shared card (current / new / confirm), client
  side checks for mismatch and "same as current", posts to the existing endpoint
- New `views/customer/profile.ejs` and `views/admin/profile.ejs` — account details from
  `GET /api/auth/me` plus the shared form
- New routes `GET /profile` (`authorizeCustomer`) and `GET /admin/profile`
  (`authorizeAdmin('reviewer','manager','master_admin')`)
- Nav: `Profile` link added to `views/partials/customer-header.ejs` and
  `views/partials/admin-header.ejs`
- Initially left out (then picked up and built in §8): admin resetting *another* user's
  password, and audit log / session invalidation on password change

## 8. Hardening pass: sessions, admin reset, id validation, point expiry

Worked through the remaining follow-ups plus the stray file in one pass.

### 8.1 Session invalidation + audit on every password change
- `src/services/SessionService.ts` (new) — `invalidateUserSessions(userId, keepSid?)`
  sweeps `sessions` with `CAST(sess AS CHAR) LIKE '%"userId":"<uuid>"%'` (the store keeps
  whole sessions as JSON with no `user_id` column; the cast keeps it portable)
- `changePassword` now updates the password and writes `PASSWORD_CHANGED` in one
  transaction, then signs out every session **except the caller's**
- `resetPassword` writes `PASSWORD_RESET` and signs out **every** session
- Routes pass `{ ip, userAgent, sessionId }` through `authContext(req)`

### 8.2 Admin reset for another account
- `POST /api/admin/customers/:id/reset-password` gated to `manager`, `master_admin`
- `AuthService.adminResetPassword` — skips the current-password check, writes
  `PASSWORD_RESET_BY_ADMIN` attributed to the acting admin, signs the target out everywhere
- "Reset password" action added to `/admin/customers` (prompt → client-side strength check
  → confirm → API)

### 8.3 Wire up the validators that were sitting unused
- All 28 `req.params.id as string` sites (admin, claims, offers, redemptions, review,
  rules) now go through `uuidSchema.parse()` → a malformed id returns
  `400 VALIDATION_ERROR` instead of reaching the DB
- `passwordSchema` (exported but test-only until now) backs register, change, reset and
  admin-create

### 8.4 Point expiry
- Migration `20260926000001_points_expiry` adds `expires_at`, `expired_at`,
  `expired_points` to `points_ledger` and backfills historical credits from the rule
  active at migration time (row-by-row, so no dialect-specific date SQL)
- `PointsEngineService.expiryDateFor()` stamps `expires_at` on `PURCHASE_EARN`,
  `OFFER_BONUS` and `MANUAL_CREDIT`; `expireDueVouchers` stamps restored points with the
  current window so a lapsed voucher cannot launder points into a non-expiring balance
- `PointsEngineService.expireDuePoints()` — FIFO, balance-clamped, idempotent
  (`point-expiry-<sourceRowId>`), writes negative `EXPIRY` rows and marks the source row
  `expired_at`/`expired_points` in the same transaction
- `reversePoints` unwinds `points - expired_points`, so a post-expiry reversal cannot
  drive the balance negative
- `src/jobs/pointExpiry.ts` (new) — hourly `setInterval` plus an immediate first run,
  started and stopped alongside the voucher job in `src/server.ts`
- Customer `/points` ledger gained an "Expires" column (`-` / date / date + "(expired)")

### 8.5 Removed
- `receipt1.pdf` (stray, 114 KB, dated 2026-09-23) — confirmed not test output, deleted

## Files changed/created

```
src/test-utils/integration.ts            (new)
src/__tests__/api.integration.test.ts    (new)
src/services/OfferEligibilityService.ts  (new)
src/services/ArticleCategoryService.ts   (new)
src/services/SessionService.ts           (new)
src/app.ts                               (new)
src/jobs/pointExpiry.ts                  (new)
migrations/20260925000001_article_categories_and_tier.ts (new)
migrations/20260926000001_points_expiry.ts (new)
jest.setup.js, tsconfig.test.json        (new)

src/services/{PointsEngine,Review,Claim,Offer,Redemption,Rule,Auth}Service.ts
src/routes/{admin,claims,review,offers,rules,redemptions,auth,pages,adminPages}.ts
src/middleware/{csrf,upload}.ts
src/utils/{serialize,imageSanitizer,validators}.ts
src/config/{index,knexfile}.ts
src/server.ts, scripts/seed-admin.js
views/admin/{offers,customers,ledger,review-queue,review-detail,profile}.ejs
views/customer/{points,profile}.ejs
views/partials/{customer,admin}-header.ejs
views/partials/change-password.ejs        (new)
jest.config.js, jest.integration.config.js, package.json, .env.example, README.md
docs/{testing,decisions,database,business-rules}.md
```

## Verification

- `npm run typecheck`: **0 errors** (also type-checks tests via `tsconfig.test.json`)
- `npm run lint`: **0 errors**, 58 warnings (all pre-existing `no-console` /
  `no-explicit-any`; 0 from new files)
- `npm test`: **68/68 pass** (~22s)
- `npm run test:integration`: **50/50 pass** (~120s)
- `npm run migrate` on `data/loyalty.db`: batch 4 ran `20260926000001` OK
- `npm run seed:admin`: "Admin user already exists — skipping creation."

## Follow-ups (new / still open)

- No reporting/dashboard endpoint beyond `/api/admin/stats`
- No MFA / rate-limit lockout on repeated failed logins
- Voucher-restored points get a **fresh** expiry window rather than inheriting the original
  credit's date (documented in `decisions.md`)
- Point expiry runs hourly, so a balance can be stale by up to an hour between runs
- SQLite still has no DB-level CHECK/FK inside migration transactions (MySQL prod does)

## Safest next step

Hard-refresh, login again (new CSRF meta), then smoke-test: create a claim as a customer,
approve it as a reviewer while an active `multiplier` offer targets `SF-3PC`, confirm the
ledger shows `PURCHASE_EARN` + `OFFER_BONUS`, reverse it as a manager, then run a manual
adjustment and a redemption from the ledger page. Then check Profile → change the password
in one tab and confirm a second logged-in tab is signed out.
