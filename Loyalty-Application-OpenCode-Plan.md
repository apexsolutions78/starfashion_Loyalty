OpenCode Build Plan: Receipt-Verified Loyalty Application
1. Purpose
Build a standalone, mobile-first loyalty web application for a Pakistani retail shop selling ready-made Pakistani traditional party-wear 3-piece suits.
The application must run independently from the existing POS system. It must not modify, integrate with, import from, export to, or depend on the POS. The POS receipt number is used only as a manually entered reference and duplicate-prevention key.
Customers register through a permanent shop QR code, upload a photograph of their receipt, and wait for manual admin verification. Points are awarded only after an admin approves the receipt. Receipt approval normally takes 24–48 hours.
Target deployment: Node.js application and MySQL database on DirectAdmin hosting.
2. Non-negotiable business rules
1.	No POS integration of any kind.
2.	No POS modification, receipt amendment, added receipt QR, added receipt code, API, webhook, CSV import, or automated POS lookup.
3.	The public QR code opens the loyalty application only.
4.	A predictable receipt number is not a secret and must never independently award points.
5.	A customer may submit a receipt photograph and details from their dashboard.
6.	Every receipt claim begins as PENDING_REVIEW.
7.	Points are created only when an authorized admin approves a claim.
8.	One receipt number can be approved for one loyalty account only once.
9.	The database must enforce uniqueness, not only application code.
10.	Approved claims must not be edited or deleted. Corrections use reversal or adjustment ledger entries.
11.	Customer-submitted amount and article numbers are untrusted input. Admin-approved values control points.
12.	Points must be represented by an auditable ledger.
13.	Redemption must create a negative ledger entry and must be atomic.
14.	A customer cannot redeem more points than their available balance.
15.	A customer cannot redeem more than the configured percentage or fixed limit for a sale.
16.	Rules, offers, redemptions, approvals, reversals, and admin changes must be audited.
17.	Customer account creation may occur before purchase approval, but the account has zero points and redemption is disabled until a purchase is approved.
18.	Verified mobile number or email should prevent uncontrolled duplicate accounts; make this configurable according to privacy and business requirements.
19.	Marketing consent must be separate from mandatory loyalty-program consent.
20.	Never expose whether a receipt number exists through a public lookup endpoint.
3. Roles
Implement role-based access control:
Customer
•	Register and verify email or mobile.
•	Log in and log out.
•	Change password.
•	Request password reset.
•	View profile and consent settings.
•	Upload receipt photographs.
•	View claim status and rejection reason.
•	View points balance and complete ledger.
•	View approved purchase history.
•	Request or generate a redemption voucher when eligible.
•	View active offers.
Cashier or staff (optional)
Do not require cashier participation in the MVP. If implemented later, give this role no rule-management permission and no ability to approve their own claims.
Reviewer
•	View pending receipt claims.
•	View receipt image and submitted data.
•	Approve, reject, or request a clearer image.
•	Enter approved amount and eligible amount.
•	Confirm article numbers.
•	Add review notes.
•	Cannot change global loyalty rules unless separately authorized.
Manager
•	All reviewer permissions.
•	Reverse approved claims.
•	Approve manual point adjustments.
•	Review audit logs and reports.
Master Admin
•	Manage admins and roles.
•	Create and edit loyalty rules.
•	Create and schedule offers and campaigns.
•	Configure redemption limits and expiry.
•	Configure claim limits and review settings.
•	Manage customers.
•	Manage branches if later enabled.
•	View reports.
•	Manage system settings.
4. Customer journey
Registration
1.	Customer scans the permanent shop QR code.
2.	Customer opens a responsive /join page.
3.	Customer submits name, mobile, email, password, and mandatory terms consent.
4.	Application sends a one-time verification code or link.
5.	Code/link is single-use and expires after a configurable period, initially 10 minutes.
6.	Customer verifies contact information.
7.	Account becomes active with zero points.
8.	Dashboard explains: upload a receipt to earn points; approval normally takes 24–48 hours.
Use secure random verification tokens, store only their hashes, enforce expiry, attempt limits, and resend limits. Do not reveal whether an email or phone is already registered through inconsistent public messages.
Receipt upload
1.	Customer opens Add Purchase.
2.	Customer uploads a clear receipt image from a phone camera or gallery.
3.	Accepted formats: JPEG, PNG, and optionally PDF; configure maximum size, initially 8 MB.
4.	Customer enters receipt number, purchase date, receipt total, and optional article numbers.
5.	Server validates format and basic consistency but does not award points.
6.	Claim is stored as SUBMITTED or PENDING_REVIEW.
7.	Customer sees a claim reference and expected review time.
8.	Notification is sent to the review queue.
The receipt number format currently resembles DD-MM-YYYY-NN, for example 22-09-2026-01. Store it as a string, preserve leading zeroes, normalize whitespace, and validate a configurable format without assuming the format can never change.
Review
1.	Reviewer opens the queue.
2.	Application shows image, submitted values, OCR suggestions if implemented, duplicate warnings, customer history, and risk flags.
3.	Reviewer checks shop identity, date, receipt number, total amount, article numbers, image clarity, and prior claims.
4.	Reviewer enters trusted approved amount and eligible amount.
5.	Reviewer approves, rejects, or requests a clearer image.
6.	Approval creates a purchase record and points ledger entry in one transaction.
7.	Customer receives an in-app notification and optionally email.
Redemption
1.	Customer views available balance.
2.	Customer selects an eligible redemption amount.
3.	Server calculates maximum permitted discount from current active rules.
4.	Customer confirms.
5.	Application creates a short-lived, single-use redemption voucher.
6.	Customer presents voucher on their phone at the shop.
7.	Staff applies the discount manually in the unchanged POS.
8.	Staff or an authorized account marks the voucher used. If staff cannot access the application, the product owner must define a manual fallback; do not automatically deduct points merely because the customer generated a voucher.
9.	Redemption creates a negative ledger entry atomically with voucher finalization.
5. Loyalty and offer engine
Create configurable master rules. Never hardcode rates in business logic.
Base rule settings
•	Currency threshold, e.g. PKR 1,000.
•	Points awarded per threshold.
•	Minimum eligible purchase amount.
•	Eligible/excluded sale categories, if article numbers can be reviewed.
•	Maximum points per claim.
•	Point expiry period or no expiry.
•	Redemption conversion, e.g. 100 points = PKR 100.
•	Minimum points required for redemption.
•	Maximum redemption percentage of approved sale amount.
•	Maximum fixed discount per transaction.
•	Whether points are earned on the amount paid using points.
•	Claim submission window.
•	Pending period, initially 24–48 hours only if desired; approval should remain explicit.
Offers
Master admin can create offers with:
•	Name.
•	Description.
•	Offer type: multiplier, fixed bonus, percentage bonus, birthday, referral, or coupon.
•	Start and end date/time.
•	Active/inactive state.
•	Eligible customers or tiers.
•	Minimum purchase amount.
•	Eligible article numbers/categories.
•	Maximum uses per customer.
•	Global maximum uses.
•	Priority.
•	Stackable/non-stackable behavior.
•	Terms shown to the customer.
At approval time, resolve the exact rules and offers used and save a snapshot on the claim/ledger metadata. Future rule changes must not change historical points.
Calculation example
If the approved eligible amount is PKR 12,500 and the rule is 10 points per PKR 1,000:
floor(12,500 / 1,000) * 10 = 120 points
If a 2x offer applies, award 240 points, subject to configured caps.
Use integer arithmetic for money in the smallest unit, preferably paisa, or use MySQL DECIMAL. Never use JavaScript floating-point arithmetic for financial values.
6. Points ledger design
Use an append-only ledger.
Recommended transaction types:
•	PURCHASE_EARN
•	OFFER_BONUS
•	REDEMPTION
•	EXPIRY
•	REFUND_REVERSAL
•	MANUAL_CREDIT
•	MANUAL_DEBIT
•	CORRECTION_REVERSAL
Balance:
available balance = sum(valid ledger entries)
A cached balance may be used only as an optimization and must be reconciled against the ledger.
Each ledger entry should include:
•	Customer ID.
•	Claim or voucher ID.
•	Type.
•	Signed points value.
•	Rule/offer snapshot.
•	Idempotency key.
•	Created by user or system.
•	Reason.
•	Created timestamp.
•	Reversal reference where applicable.
7. Suggested MySQL schema
Create migrations for at least:
•	users
•	customer_profiles
•	admin_profiles
•	roles and permissions, or a clear role enum initially
•	contact_verifications
•	password_reset_tokens
•	consents
•	receipt_claims
•	receipt_images
•	purchase_records
•	loyalty_rules
•	offers
•	offer_conditions
•	points_ledger
•	redemption_vouchers
•	notifications
•	audit_logs
•	system_settings
Important indexes and constraints:
•	Unique normalized verified email where applicable.
•	Unique normalized verified mobile where applicable.
•	Unique receipt_number, or (branch_id, receipt_number) if needed.
•	Unique claim_id for purchase earn ledger entries.
•	Unique redemption voucher code.
•	Foreign keys with deliberate delete behavior.
•	Indexes for customer ID, claim status, created date, receipt number, and ledger customer/date.
Do not cascade-delete financial or audit records. Use status changes and reversals.
8. API design
Separate customer and admin authorization middleware.
Public/customer endpoints
•	POST /api/auth/register
•	POST /api/auth/verify-contact
•	POST /api/auth/login
•	POST /api/auth/logout
•	POST /api/auth/forgot-password
•	POST /api/auth/reset-password
•	GET /api/me
•	PATCH /api/me
•	POST /api/claims
•	GET /api/claims
•	GET /api/claims/:id
•	POST /api/claims/:id/resubmit
•	GET /api/points/balance
•	GET /api/points/ledger
•	GET /api/offers
•	POST /api/redemptions/quote
•	POST /api/redemptions
•	GET /api/redemptions
Admin endpoints
•	GET /api/admin/claims?status=PENDING_REVIEW
•	GET /api/admin/claims/:id
•	POST /api/admin/claims/:id/approve
•	POST /api/admin/claims/:id/reject
•	POST /api/admin/claims/:id/request-image
•	POST /api/admin/claims/:id/reverse
•	GET /api/admin/customers
•	GET /api/admin/ledger
•	POST /api/admin/adjustments
•	GET /api/admin/rules
•	POST /api/admin/rules
•	PATCH /api/admin/rules/:id
•	GET /api/admin/offers
•	POST /api/admin/offers
•	PATCH /api/admin/offers/:id
•	POST /api/admin/offers/:id/activate
•	POST /api/admin/offers/:id/deactivate
•	GET /api/admin/reports
•	GET /api/admin/audit-logs
Validate authorization at every endpoint and at resource level. A customer must never access another customer’s claim, points, image, or voucher by changing an ID.
9. Receipt image handling
•	Store files outside the public web root.
•	Use generated opaque storage names, not original filenames.
•	Validate MIME type and file signature, not only extension.
•	Strip or ignore unsafe metadata where practical.
•	Limit file size and image dimensions.
•	Generate a safe thumbnail for review.
•	Serve images through an authorization-checked endpoint.
•	Do not put receipt images in public URLs.
•	Configure retention and deletion policies.
•	Keep original image for audit until the claim retention period ends.
10. Security requirements
Implement before production:
•	HTTPS.
•	Argon2id or bcrypt password hashing.
•	HTTP-only, Secure, SameSite cookies.
•	CSRF protection if using cookie sessions.
•	Parameterized SQL or a safe ORM.
•	Input validation using a shared schema library.
•	Output encoding and XSS protection.
•	Rate limits for login, registration, verification, password reset, upload, and claim resubmission.
•	Upload abuse protection.
•	Role-based access control.
•	Admin MFA if feasible.
•	Secure headers.
•	Generic authentication error messages.
•	No passwords, OTPs, cookies, or reset tokens in logs.
•	Audit logging for approvals, rejections, reversals, rule changes, adjustments, logins, and authorization failures.
•	Daily encrypted database backups and tested restoration.
•	Environment secrets outside source control.
•	Separate development, staging, and production configuration.
11. Admin dashboard
Build these screens:
1.	Overview: pending claims, approved claims, rejected claims, points liability, redemptions, and suspicious activity.
2.	Review queue: fast receipt-review workflow with filters and keyboard shortcuts.
3.	Claim detail: image, extracted fields, customer history, duplicate warnings, decision controls.
4.	Customer management: search, profile, claims, points, account status, merge workflow, and audit history.
5.	Rules: versioned loyalty rules with effective dates and confirmation before activation.
6.	Offers: create, preview, schedule, activate, deactivate, and view usage.
7.	Points ledger: filter, export if permitted, and view reversals.
8.	Redemption management: pending, active, used, expired, cancelled.
9.	Reports: claim volume, approval rate, points issued, points redeemed, outstanding points, and reviewer workload.
10.	Audit logs.
11.	Admin user and permission management.
12. DirectAdmin deployment
Before coding deployment-specific assumptions, inspect the hosting environment.
Required checks:
•	Supported Node.js version.
•	Node.js application manager or Passenger support.
•	SSH availability.
•	Ability to run migrations.
•	MySQL/MariaDB version.
•	Persistent writable storage outside public root.
•	Cron support.
•	SMTP or transactional email availability.
•	HTTPS certificate and subdomain support.
•	Process restart method.
•	Log access.
Recommended layout:
/home/account/
  apps/loyalty-app/
    server/
    client-or-views/
    migrations/
  private-storage/receipts/
  logs/
  backups/
  .env

