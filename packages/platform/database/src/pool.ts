import { Layer, Effect, Context } from 'effect';
import { Pool } from 'pg';

export interface PgPool {
  pool: Pool;
}

export const DbPool = Context.GenericTag<PgPool>('@exitbook/platform-database/DbPool');

function makePool(): Effect.Effect<PgPool, never, never> {
  return Effect.try(() => {
    const pool = new Pool(
      process.env['DB_URL']
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
          },
    );
    pool.on('error', (e) => console.error('[db pool error]', e));
    return { pool };
  }).pipe(Effect.orDie);
}

export const DbPoolLive = Layer.scoped(
  DbPool,
  Effect.acquireRelease(makePool(), ({ pool }) =>
    Effect.tryPromise(() => pool.end()).pipe(Effect.orDie),
  ),
);
