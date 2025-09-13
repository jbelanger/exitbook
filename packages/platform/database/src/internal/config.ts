import type { PoolConfig } from 'pg';

export function getDatabaseConfig(): PoolConfig {
  return process.env['DB_URL']
    ? {
        connectionString: process.env['DB_URL'],
        ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined,
      }
    : {
        database: process.env['DB_NAME'] ?? 'postgres',
        host: process.env['DB_HOST'] ?? 'localhost',
        max: Number(process.env['DB_POOL_MAX'] ?? '10'),
        password: process.env['DB_PASSWORD'] ?? 'postgres',
        port: Number(process.env['DB_PORT'] ?? '5432'),
        ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined,
        user: process.env['DB_USER'] ?? 'postgres',
      };
}
