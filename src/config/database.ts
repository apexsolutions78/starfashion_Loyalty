import knex from 'knex';
import config from './knexfile';
import { env } from './index';

const environment = env.NODE_ENV || 'development';
const connectionConfig = config[environment] || config.development;

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
