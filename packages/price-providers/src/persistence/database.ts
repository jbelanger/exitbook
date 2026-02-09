/**
 * Database initialization for prices database
 *
 * Separate database from transactions.db to persist across dev cycles
 */

import * as fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isErrorWithMessage, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import Database from 'better-sqlite3';
import { FileMigrationProvider, Kysely, Migrator, SqliteDialect } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDatabase } from './schema.js';

const logger = getLogger('PricesDatabase');

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure prices database instance
 */
export function createPricesDatabase(dbPath: string): Result<Kysely<PricesDatabase>, Error> {
  try {
    const finalPath = dbPath;

    // Ensure data directory exists
    const dataDir = path.dirname(finalPath);
    if (finalPath !== ':memory:' && !fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create better-sqlite3 database instance
    const sqliteDb = new Database(finalPath);

    // Configure SQLite pragmas
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.pragma('cache_size = 10000');
    sqliteDb.pragma('temp_store = memory');

    logger.info(`Connected to prices database: ${finalPath}`);

    // Create Kysely instance
    const kysely = new Kysely<PricesDatabase>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    return ok(kysely);
  } catch (error) {
    logger.error({ error }, 'Error creating prices database');
    return wrapError(error, 'Failed to create prices database');
  }
}

/**
 * Initialize prices database with migrations
 */
export async function initializePricesDatabase(
  db: Kysely<PricesDatabase>,
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
      logger.error({ error }, 'Migration failed');
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- prefer message extraction
      const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
      return err(new Error(errorMessage));
    }

    logger.debug('Prices database initialized successfully');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error initializing prices database');
    return wrapError(error, 'Failed to initialize prices database');
  }
}

/**
 * Close prices database connection
 */
export async function closePricesDatabase(db: Kysely<PricesDatabase>): Promise<Result<void, Error>> {
  try {
    await db.destroy();
    logger.debug('Prices database connection closed');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error closing prices database');
    return wrapError(error, 'Failed to close prices database');
  }
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
