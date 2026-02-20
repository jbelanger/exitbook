/**
 * Database initialization for provider stats database
 *
 * Separate database from transactions.db to persist provider health
 * and circuit breaker state across CLI runs
 */

import { getLogger } from '@exitbook/logger';
import { closeSqliteDatabase, createSqliteDatabase, runMigrations, type Kysely } from '@exitbook/sqlite';
import type { Result } from 'neverthrow';

import * as initialSchema from './migrations/001_initial_schema.js';
import type { ProviderStatsDatabase } from './schema.js';

const logger = getLogger('ProviderStatsDatabase');

/**
 * Create and configure provider stats database instance
 */
export function createProviderStatsDatabase(dbPath: string): Result<Kysely<ProviderStatsDatabase>, Error> {
  const result = createSqliteDatabase<ProviderStatsDatabase>(dbPath);
  if (result.isOk()) {
    logger.info(`Connected to provider stats database: ${dbPath}`);
  }
  return result;
}

/**
 * Initialize provider stats database with migrations
 */
export async function initializeProviderStatsDatabase(db: Kysely<ProviderStatsDatabase>): Promise<Result<void, Error>> {
  const result = await runMigrations(db, { '001_initial_schema': initialSchema });
  if (result.isOk()) {
    logger.debug('Provider stats database initialized successfully');
  }
  return result;
}

/**
 * Close provider stats database connection
 */
export async function closeProviderStatsDatabase(db: Kysely<ProviderStatsDatabase>): Promise<Result<void, Error>> {
  const result = await closeSqliteDatabase(db);
  if (result.isOk()) {
    logger.debug('Provider stats database connection closed');
  }
  return result;
}

/**
 * Type alias for provider stats database
 */
export type ProviderStatsDB = Kysely<ProviderStatsDatabase>;
