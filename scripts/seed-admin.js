require('ts-node/register');
require('dotenv').config();

const argon2 = require('argon2');
const { randomUUID } = require('crypto');
const path = require('path');

const envName = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const knexConfig = require(path.join(__dirname, '..', 'src', 'config', 'knexfile.ts')).default;
const config = { ...knexConfig[envName] };

// Back-compat: allow pointing at a specific SQLite file without editing knexfile.
if (process.env.SEED_ADMIN_DB_PATH && config.client === 'better-sqlite3') {
  config.connection = { ...(config.connection || {}), filename: process.env.SEED_ADMIN_DB_PATH };
}

const db = require('knex')(config);

async function ensureProfile(userId, fullName, department) {
  const has = await db('admin_profiles').where('user_id', userId).first();
  if (has) return false;

  await db('admin_profiles').insert({
    id: randomUUID(),
    user_id: userId,
    full_name: fullName,
    department,
  });
  console.log('Admin profile created.');
  return true;
}

async function seed() {
  const isProd = process.env.NODE_ENV === 'production';
  const password = process.env.SEED_ADMIN_PASSWORD;
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@starfashion.com').toLowerCase().trim();
  const mobile = process.env.SEED_ADMIN_MOBILE || '+923000000000';
  const fullName = process.env.SEED_ADMIN_NAME || 'System Administrator';
  const department = process.env.SEED_ADMIN_DEPARTMENT || 'IT';

  if (isProd && (!password || password.length < 8)) {
    console.error('Set SEED_ADMIN_PASSWORD (min 8 chars) to seed the admin in production.');
    await db.destroy();
    process.exit(1);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('SEED_ADMIN_EMAIL must be a valid email address.');
    await db.destroy();
    process.exit(1);
  }

  if (!/^\+?[0-9]{10,20}$/.test(mobile)) {
    console.error('SEED_ADMIN_MOBILE must be 10-20 digits, optional leading +.');
    await db.destroy();
    process.exit(1);
  }

  const effectivePassword = password || 'Admin123!';
  if (!password && !isProd) {
    console.warn('SEED_ADMIN_PASSWORD not set — using development default (do not use in production).');
  }

  const existing = await db('users').where('email', email).first();
  if (existing) {
    if (existing.role !== 'master_admin') {
      await db('users').where('id', existing.id).update({ role: 'master_admin', updated_at: new Date() });
      console.log('Existing admin role corrected to master_admin.');
    } else {
      console.log('Admin user already exists — skipping creation.');
    }
    await ensureProfile(existing.id, fullName, department);
    await db.destroy();
    return;
  }

  const clash = await db('users').where('mobile', mobile).first();
  if (clash) {
    console.error(`SEED_ADMIN_MOBILE ${mobile} already belongs to another account.`);
    await db.destroy();
    process.exit(1);
  }

  const hash = await argon2.hash(effectivePassword, { type: argon2.argon2id });

  const userId = randomUUID();
  // No `.returning()` — MySQL ignores RETURNING, so re-select by the id we set.
  await db('users').insert({
    id: userId,
    role: 'master_admin',
    email,
    mobile,
    password_hash: hash,
    status: 'active',
    email_verified: true,
    mobile_verified: true,
  });

  await ensureProfile(userId, fullName, department);

  console.log(`Admin seeded: ${email} (driver ${config.client}, password from SEED_ADMIN_PASSWORD)`);
  await db.destroy();
}

seed().catch(async (err) => {
  console.error(err);
  try {
    await db.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
