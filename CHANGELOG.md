# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2026-09-22

### Added

#### Milestone 1: Foundation
- Node.js project initialization with TypeScript
- ESLint and Prettier configuration
- Jest test runner setup
- Environment validation with Zod
- MySQL database connection with Knex.js
- Initial database schema migration (17 tables)
- Structured logging with Winston
- Request ID middleware
- Centralized error handling

#### Milestone 2: Authentication
- Customer registration with email and mobile verification
- Login/logout with session management
- Password change and reset functionality
- Admin user management
- Role-based access control

#### Milestone 3: Receipt Claims
- Receipt image upload with Multer
- Receipt number normalization and validation
- Duplicate receipt prevention
- Claim status tracking
- Customer notifications

#### Milestone 4: Admin Review
- Review queue with search and filtering
- Claim approval with amount entry
- Claim rejection with reason
- Clearer image request workflow
- Audit logging for all actions

#### Milestone 5: Points Engine
- Configurable loyalty rules
- Points calculation engine
- Rule versioning and activation
- Offer management
- Points ledger with idempotency

#### Milestone 6: Redemption
- Points-to-discount conversion
- Voucher generation with unique codes
- Single-use voucher enforcement
- Voucher cancellation with point restoration
- Voucher usage tracking

#### Milestone 7: Hardening
- Security tests
- Deployment documentation
- Business rules documentation
- Debugging guide
- README and changelog
