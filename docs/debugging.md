# Debugging Guide

## Common Commands

### Application Status
```bash
# Check if running
pm2 status

# View logs
pm2 logs loyalty-app

# Restart
pm2 restart loyalty-app
```

### Database
```bash
# Connect to MySQL
mysql -u user -p database_name

# Check tables
SHOW TABLES;

# Check migration status
SELECT * FROM knex_migrations ORDER BY batch DESC LIMIT 5;
```

### File System
```bash
# Check disk usage
df -h

# Check upload directory
ls -la /home/username/private-storage/receipts/

# Check logs
ls -la /home/username/logs/
```

## Common Issues

### 1. Database Connection Refused
```bash
# Check MySQL service
systemctl status mysql

# Test connection
mysql -u user -p -h localhost database_name
```

### 2. Port Already in Use
```bash
# Find process on port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### 3. Permission Denied
```bash
# Fix upload directory permissions
chmod -R 750 /home/username/private-storage

# Fix log directory permissions
chmod -R 750 /home/username/logs
```

### 4. Migration Errors
```bash
# Check pending migrations
npm run migrate:status

# Rollback last batch
npm run migrate:rollback

# Force unlock (if locked)
npx knex migrate:unlock --knexfile src/config/knexfile.ts
```

### 5. Memory Issues
```bash
# Check memory usage
free -m

# Restart with increased memory
pm2 start dist/server.js --name loyalty-app --max-memory-restart 300M
```

## Log Locations

- **Application Logs:** `logs/combined.log`, `logs/error.log`
- **PM2 Logs:** `~/.pm2/logs/`
- **Access Logs:** DirectAdmin access logs
- **Error Logs:** DirectAdmin error logs

## Database Queries

### Check User
```sql
SELECT id, email, role, status FROM users WHERE email = 'user@example.com';
```

### Check Claims
```sql
SELECT * FROM receipt_claims WHERE customer_id = 'uuid' ORDER BY created_at DESC;
```

### Check Points Balance
```sql
SELECT SUM(points) as balance FROM points_ledger WHERE customer_id = 'uuid';
```

### Check Vouchers
```sql
SELECT * FROM redemption_vouchers WHERE customer_id = 'uuid' ORDER BY created_at DESC;
```

## Testing Endpoints

### Health Check
```bash
curl https://loyalty.starfashionofficial.com/health
```

### Test Registration
```bash
curl -X POST https://loyalty.starfashionofficial.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","mobile":"+923001234567","password":"Pass123!","fullName":"Test User","loyaltyConsent":true}'
```

## Performance Monitoring

### Check Response Time
```bash
curl -w "@curl-format.txt" -o /dev/null -s https://loyalty.starfashionofficial.com/health
```

### Check Database Performance
```sql
SHOW PROCESSLIST;
SHOW ENGINE INNODB STATUS;
```

## Security Checks

### Check SSL Certificate
```bash
openssl s_client -connect loyalty.starfashionofficial.com:443
```

### Check Headers
```bash
curl -I https://loyalty.starfashionofficial.com/health
```
