import { getLogger } from '@exitbook/logger';
import { createSqliteDatabase, type Kysely } from '@exitbook/sqlite';

import type { DatabaseSchema } from '../schema/database-schema.js';

const logger = getLogger('KyselyDatabase');

/**
 * Create and configure database instance
 */
export function createDatabase(dbPath: string): Kysely<DatabaseSchema> {
  const result = createSqliteDatabase<DatabaseSchema>(dbPath);
  if (result.isErr()) {
    throw result.error;
  }

  logger.debug(`Connected to SQLite database: ${dbPath}`);
  return result.value;
}

/**
 * Utility function to close the Kysely database connection
 */
export async function closeDatabase(db: Kysely<DatabaseSchema>): Promise<void> {
  try {
    await db.destroy();
    logger.debug('Database connection closed');
  } catch (error) {
    logger.error({ error }, 'Error closing database');
    throw error;
  }
}

/**
 * Type-safe database instance type
 */
export type KyselyDB = Kysely<DatabaseSchema>;
