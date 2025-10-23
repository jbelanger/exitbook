import * as fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getErrorMessage, wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/shared-logger';
import Database from 'better-sqlite3';
import { Kysely, Migrator, SqliteDialect, FileMigrationProvider } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { TokenMetadataDatabase } from './database-schema.js';

const logger = getLogger('TokenMetadataDatabase');

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure token metadata cache database
 */
export function createTokenMetadataDatabase(dbPath?: string): Result<Kysely<TokenMetadataDatabase>, Error> {
  try {
    const defaultPath = path.join(process.cwd(), 'data', 'token-metadata.db');
    const finalPath = dbPath || defaultPath;

    const dataDir = path.dirname(finalPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const sqliteDb = new Database(finalPath);

    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.pragma('cache_size = 5000');
    sqliteDb.pragma('temp_store = memory');

    logger.info(`Connected to token metadata cache: ${finalPath}`);

    const kysely = new Kysely<TokenMetadataDatabase>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });

    return ok(kysely);
  } catch (error) {
    logger.error({ error }, 'Error creating token metadata database');
    return wrapError(error, 'Failed to create token metadata database');
  }
}

/**
 * Initialize token metadata database with migrations
 */
export async function initializeTokenMetadataDatabase(
  db: Kysely<TokenMetadataDatabase>,
  migrationsPath?: string
): Promise<Result<void, Error>> {
  try {
    const defaultMigrationsPath = path.join(__dirname, './migrations');
    const finalMigrationsPath = migrationsPath || defaultMigrationsPath;

    logger.info(`Running migrations from: ${finalMigrationsPath}`);

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
          logger.info(`Migration "${result.migrationName}" executed successfully`);
        } else if (result.status === 'Error') {
          logger.error(`Migration "${result.migrationName}" failed`);
        }
      }
    } else {
      logger.info('No pending migrations');
    }

    if (error) {
      logger.error({ error }, 'Migration failed');
      const errorMessage = getErrorMessage(error);
      return err(new Error(errorMessage));
    }

    logger.info('Token metadata database initialized successfully');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error initializing token metadata database');
    return wrapError(error, 'Failed to initialize token metadata database');
  }
}

/**
 * Close the token metadata database connection
 */
export async function closeTokenMetadataDatabase(db: Kysely<TokenMetadataDatabase>): Promise<Result<void, Error>> {
  try {
    await db.destroy();
    logger.info('Token metadata database connection closed');
    return ok();
  } catch (error) {
    logger.error({ error }, 'Error closing token metadata database');
    return wrapError(error, 'Failed to close token metadata database');
  }
}

/**
 * Clear token metadata database (for testing/dev)
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
