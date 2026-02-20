/**
 * Database initialization for prices database
 *
 * Separate database from transactions.db to persist across dev cycles
 */

import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations, type Kysely } from '@exitbook/sqlite';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import * as initialSchema from './migrations/001_initial_schema.js';
import type { PricesDatabase } from './schema.js';

const logger = getLogger('PricesDatabase');

/**
 * Create and configure prices database instance
 */
export function createPricesDatabase(dbPath: string): Result<Kysely<PricesDatabase>, Error> {
  const result = createSqliteDatabase<PricesDatabase>(dbPath);
  if (result.isOk()) {
    logger.info(`Connected to prices database: ${dbPath}`);
  }
  return result;
}

/**
 * Initialize prices database with migrations
 */
export async function initializePricesDatabase(db: Kysely<PricesDatabase>): Promise<Result<void, Error>> {
  const result = await runMigrations(db, { '001_initial_schema': initialSchema });
  if (result.isOk()) {
    logger.debug('Prices database initialized successfully');
  }
  return result;
}

/**
 * Close prices database connection
 */
export async function closePricesDatabase(db: Kysely<PricesDatabase>): Promise<Result<void, Error>> {
  const result = await closeSqliteDatabase(db);
  if (result.isOk()) {
    logger.debug('Prices database connection closed');
  }
  return result;
}

/**
 * Clear prices database (for testing/dev)
 */
export async function clearPricesDatabase(db: Kysely<PricesDatabase>): Promise<Result<void, Error>> {
  try {
    logger.info('Clearing prices database tables');

    const tablesToDrop = ['prices', 'provider_coin_mappings', 'providers'];

    for (const table of tablesToDrop) {
      await db.schema.dropTable(table).ifExists().execute();
    }

    logger.info('Prices database cleared successfully');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error clearing prices database');
    return wrapError(error, 'Failed to clear prices database');
  }
}

/**
 * Type alias for prices database
 */
export type PricesDB = Kysely<PricesDatabase>;
