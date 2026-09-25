# Design Decisions

## 2026-09-22: Project Initialization

### Decision: TypeScript over JavaScript
- **Rationale:** Type safety, better IDE support, easier refactoring
- **Trade-off:** Additional build step, slightly longer development time

### Decision: MySQL over PostgreSQL
- **Rationale:** DirectAdmin typically includes MySQL/MariaDB
- **Trade-off:** Less advanced JSON support than PostgreSQL

### Decision: Session-based Auth over JWT
- **Rationale:** Simpler implementation, automatic expiry, no token storage
- **Trade-off:** Requires server-side session storage

### Decision: Argon2id over bcrypt
- **Rationale:** Modern algorithm, better resistance to GPU attacks
- **Trade-off:** Requires native compilation

### Decision: Knex.js over TypeORM/Prisma
- **Rationale:** Lightweight, SQL-focused, good migration support
- **Trade-off:** No automatic type generation from schema

## 2026-09-22: Receipt Handling

### Decision: Manual Admin Review
- **Rationale:** Ensures accuracy, prevents fraud
- **Trade-off:** Slower processing (24-48 hours)

### Decision: Receipt Number as String
- **Rationale:** Preserve leading zeros, format flexibility
- **Trade-off:** Slightly more storage

### Decision: Private Image Storage
- **Rationale:** Security, prevent unauthorized access
- **Trade-off:** Requires authorization-checked endpoint

## 2026-09-22: Points Ledger

### Decision: Append-only Ledger
- **Rationale:** Audit trail, no data loss, reversals create new entries
- **Trade-off:** More complex queries for balance

### Decision: Integer Points
- **Rationale:** No floating-point errors, simpler calculations
- **Trade-off:** Less flexibility for fractional points

### Decision: Idempotency Keys
- **Rationale:** Prevent duplicate points on retry
- **Trade-off:** Additional unique constraint

## 2026-09-22: Deployment

### Decision: Single-server Deployment
- **Rationale:** Simplicity, DirectAdmin hosting
- **Trade-off:** Limited scalability

### Decision: PM2 Process Manager
- **Rationale:** Auto-restart, clustering, monitoring
- **Trade-off:** Additional dependency

## 2026-09-25: Offer Eligibility

### Decision: Full `article_categories` Lookup Table
- **Rationale:** Prefix → category is data, not code; admin-managed via CRUD API/UI
- **Trade-off:** One more table to maintain; strict matching means an unmatched claim
  simply earns no offer bonus

### Decision: Strict Eligibility Matching
- **Rationale:** An offer that declares `eligibleArticles`/`eligibleCategories`/
  `eligibleTiers` must not silently apply to a claim with no matching data
- **Trade-off:** Admins must configure the lookup table correctly or offers will not fire

### Decision: `customer_profiles.tier` Column
- **Rationale:** Tier is needed for offer eligibility; default `'standard'` keeps existing
  rows valid
- **Trade-off:** Tier changes are an admin concern and are audited
  (`CUSTOMER_TIER_CHANGED`)

### Decision: Split `PURCHASE_EARN` / `OFFER_BONUS` Ledger Entries
- **Rationale:** Base earn and bonus stay separately auditable; `offer_snapshot` lives only
  on the bonus row so `checkOfferUsage` counts exactly one use per claim
- **Trade-off:** Two rows per approved claim instead of one

## 2026-09-25: Concurrency & Portability

### Decision: Row Locks with `.forUpdate()` Everywhere It Matters
- **Rationale:** Claim approval, claim reversal and voucher creation re-check state inside
  a transaction after locking (`receipt_claims`, `users`)
- **Trade-off:** None — knex emits `for update` on MySQL and silently drops it on
  better-sqlite3, so the same code is safe on both

### Decision: Drop `.returning()` / `RETURNING`
- **Rationale:** knex's mysql2 compiler deliberately no-ops `.returning()`; code that
  relied on it returned `[insertId]` instead of rows
- **Trade-off:** Every insert now needs an explicit id (`newId()`) plus a re-select

