/**
 * Database initialization for provider stats database
 *
 * Separate database from transactions.db to persist provider health
 * and circuit breaker state across CLI runs
 */

import * as fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isErrorWithMessage, wrapError } from '@exitbook/core';
import { getDataDirectory } from '@exitbook/env';
import { getLogger } from '@exitbook/logger';
import Database from 'better-sqlite3';
import { FileMigrationProvider, Kysely, Migrator, SqliteDialect } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ProviderStatsDatabase } from './schema.js';

const logger = getLogger('ProviderStatsDatabase');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure provider stats database instance
 */
export function createProviderStatsDatabase(dbPath?: string): Result<Kysely<ProviderStatsDatabase>, Error> {
  try {
    const finalPath = dbPath || path.join(getDataDirectory(), 'providers.db');

    // Ensure data directory exists
    const dataDir = path.dirname(finalPath);
    if (finalPath !== ':memory:' && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const sqliteDb = new Database(finalPath);

    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.pragma('cache_size = 10000');
    sqliteDb.pragma('temp_store = memory');

    logger.info(`Connected to provider stats database: ${finalPath}`);

    const kysely = new Kysely<ProviderStatsDatabase>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    return ok(kysely);
  } catch (error) {
    logger.error({ error }, 'Error creating provider stats database');
    return wrapError(error, 'Failed to create provider stats database');
  }
}

/**
 * Initialize provider stats database with migrations
 */
export async function initializeProviderStatsDatabase(
  db: Kysely<ProviderStatsDatabase>,
  migrationsPath?: string
): Promise<Result<void, Error>> {
  try {
    const defaultMigrationsPath = path.join(__dirname, './migrations');
    const finalMigrationsPath = migrationsPath || defaultMigrationsPath;

    logger.debug(`Running migrations from: ${finalMigrationsPath}`);

    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs: fsPromises,
        path,
        migrationFolder: finalMigrationsPath,
      }),
    });

    const { error, results } = await migrator.migrateToLatest();

    if (results && results.length > 0) {
      for (const result of results) {
        if (result.status === 'Success') {
          logger.debug(`Migration "${result.migrationName}" executed successfully`);
        } else if (result.status === 'Error') {
          logger.error(`Migration "${result.migrationName}" failed`);
        }
      }
    } else {
      logger.debug('No pending migrations');
    }

    if (error) {
      const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown migration error';
      logger.error({ err: error }, 'Migration failed');
      return err(new Error(errorMessage));
    }

    logger.debug('Provider stats database initialized successfully');
    return ok();
  } catch (error) {
    logger.error({ err: error }, 'Error initializing provider stats database');
    return wrapError(error, 'Failed to initialize provider stats database');
  }
}

/**
 * Close provider stats database connection
 */
export async function closeProviderStatsDatabase(db: Kysely<ProviderStatsDatabase>): Promise<Result<void, Error>> {
  try {
    await db.destroy();
    logger.debug('Provider stats database connection closed');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error closing provider stats database');
    return wrapError(error, 'Failed to close provider stats database');
  }
}

/**
 * Type alias for provider stats database
 */
export type ProviderStatsDB = Kysely<ProviderStatsDatabase>;
