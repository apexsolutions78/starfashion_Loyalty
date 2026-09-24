const Database = require('better-sqlite3');
const argon2 = require('argon2');
const path = require('path');

const dbPath = process.env.SEED_ADMIN_DB_PATH || path.join(__dirname, '..', 'data', 'loyalty.db');
const db = new Database(dbPath);

async function seed() {
  const isProd = process.env.NODE_ENV === 'production';
  const password = process.env.SEED_ADMIN_PASSWORD;
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@starfashion.com').toLowerCase().trim();
  const mobile = process.env.SEED_ADMIN_MOBILE || '+923000000000';
  const fullName = process.env.SEED_ADMIN_NAME || 'System Administrator';
  const department = process.env.SEED_ADMIN_DEPARTMENT || 'IT';

  if (isProd && (!password || password.length < 8)) {
    console.error('Set SEED_ADMIN_PASSWORD (min 8 chars) to seed the admin in production.');
    db.close();
    process.exit(1);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('SEED_ADMIN_EMAIL must be a valid email address.');
    db.close();
    process.exit(1);
  }

  const effectivePassword = password || 'Admin123!';
  if (!password && !isProd) {
    console.warn('SEED_ADMIN_PASSWORD not set — using development default (do not use in production).');
  }

  const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.role !== 'master_admin') {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('master_admin', existing.id);
      console.log('Existing admin role corrected to master_admin.');
    } else {
      console.log('Admin user already exists — skipping.');
    }
    ensureProfile(existing.id, fullName, department);
    db.close();
    return;
  }

  const hash = await argon2.hash(effectivePassword, { type: argon2.argon2id });

  db.prepare(`
    INSERT INTO users (role, email, mobile, password_hash, status, email_verified, mobile_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('master_admin', email, mobile, hash, 'active', 1, 1);

  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  ensureProfile(row.id, fullName, department);

  console.log(`Admin seeded: ${email} (password from SEED_ADMIN_PASSWORD)`);
  db.close();
}

function ensureProfile(userId, fullName, department) {
  const has = db.prepare('SELECT id FROM admin_profiles WHERE user_id = ?').get(userId);
  if (!has) {
    db.prepare('INSERT INTO admin_profiles (id, user_id, full_name, department) VALUES (?, ?, ?, ?)').run(
      require('crypto').randomUUID(),
      userId,
      fullName,
      department,
    );
    console.log('Admin profile created.');
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