Use a subdomain such as loyalty.example.com.
Deployment sequence:
1.	Create the subdomain in DirectAdmin.
2.	Create a dedicated MySQL database and user.
3.	Create the Node.js application with the hosting provider’s supported version.
4.	Configure application root and startup file.
5.	Upload or clone the repository.
6.	Run npm ci --omit=dev in production.
7.	Configure environment variables.
8.	Run database migrations.
9.	Create the first master admin through a secure setup command.
10.	Configure HTTPS.
11.	Configure email.
12.	Test customer registration, upload, review, approval, and redemption.
13.	Enable production mode.
14.	Configure backups and monitoring.
Do not put .env, uploads, SQL dumps, logs, or private keys in the public web root.
13. Environment variables
Create .env without real secrets:
NODE_ENV=production
PORT=3000
APP_URL=https://loyalty.starfashionofficial.com
DATABASE_URL=mysql://user:password@localhost/database
SESSION_SECRET=replace-with-long-random-secret
UPLOAD_DIR=/home/account/private-storage/receipts
MAX_UPLOAD_MB=8
SMTP_HOST=admin@starfashionofficial.com
SMTP_PORT=587
SMTP_USER= admin@starfashionofficial.com
SMTP_PASSWORD=StarAdmin123@
MAIL_FROM=store@starfashionofficial.com
RATE_LIMIT_SECRET=

