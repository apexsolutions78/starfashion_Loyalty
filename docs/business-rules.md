# Business Rules

## Receipt Rules

1. **Receipt Number Format**
   - Default: DD-MM-YYYY-NN (e.g., 22-09-2026-01)
   - Format is configurable via `RECEIPT_NUMBER_REGEX`
   - Stored as string, preserving leading zeros
   - Whitespace is normalized (removed)

2. **Submission Window**
   - Receipts must be submitted within 30 days of purchase
   - Future dates are rejected

3. **Duplicate Prevention**
   - One receipt number can only be approved once
   - Duplicate submissions are rejected at database level

4. **Image Requirements**
   - Formats: JPEG, PNG, PDF
   - Maximum size: 8MB (configurable)
   - Stored in private storage (not public)
   - Original filenames not preserved

## Points Rules

1. **Earning Points**
   - Points are earned only after admin approval
   - Formula: `floor(eligibleAmount / currencyThreshold) * pointsPerThreshold`
   - Maximum points per claim can be configured
   - Points are integer values

2. **Point Expiry**
   - Configurable expiry period
   - Expiry creates negative ledger entry
   - Expired points cannot be redeemed
   - Implemented: `points_ledger.expires_at` is stamped from the active rule's
     `pointExpiryDays` at credit time; the hourly point-expiry job writes negative
     `EXPIRY` rows and balance = `SUM(points)`, so expired points drop out of the
     balance automatically. `pointExpiryDays: null` means points never expire.

3. **Ledger**
   - Append-only ledger (never deleted)
   - Each entry has idempotency key
   - Reversals create new entries (not edits)

## Redemption Rules

1. **Minimum Redemption**
   - Minimum points required for redemption
   - Configurable per rule version

2. **Maximum Redemption**
   - Maximum percentage of sale amount
   - Maximum fixed discount amount
   - Cannot exceed available balance

3. **Vouchers**
   - 24-hour expiry (configurable)
   - Single-use only
   - Generated code format: SF-XXXX-XXXX
   - Must be presented at shop

## Admin Rules

1. **Review Process**
   - Only reviewer, manager, or master_admin can approve
   - Approval requires entering approved and eligible amounts
   - Rejection requires a reason
   - All actions are audit logged

2. **Rule Management**
   - Only master_admin can create/edit rules
   - Rules are versioned
   - Only one rule can be active at a time
   - Rule changes don't affect historical points

3. **Offer Management**
   - Only master_admin can create/edit offers
   - Offers have start and end dates
   - Maximum uses per customer and globally
   - Priority determines display order

## Security Rules

1. **Password Policy**
   - Minimum 8 characters
   - Must contain uppercase, lowercase, and number
   - Argon2id hashing

2. **Session Management**
   - HTTP-only, Secure, SameSite cookies
   - 24-hour expiry
   - Session destruction on logout

3. **Rate Limiting**
   - Configurable per endpoint
   - Default: 100 requests per 15 minutes

4. **File Upload**
   - MIME type validation
   - File size limits
   - Opaque filenames
   - Private storage