### Decision: `AUTH_RATE_LIMIT_MAX` Environment Variable
- **Rationale:** The auth limiter was hardcoded at 20/15min, which is right for production
  but unusable for an HTTP test suite
- **Trade-off:** One more knob; defaults to the old value of 20

## 2026-09-25: Testing

### Decision: Supertest Against a Real `createApp()`
- **Rationale:** CSRF, sessions, uploads, RBAC and error envelopes only show up over HTTP
- **Trade-off:** Slower than unit tests (~80s); kept out of `npm test` behind
  `npm run test:integration`

### Decision: Dedicated `test` Knex Environment
- **Rationale:** Tests must never touch `data/loyalty.db`; FK pragma is switched on for the
  test DB so unsafe delete order fails loudly
- **Trade-off:** Migrations must be re-seeded manually after each `resetDb()`

## 2026-09-25: Password Security

### Decision: Kill Every Other Session on a Password Change
- **Rationale:** Changing a password implies the old one may be compromised; a device
  already signed in would otherwise keep working for the rest of the 24h cookie
- **Trade-off:** Sessions live as JSON in `sessions.sess` with no `user_id` column, so
  invalidation is a `CAST(sess AS CHAR) LIKE '%"userId":"<uuid>"%'` sweep; the caller's
  own `sid` is excluded so the change-password page keeps working

### Decision: Resets Force a Full Sign-Out, Changes Do Not
- **Rationale:** A change comes from a verified session; a reset (emailed link or an
  admin acting) means the password left the owner's hands
- **Trade-off:** Anyone who resets is logged out everywhere, including the tab they used

### Decision: Audit the Actor, Never the Secret
- **Rationale:** `PASSWORD_CHANGED`, `PASSWORD_RESET` and `PASSWORD_RESET_BY_ADMIN` rows
  record who/where/when; for admin resets `new_values` holds only the target email
- **Trade-off:** None — no password, hash, or token is ever written to the log

### Decision: Admin Reset Is Manager-Scoped
- **Rationale:** Reviewers already read customer data but do not administer accounts;
  matching the tier-change gate keeps the privilege boundary in one place
- **Trade-off:** A reviewer must escalate to a manager for a locked-out customer

### Decision: Wire Up the Existing `passwordSchema` / `uuidSchema`
- **Rationale:** `src/utils/validators.ts` already exported both but no route used them —
  password rules were copy-pasted inline and every `:id` was an unchecked `as string`
- **Trade-off:** `passwordSchema` adds `.max(128)` to registration and admin creation,
  which the inline copies did not have

## 2026-09-25: Point Expiry

### Decision: Stamp `expires_at` at Credit Time
- **Rationale:** A ledger row must remember the window it was earned under, so editing
  `pointExpiryDays` later cannot silently change when existing points die
- **Trade-off:** Credits predating the migration are backfilled once, from the rule
  active at migration time

### Decision: Reuse `EXPIRY` With a Negative Sign
- **Rationale:** `EXPIRY` is the documented ledger type and the voucher job already
  writes it positive when a lapsed voucher returns points
- **Trade-off:** The sign, not the type, distinguishes "points came back" from "points
  aged out"; the `reason` string says which

### Decision: FIFO and Balance-Clamped, No Bucket Table
- **Rationale:** `balance = SUM(points)` over the whole ledger, so the correct run is
  "expire the oldest overdue credits, never more than the current balance". Rows already
  spent are stamped consumed with a 0-point write rather than expired a second time
- **Guard:** `reversePoints` unwinds `points - expired_points`, so reversing a claim
  after its points aged out cannot push the balance below zero
- **Trade-off:** A per-bucket subledger would model partial consumption exactly; this
  approximates it and only differs if debits are assumed to hit the newest points first

### Decision: Hourly Job, Not On-Read Expiry
- **Rationale:** Mirrors the existing voucher-expiry scheduler, so behaviour and
  operational expectations stay consistent
- **Trade-off:** A balance can be stale for up to an hour between runs