Validate required environment variables at startup and fail clearly if missing.
14. Error-handling strategy
Use a consistent error format:
{
  "error": {
    "code": "CLAIM_ALREADY_EXISTS",
    "message": "This receipt cannot be submitted again."
  },
  "requestId": "..."
}

Never expose stack traces, SQL, filesystem paths, secrets, or internal IDs to customers.
Generate a request ID and include it in server logs and support-facing error messages.
Distinguish:
•	User validation error.
•	Authentication error.
•	Authorization error.
•	Duplicate/business-rule error.
•	Temporary infrastructure error.
Use centralized error middleware and structured logs.
15. Testing requirements
Do not consider a feature complete until its tests pass.
Unit tests
Test:
•	Receipt-number normalization.
•	Receipt-number format validation.
•	Money parsing and rounding.
•	Points calculation.
•	Offer eligibility.
•	Offer stacking rules.
•	Redemption maximum calculation.
•	Point expiry.
•	Status transition rules.
•	Password and token policy.
•	File validation.
Use integer minor units or DECIMAL; test values such as PKR 0, 999, 1,000, 1,001, and large amounts.
Integration tests
Test:
•	Registration and contact verification.
•	Login and logout.
•	Password reset.
•	Customer upload.
•	Admin approval creates exactly one purchase and one earn entry.
•	Duplicate receipt submission is rejected.
•	Two simultaneous approvals cannot create two earn entries.
•	Rejection creates no points.
•	Resubmission creates no duplicate claim.
•	Reversal adds a reversal entry and preserves history.
•	Redemption cannot exceed balance.
•	Redemption voucher cannot be reused.
•	Rule changes do not change historical ledger values.
•	Customers cannot access another customer’s records.
•	Reviewers cannot change master rules.
•	Master admin permissions work correctly.
Security tests
Test:
•	SQL injection payloads.
•	XSS in name, notes, offer text, and rejection reason.
•	CSRF on state-changing operations.
•	IDOR by changing claim/customer/voucher IDs.
•	Brute force and rate limits.
•	Upload executable-file rejection.
•	Unauthorized image access.
•	Session fixation and logout invalidation.
•	Password reset token reuse.
•	OTP/token expiry and replay.
•	Mass assignment of role, points, status, or approved amount.
•	Concurrent duplicate claim and redemption requests.
End-to-end tests
Use a test browser to simulate:
1.	Customer registers.
2.	Customer verifies contact.
3.	Customer uploads a receipt.
4.	Admin receives queue item.
5.	Admin approves with approved amount.
6.	Customer sees points.
7.	Customer requests redemption.
8.	Voucher is used once.
9.	Second use is rejected.
10.	Claim reversal restores the appropriate balance through a ledger entry.
Manual acceptance checklist
•	Use a phone on mobile data, not only desktop localhost.
•	Test poor image quality.
•	Test duplicate receipts.
•	Test two users claiming one receipt.
•	Test two browser tabs approving one claim.
•	Test incorrect date, number, amount, and article numbers.
•	Test password change and password reset.
•	Test 24–48-hour messaging.
•	Test backup restoration.
•	Test DirectAdmin restart and deployment rollback.
16. Debugging and development instructions for OpenCode
Follow these rules throughout development:
1.	First inspect the repository, hosting assumptions, package manager, existing code, and database configuration.
2.	Do not rewrite the entire project when a focused change is sufficient.
3.	Before implementing a feature, state the affected files, database tables, API routes, authorization rules, and tests.
4.	Implement one vertical slice at a time: database migration, server logic, API, UI, tests.
5.	Never modify the POS or invent an integration.
6.	Keep business rules in dedicated services, not scattered through route handlers.
7.	Use database transactions for approval, reversal, redemption, and rule activation.
8.	Add an idempotency key to operations that create points or deduct points.
9.	Keep migrations forward-only and review generated SQL before applying it.
10.	After every change, run formatter, linter, type checker, unit tests, integration tests, and build.
11.	When a test fails, reproduce the smallest failure first; do not make unrelated changes.
12.	Read the complete error and inspect the relevant logs before changing code.
13.	Add a regression test before fixing a recurring bug.
14.	Never hide errors with empty catches or broad silent fallbacks.
15.	Never log secrets or receipt images.
16.	Use seeded test data and a disposable test database.
17.	Keep a docs/decisions.md file for business-rule decisions.
18.	Keep a docs/debugging.md file containing common commands, log locations, migration status, and rollback instructions.
19.	Before declaring completion, run the full test suite and report exact results.
20.	If a requirement is ambiguous, stop and ask one focused question rather than guessing.
17. Required project documentation
Generate and maintain:
•	README.md: setup, development, testing, deployment.
•	docs/architecture.md: components and data flow.
•	docs/business-rules.md: authoritative rules.
•	docs/database.md: schema and migration notes.
•	docs/security.md: threat model and controls.
•	docs/deployment-directadmin.md: exact hosting deployment procedure.
•	docs/testing.md: test commands and acceptance tests.
•	docs/debugging.md: diagnosis and recovery procedures.
•	docs/decisions.md: dated design decisions.
•	.env.example.
•	CHANGELOG.md.
18. Suggested implementation order
Milestone 1: Foundation
•	Initialize Node.js project.
•	Configure TypeScript if supported by the host.
•	Configure linting, formatting, test runner, and environment validation.
•	Add database connection and migrations.
•	Add structured logging and request IDs.
Milestone 2: Authentication
•	Customer registration.
•	Contact verification.
•	Login/logout.
•	Password change/reset.
•	Admin authentication and roles.
Milestone 3: Receipt claims
•	Customer upload UI.
•	Secure private image storage.
•	Claim creation.
•	Receipt-number normalization and uniqueness.
•	Claim status and customer history.
Milestone 4: Admin review
•	Review queue.
•	Receipt preview.
•	Approve/reject/request image.
•	Approved amount entry.
•	Audit events.
Milestone 5: Points engine
•	Ledger.
•	Rule management.
•	Offers.
•	Point calculation.
•	Historical snapshots.
•	Reports.
Milestone 6: Redemption
•	Balance display.
•	Redemption quote.
•	Voucher generation.
•	Single-use redemption.
•	Reversal and audit.
Milestone 7: Hardening and deployment
•	Security tests.
•	Load and concurrency tests.
•	Backup/restore test.
•	DirectAdmin staging deployment.
•	Production deployment.
•	Monitoring and operational runbook.
19. Copy-paste OpenCode master prompt
You are the lead engineer for this project. Build the application described in this document as a production-minded modular monolith.
Before coding:
•	Inspect the repository and environment.
•	Confirm the Node.js version, package manager, MySQL access method, DirectAdmin deployment constraints, and existing files.
•	Produce a short implementation plan for the next milestone.
•	Do not modify or integrate with the POS under any circumstances.
•	Do not invent receipt QR codes, POS APIs, POS exports, cashier workflows, or receipt changes.
Architecture requirements:
•	Node.js backend.
•	MySQL database.
•	Mobile-first web UI.
•	Secure session authentication.
•	Role-based admin authorization.
•	Private receipt image storage.
•	Append-only points ledger.
•	Versioned loyalty rules and offers.
•	Full audit trail.
•	Clear separation of customer, reviewer, manager, and master-admin permissions.
Business requirements:
•	Customers join using a public shop QR code.
•	Customers can create accounts and upload receipt photos from their dashboard.
•	Receipt format may be DD-MM-YYYY-NN, such as 22-09-2026-01, but the format must be configurable.
•	Receipt number is predictable and is only a reference/duplicate key.
•	Receipt claims remain pending until admin verification.
•	Admin verifies date, receipt number, amount, article numbers, shop identity, image clarity, and duplicate history.
•	Admin enters the trusted approved and eligible amounts.
•	Points are credited only after approval.
•	One receipt can be approved only once for one account.
•	Customers see a 24–48-hour review expectation.
•	Admin can create, edit, schedule, activate, and deactivate points rules and offers.
•	Historical transactions preserve the exact rule and offer snapshot used.
•	Customers can redeem points only within configured limits.
•	Redemption vouchers are short-lived and single-use.
•	Financial and loyalty history is never deleted; use reversals.
Implementation method:
•	Build one vertical slice at a time.
•	For every slice, implement migration, domain service, API, UI, authorization, tests, and documentation.
•	Use transactions and row locking for approval and redemption.
•	Use idempotency keys for point creation and deduction.
•	Validate all customer input on the server.
•	Use integer minor units or MySQL DECIMAL for money.
•	Never use floating point for currency.
•	Never trust client-supplied points, balances, roles, statuses, approved amounts, or offer eligibility.
•	Do not expose private receipt images publicly.
•	Do not store passwords, OTPs, reset tokens, or session secrets in plaintext.
Testing method:
•	Write unit tests before or alongside calculation logic.
•	Add integration tests for every state-changing endpoint.
•	Add authorization tests for every role and object ID.
•	Add concurrency tests for duplicate claim and redemption attempts.
•	Add upload-security tests.
•	Add end-to-end tests for the full customer-review-approval-redemption journey.
•	After each milestone run formatter, linter, type checking, unit tests, integration tests, and build.
•	When fixing a bug, first reproduce it, add a regression test, apply the smallest fix, and rerun the relevant and full suites.
•	Report commands run and exact pass/fail results.
Deployment method:
•	Provide DirectAdmin-specific documentation for Node.js application setup, MySQL database creation, environment variables, migrations, private upload storage, HTTPS, process restart, logs, cron, backup, restore, and rollback.
•	Detect hosting limitations instead of assuming root access or Docker.
•	Do not place private files in the public web root.
Definition of done:
•	All business rules in this document are implemented and tested.
•	No POS dependency exists in source code, schema, deployment, or documentation.
•	Duplicate claims and duplicate redemptions are prevented under concurrent requests.
•	Admin approvals and rule changes are audited.
•	Historical points remain explainable.
•	Security, authorization, upload, and regression tests pass.
•	The application runs on a DirectAdmin staging environment.
•	Documentation is complete enough for another developer to deploy and debug it.
At the end of each work session, provide:
1.	What was implemented.
2.	Files changed.
3.	Database migrations added.
4.	Tests run and results.
5.	Known limitations.
6.	The safest next step.
