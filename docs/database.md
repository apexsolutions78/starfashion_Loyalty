# Database Schema

## Tables

### users
- id (UUID, PK)
- role (ENUM: customer, cashier, reviewer, manager, master_admin)
- email (VARCHAR, UNIQUE)
- mobile (VARCHAR, UNIQUE)
- password_hash (VARCHAR)
- status (ENUM: active, suspended, deleted)
- email_verified (BOOLEAN)
- mobile_verified (BOOLEAN)
- created_at, updated_at

### customer_profiles
- id (UUID, PK)
- user_id (UUID, FK → users)
- full_name (VARCHAR)
- avatar_url (VARCHAR)
- marketing_consent (BOOLEAN)
- loyalty_consent (BOOLEAN)
- date_of_birth, gender

### admin_profiles
- id (UUID, PK)
- user_id (UUID, FK → users)
- full_name (VARCHAR)
- department (VARCHAR)
- mfa_enabled (BOOLEAN)

### receipt_claims
- id (UUID, PK)
- customer_id (UUID, FK → users)
- receipt_number (VARCHAR, UNIQUE)
- purchase_date (DATE)
- submitted_amount (DECIMAL)
- submitted_articles (JSON)
- receipt_image_path (VARCHAR)
- status (ENUM: SUBMITTED, PENDING_REVIEW, REQUEST_CLEARER_IMAGE, APPROVED, REJECTED, REVERSED)
- approved_amount, eligible_amount (DECIMAL)
- reviewer_notes, rejection_reason (TEXT)
- reviewed_by (UUID, FK → users)
- rule_snapshot, offer_snapshot (JSON)

### points_ledger
- id (UUID, PK)
- customer_id (UUID, FK → users)
- claim_id (UUID, FK → receipt_claims)
- voucher_id (UUID)
- type (ENUM: PURCHASE_EARN, OFFER_BONUS, REDEMPTION, EXPIRY, REFUND_REVERSAL, MANUAL_CREDIT, MANUAL_DEBIT, CORRECTION_REVERSAL)
- points (INTEGER, signed)
- rule_snapshot, offer_snapshot (JSON)
- idempotency_key (VARCHAR, UNIQUE)
- created_by (UUID, FK → users)
- reason (TEXT)
- reversal_reference (UUID)

### redemption_vouchers
- id (UUID, PK)
- customer_id (UUID, FK → users)
- voucher_code (VARCHAR, UNIQUE)
- points_redeemed (INTEGER)
- discount_amount (DECIMAL)
- status (ENUM: ACTIVE, USED, EXPIRED, CANCELLED)
- expires_at (TIMESTAMP)
- used_at (TIMESTAMP)
- used_by (UUID)
- ledger_entry_id (UUID, FK → points_ledger)

### loyalty_rules
- id (UUID, PK)
- version (INTEGER)
- name (VARCHAR)
- rules_json (JSON)
- is_active (BOOLEAN)
- effective_from, effective_to (TIMESTAMP)
- created_by (UUID, FK → users)

### offers
- id (UUID, PK)
- name (VARCHAR)
- description (TEXT)
- offer_type (ENUM)
- conditions_json (JSON)
- start_date, end_date (TIMESTAMP)
- is_active (BOOLEAN)
- max_uses_per_customer, global_max_uses (INTEGER)
- priority (INTEGER)
- stackable (BOOLEAN)
- terms (TEXT)

### notifications
- id (UUID, PK)
- user_id (UUID, FK → users)
- type (VARCHAR)
- title (VARCHAR)
- message (TEXT)
- data_json (JSON)
- read (BOOLEAN)

### audit_logs
- id (UUID, PK)
- user_id (UUID, FK → users)
- action (VARCHAR)
- entity_type (VARCHAR)
- entity_id (UUID)
- old_values, new_values (JSON)
- ip_address, user_agent (VARCHAR)

### contact_verifications
- id (UUID, PK)
- user_id (UUID, FK → users)
- type (ENUM: email, mobile)
- token_hash (VARCHAR)
- contact_value (VARCHAR)
- expires_at (TIMESTAMP)
- attempts, max_attempts (INTEGER)
- used (BOOLEAN)

### password_reset_tokens
- id (UUID, PK)
- user_id (UUID, FK → users)
- token_hash (VARCHAR)
- expires_at (TIMESTAMP)
- used (BOOLEAN)

### consents
- id (UUID, PK)
- user_id (UUID, FK → users)
- consent_type (VARCHAR)
- granted (BOOLEAN)
- ip_address, user_agent (VARCHAR)

### system_settings
- key (VARCHAR, PK)
- value (TEXT)
- description (TEXT)
- updated_by (UUID, FK → users)

## Indexes

- users: email, mobile, status, created_at
- receipt_claims: customer_id, status, receipt_number, created_at
- points_ledger: customer_id, type, claim_id, created_at, idempotency_key
- redemption_vouchers: customer_id, status, voucher_code, expires_at
- audit_logs: user_id, entity_type, action, created_at
