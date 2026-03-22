import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations, type Kysely } from '@exitbook/sqlite';

import * as initialSchema from './migrations/001_initial_schema.js';
import type { TokenMetadataDatabase } from './schema.js';

const logger = getLogger('TokenMetadataDatabase');

/**
 * Create token metadata database instance.
 */
export function createTokenMetadataDatabase(dbPath: string): Result<Kysely<TokenMetadataDatabase>, Error> {
  const result = createSqliteDatabase<TokenMetadataDatabase>(dbPath);
  if (result.isOk()) {
    logger.info(`Connected to token metadata database: ${dbPath}`);
  }
  return result;
}

/**
 * Initialize token metadata database with migrations.
 */
export async function initializeTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  const result = await runMigrations(db, { '001_initial_schema': initialSchema });
  if (result.isOk()) {
    logger.debug('Token metadata database initialized successfully');
  }
  return result;
}

/**
 * Close token metadata database connection.
 */
export async function closeTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  const result = await closeSqliteDatabase(db);
  if (result.isOk()) {
    logger.debug('Token metadata database connection closed');
  }
  return result;
}

/**
 * Clear token metadata database tables (for tests/dev).
 */
export async function clearTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  try {
    logger.info('Clearing token metadata database tables');

    const tablesToDrop = ['reference_platform_mappings', 'token_reference_matches', 'symbol_index', 'token_metadata'];
    for (const table of tablesToDrop) {
      await db.schema.dropTable(table).ifExists().execute();
    }

    logger.info('Token metadata database cleared successfully');
    return ok(undefined);
  } catch (error) {
    logger.error({ error }, 'Error clearing token metadata database');
    return wrapError(error, 'Failed to clear token metadata database');
  }
}

export type TokenMetadataDB = Kysely<TokenMetadataDatabase>;
