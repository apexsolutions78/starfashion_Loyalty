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
