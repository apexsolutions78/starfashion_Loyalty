# Star Fashion Loyalty Program

A receipt-verified loyalty web application for Star Fashion, a Pakistani retail shop selling ready-made traditional party-wear 3-piece suits.

## Features

- Customer registration and authentication
- Receipt upload and verification
- Points earning and redemption
- Admin review workflow
- Loyalty rules and offers management
- Voucher generation and redemption
- Audit logging and reports

## Tech Stack

- **Backend:** Node.js with TypeScript
- **Database:** MySQL/MariaDB with Knex.js
- **Authentication:** Session-based with Argon2id password hashing
- **File Storage:** Private storage outside public root
- **Logging:** Winston with structured JSON logs

## Quick Start

### Prerequisites

- Node.js 18+ 
- MySQL/MariaDB 10.3+
- npm or yarn

### Installation

```bash
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your database credentials and settings
```

### Database Setup

```bash
# Create database
mysql -u root -e "CREATE DATABASE starfashion_loyalty;"

# Run migrations
npm run migrate
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `POST /api/auth/change-password` - Change password
- `GET /api/auth/me` - Get current user profile

### Claims
- `POST /api/claims` - Submit receipt claim
- `GET /api/claims` - List my claims
- `GET /api/claims/:id` - Get claim details
- `POST /api/claims/:id/resubmit` - Resubmit claim

### Points
- `GET /api/points/balance` - Get points balance
- `GET /api/points/ledger` - Get points ledger

### Redemption
- `POST /api/redemptions/quote` - Get redemption quote
- `POST /api/redemptions` - Create voucher
- `GET /api/redemptions` - List my vouchers

### Admin
- `GET /api/admin/claims` - List pending claims
- `GET /api/admin/claims/:id` - Get claim details
- `POST /api/admin/claims/:id/approve` - Approve claim
- `POST /api/admin/claims/:id/reject` - Reject claim
- `POST /api/admin/claims/:id/request-image` - Request clearer image

### Rules & Offers
- `GET /api/admin/rules` - List loyalty rules
- `POST /api/admin/rules` - Create rule
- `GET /api/offers` - List offers
- `POST /api/offers` - Create offer

## Project Structure

```
src/
  config/          # Configuration and environment
  middleware/      # Express middleware
  models/         # Database models
  routes/         # API routes
  services/       # Business logic
  utils/          # Utility functions
  __tests__/      # Unit tests
migrations/       # Database migrations
docs/            # Documentation
```

## Testing

```bash
npm test              # Run unit tests
npm run test:watch    # Run tests in watch mode
npm run test:integration  # Run integration tests
```

## Deployment

See [docs/deployment-directadmin.md](docs/deployment-directadmin.md) for detailed deployment instructions.

## License

ISC
