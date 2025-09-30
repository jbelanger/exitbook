import * as fs from 'node:fs';
import * as path from 'node:path';

import { getLogger } from '@exitbook/shared-logger';
import Database from 'better-sqlite3';
import { CamelCasePlugin, Kysely, SqliteDialect } from 'kysely';

import type { DatabaseSchema } from '../schema/database-schema.js';

const logger = getLogger('KyselyDatabase');

/**
 * Create and configure database instance
 */
export function createDatabase(dbPath?: string): Kysely<DatabaseSchema> {
  const defaultPath = path.join(process.cwd(), 'data', 'transactions.db');
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

  logger.info(`Connected to SQLite database using Kysely: ${finalPath}`);

  // Create Kysely instance with SQLite dialect and date conversion plugin
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqliteDb,
    }),
    plugins: [new CamelCasePlugin()],
  });

  return kysely;
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
      'balance_verifications',
      'balance_snapshots',
      'transactions',
      'external_transaction_data',
      'import_sessions',
      'wallet_addresses',
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
    logger.info('Database connection closed');
  } catch (error) {
    logger.error({ error }, 'Error closing database');
    throw error;
  }
}

/**
 * Type-safe database instance type
 */
export type KyselyDB = Kysely<DatabaseSchema>;
