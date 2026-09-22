# Architecture

## Overview

Star Fashion Loyalty Program is a standalone web application for managing customer loyalty, receipt verification, and point redemption.

## Components

### Backend (Node.js + Express)
- **Routes:** API endpoint definitions
- **Services:** Business logic
- **Models:** Database queries
- **Middleware:** Authentication, error handling, uploads

### Database (MySQL)
- **Users:** Customer and admin accounts
- **Receipt Claims:** Submitted receipts and status
- **Points Ledger:** Append-only points history
- **Redemption Vouchers:** Discount vouchers
- **Offers:** Promotional offers
- **Loyalty Rules:** Configurable point rules

### File Storage
- **Receipt Images:** Private storage outside web root
- **Thumbnails:** Generated for review interface

## Data Flow

### Customer Journey
1. Customer registers → Creates user account
2. Customer uploads receipt → Creates claim (PENDING_REVIEW)
3. Admin reviews claim → Approves/rejects
4. On approval → Points credited to ledger
5. Customer requests redemption → Voucher created
6. Customer presents voucher → Staff marks as used

### Points Flow
```
Receipt Upload → Claim Created → Admin Review → Points Credited
                                                      ↓
                                              Points Ledger Entry
                                                      ↓
                                              Balance Updated
                                                      ↓
                                              Voucher Created → Points Deducted
```

## Security Architecture

### Authentication
- Session-based authentication
- HTTP-only cookies
- CSRF protection

### Authorization
- Role-based access control
- Customer, Reviewer, Manager, Master Admin
- Resource-level authorization

### Data Protection
- Passwords hashed with Argon2id
- Receipt images in private storage
- Sensitive data not logged
- Environment variables for secrets

## API Design

### Customer Endpoints
- Authentication (register, login, logout)
- Claims (submit, view, resubmit)
- Points (balance, ledger)
- Redemption (quote, create voucher)

### Admin Endpoints
- Review queue (list, approve, reject)
- Rules management (CRUD, activate)
- Offers management (CRUD, activate)
- Reports and audit logs

## Deployment Architecture

```
DirectAdmin Server
├── Node.js Application (PM2)
│   ├── Express Server
│   └── File Upload Handler
├── MySQL Database
├── Private Storage (receipts)
└── Logs
```
