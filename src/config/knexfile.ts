import type { Knex } from 'knex';
import { env } from './index';

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'mysql2',
    connection: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
    },
    pool: { min: 2, max: 10 },
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
  production: {
    client: 'mysql2',
    connection: {
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 20 },
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
  },
};

export default config;
