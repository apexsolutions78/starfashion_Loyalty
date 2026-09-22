# DirectAdmin Deployment Guide

## Prerequisites

1. DirectAdmin access with Node.js support
2. MySQL/MariaDB database
3. SSH access (optional but recommended)
4. Node.js 18+ installed on server

## Step 1: Create Subdomain

1. Log into DirectAdmin
2. Go to **Account Manager** > **Subdomains**
3. Create `loyalty.starfashionofficial.com`
4. Note the document root path

## Step 2: Create Database

1. Go to **Advanced Features** > **MySQL Management**
2. Create a new database: `starfashion_loyalty`
3. Create a database user with full privileges
4. Note the database credentials

## Step 3: Upload Application

### Via SSH:
```bash
cd /home/username/apps/loyalty-app
git clone <repository-url> .
```

### Via File Manager:
1. Upload all files to `/home/username/apps/loyalty-app/`
2. Extract if uploaded as zip

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
NODE_ENV=production
PORT=3000
APP_URL=https://loyalty.starfashionofficial.com
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=your_db_user
DATABASE_PASSWORD=your_db_password
DATABASE_NAME=starfashion_loyalty
SESSION_SECRET=your-long-random-secret
UPLOAD_DIR=/home/username/private-storage/receipts
```

## Step 5: Install Dependencies

```bash
npm ci --omit=dev
```

## Step 6: Run Migrations

```bash
npm run migrate
```

## Step 7: Create First Admin

```bash
node -e "
const { db } = require('./dist/config/database');
const { hashPassword } = require('./dist/utils/crypto');

async function createAdmin() {
  const hash = await hashPassword('Admin123!');
  await db('users').insert({
    email: 'admin@starfashionofficial.com',
    mobile: '+923001234567',
    password_hash: hash,
    role: 'master_admin',
    status: 'active',
    email_verified: true,
    mobile_verified: true
  });
  console.log('Admin created successfully');
  process.exit(0);
}

createAdmin().catch(console.error);
"
```

## Step 8: Configure Process Manager

### Using PM2:
```bash
npm install -g pm2
pm2 start dist/server.js --name loyalty-app
pm2 save
pm2 startup
```

### Using DirectAdmin Node.js Plugin:
1. Go to **Extra Features** > **Node.js Apps**
2. Create new application
3. Set application root to `/home/username/apps/loyalty-app`
4. Set startup file to `dist/server.js`
5. Set Node.js version to 18+

## Step 9: Configure HTTPS

1. Go to **SSL Certificates** in DirectAdmin
2. Let's Encrypt: Click **Get automatic certificate from Let's Encrypt**
3. Select `loyalty.starfashionofficial.com`
4. Enable **Force SSL with HTTP redirect**

## Step 10: Configure Private Storage

```bash
mkdir -p /home/username/private-storage/receipts
chmod 750 /home/username/private-storage/receipts
```

## Step 11: Set Up Cron Jobs

### Voucher Expiry:
```bash
# Run daily at midnight
0 0 * * * cd /home/username/apps/loyalty-app && node dist/scripts/expire-vouchers.js
```

### Database Backup:
```bash
# Run daily at 2 AM
0 2 * * * mysqldump -u user -p password starfashion_loyalty | gzip > /home/username/backups/loyalty-$(date +\%Y\%m\%d).sql.gz
```

## Step 12: Configure Logs

```bash
mkdir -p /home/username/logs
chmod 750 /home/username/logs
```

## Step 13: Test Deployment

1. Visit `https://loyalty.starfashionofficial.com/health`
2. Should return `{"status":"ok","timestamp":"..."}`
3. Test registration and login
4. Test receipt upload

## Troubleshooting

### Application Won't Start
- Check logs: `pm2 logs loyalty-app`
- Verify Node.js version: `node --version`
- Check file permissions

### Database Connection Error
- Verify credentials in `.env`
- Check MySQL service is running
- Test connection: `mysql -u user -p database_name`

### Upload Errors
- Check `UPLOAD_DIR` exists and is writable
- Verify `MAX_UPLOAD_MB` setting
- Check disk space

### Session Errors
- Verify `SESSION_SECRET` is set
- Check cookie settings for HTTPS

## Backup and Restore

### Backup:
```bash
# Database
mysqldump -u user -p password starfashion_loyalty > backup.sql

# Files
tar -czf loyalty-backup.tar.gz /home/username/apps/loyalty-app /home/username/private-storage
```

### Restore:
```bash
# Database
mysql -u user -p password starfashion_loyalty < backup.sql

# Files
tar -xzf loyalty-backup.tar.gz -C /
```

## Rollback

```bash
# Stop application
pm2 stop loyalty-app

# Restore from backup
mysql -u user -p password starfashion_loyalty < backup.sql
tar -xzf loyalty-backup.tar.gz -C /

# Restart
pm2 start loyalty-app
```
