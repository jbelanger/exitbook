import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase } from '@exitbook/sqlite';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { DatabaseSchema } from '../schema/database-schema.js';

import type { KyselyDB } from './db-types.js';
import { runMigrations } from './migrations.js';

const logger = getLogger('DatabaseInitialization');
export type { KyselyDB } from './db-types.js';

/**
 * Create and configure database instance.
 */
export function createDatabase(dbPath: string): Result<KyselyDB, Error> {
  return createSqliteDatabase<DatabaseSchema>(dbPath);
}

/**
 * Close database connection.
 */
export async function closeDatabase(db: KyselyDB): Promise<Result<void, Error>> {
  return closeSqliteDatabase(db);
}

/**
 * Initialize database with migrations
 */
export async function initializeDatabase(dbPath: string): Promise<Result<KyselyDB, Error>> {
  logger.debug('Initializing database...');

  const databaseResult = createDatabase(dbPath);
  if (databaseResult.isErr()) {
    return databaseResult;
  }

  const database = databaseResult.value;

  // Run migrations to ensure schema is up to date
  const migrationResult = await runMigrations(database);
  if (migrationResult.isErr()) {
    const closeResult = await closeDatabase(database);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close database after migration failure');
    }
    return err(migrationResult.error);
  }

  logger.debug('Database initialization completed');
  return ok(database);
}
