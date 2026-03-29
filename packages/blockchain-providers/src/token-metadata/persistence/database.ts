import type { Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations, type Kysely } from '@exitbook/sqlite';

import { down as initialSchemaDown, up as initialSchemaUp } from './migrations/001_initial_schema.js';
import type { TokenMetadataDatabase } from './schema.js';

const logger = getLogger('TokenMetadataDatabase');

/**
 * Create token metadata database instance.
 */
export function createTokenMetadataDatabase(dbPath: string): Result<Kysely<TokenMetadataDatabase>, Error> {
  const result = createSqliteDatabase<TokenMetadataDatabase>(dbPath);
  if (result.isOk()) {
    logger.info('Connected to token metadata database');
  }
  return result;
}

/**
 * Initialize token metadata database with migrations.
 */
export async function initializeTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  const result = await runMigrations(db, {
    '001_initial_schema': {
      up: initialSchemaUp,
      down: initialSchemaDown,
    },
  });
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

export type TokenMetadataDB = Kysely<TokenMetadataDatabase>;
