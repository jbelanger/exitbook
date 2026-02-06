import * as fs from 'node:fs';
import * as path from 'node:path';

import { getDataDirectory } from '@exitbook/env';
import { getLogger } from '@exitbook/logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { sqliteTypeAdapterPlugin } from '../plugins/sqlite-type-adapter-plugin.js';
import type { DatabaseSchema } from '../schema/database-schema.js';

const logger = getLogger('KyselyDatabase');

/**
 * Create and configure database instance
 */
export function createDatabase(dbPath?: string): Kysely<DatabaseSchema> {
  const defaultPath = path.join(getDataDirectory(), 'transactions.db');
  const finalPath = dbPath || defaultPath;

  // Ensure data directory exists
  const dataDir = path.dirname(finalPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create better-sqlite3 database instance
  const sqliteDb = new Database(finalPath);

  // Configure SQLite pragmas for optimal performance and data integrity
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('synchronous = NORMAL');
  sqliteDb.pragma('cache_size = 10000');
  sqliteDb.pragma('temp_store = memory');

  logger.debug(`Connected to SQLite database: ${finalPath}`);

  // Create Kysely instance with SQLite dialect
  // Note: No CamelCasePlugin - we use snake_case to match database columns exactly
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqliteDb,
    }),
  });

  return kysely.withPlugin(sqliteTypeAdapterPlugin);
}

/**
 * Clear and reinitialize the Kysely database
 * Drops all tables and recreates them
 */
export async function clearDatabase(db: Kysely<DatabaseSchema>): Promise<void> {
  try {
    logger.info('Clearing database tables');

    // Drop tables in correct order (respecting foreign key constraints)
    const tablesToDrop = [
      'symbol_index',
      'token_metadata',
      'lot_disposals',
      'lot_transfers',
      'acquisition_lots',
      'cost_basis_calculations',
      'transaction_links',
      'transactions',
      'raw_transactions',
      'import_sessions',
      'accounts',
      'users',
    ];

    for (const table of tablesToDrop) {
      await db.schema.dropTable(table).ifExists().execute();
    }

    // Note: Table creation should be handled by migration system
    // This function only clears existing data
    logger.info('Database cleared successfully');
  } catch (error) {
    logger.error({ error }, 'Error clearing database');
    throw error;
  }
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
