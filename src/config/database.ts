import knex from 'knex';
import config from './knexfile';
import { env } from './index';
import fs from 'fs';
import path from 'path';

const environment = env.NODE_ENV || 'development';
const connectionConfig = config[environment] || config.development;

// Ensure data directory exists for SQLite
if (connectionConfig.client === 'better-sqlite3') {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export const db = knex(connectionConfig);

export async function testConnection(): Promise<boolean> {
  try {
    await db.raw('SELECT 1');
    console.log('Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  await db.destroy();
}
