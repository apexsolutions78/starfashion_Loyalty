import type { Knex } from 'knex';
import fs from 'fs';
import path from 'path';

const rootDir = path.join(__dirname, '..', '..');

function buildMysqlSsl(): Record<string, unknown> | undefined {
  const caPath = process.env.DATABASE_SSL_CA;
  if (caPath) {
    return { ca: fs.readFileSync(caPath), rejectUnauthorized: true };
  }
  if (process.env.DATABASE_SSL === 'true') {
    return { rejectUnauthorized: true };
  }
  // No TLS requested — do not silently disable certificate verification
  return undefined;
}

const mysqlSsl = buildMysqlSsl();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: path.join(rootDir, 'data', 'loyalty.db'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(rootDir, 'migrations'),
      extension: 'ts',
    },
  },
  test: {
    client: 'better-sqlite3',
    connection: {
      filename: path.join(rootDir, 'data', 'test-loyalty.db'),
    },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, done: (err?: Error) => void) => {
        conn.pragma('foreign_keys = ON');
        done();
      },
    },
    migrations: {
      directory: path.join(rootDir, 'migrations'),
      extension: 'ts',
    },
  },
  production: {
    client: 'mysql2',
    connection: {
      host: process.env.DATABASE_HOST || 'localhost',
      port: Number(process.env.DATABASE_PORT) || 3306,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      ...(mysqlSsl ? { ssl: mysqlSsl } : {}),
    },
    pool: { min: 2, max: 20 },
    migrations: {
      directory: path.join(rootDir, 'migrations'),
      extension: 'ts',
    },
  },
};

export default config;
