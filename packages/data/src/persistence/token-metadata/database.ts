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

import { sqliteTypeAdapterPlugin } from '../../plugins/sqlite-type-adapter-plugin.js';

import type { TokenMetadataDatabase } from './schema.js';

const logger = getLogger('TokenMetadataDatabase');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure token metadata database instance.
 */
export function createTokenMetadataDatabase(dbPath: string): Result<Kysely<TokenMetadataDatabase>, Error> {
  try {
    const finalPath = dbPath;

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

    logger.info(`Connected to token metadata database: ${finalPath}`);

    const kysely = new Kysely<TokenMetadataDatabase>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    return ok(kysely.withPlugin(sqliteTypeAdapterPlugin));
  } catch (error) {
    logger.error({ error }, 'Error creating token metadata database');
    return wrapError(error, 'Failed to create token metadata database');
  }
}

/**
 * Initialize token metadata database with migrations.
 */
export async function initializeTokenMetadataDatabase(
  db: Kysely<TokenMetadataDatabase>,
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
      const errorMessage = isErrorWithMessage(error) ? error.message : 'Unknown migration error';
      return err(new Error(errorMessage));
    }

    logger.debug('Token metadata database initialized successfully');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error initializing token metadata database');
    return wrapError(error, 'Failed to initialize token metadata database');
  }
}

/**
 * Close token metadata database connection.
 */
export async function closeTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  try {
    await db.destroy();
    logger.debug('Token metadata database connection closed');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error closing token metadata database');
    return wrapError(error, 'Failed to close token metadata database');
  }
}

/**
 * Clear token metadata database tables (for tests/dev).
 */
export async function clearTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  try {
    logger.info('Clearing token metadata database tables');

    const tablesToDrop = ['symbol_index', 'token_metadata'];
    for (const table of tablesToDrop) {
      await db.schema.dropTable(table).ifExists().execute();
    }

    logger.info('Token metadata database cleared successfully');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error clearing token metadata database');
    return wrapError(error, 'Failed to clear token metadata database');
  }
}

export type TokenMetadataDB = Kysely<TokenMetadataDatabase>;
