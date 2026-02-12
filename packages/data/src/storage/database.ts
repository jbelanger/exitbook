import * as fs from 'node:fs';
import * as path from 'node:path';

import { getLogger } from '@exitbook/logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { sqliteTypeAdapterPlugin } from '../plugins/sqlite-type-adapter-plugin.js';
import type { DatabaseSchema } from '../schema/database-schema.js';

const logger = getLogger('KyselyDatabase');

/**
 * Create and configure database instance
 */
export function createDatabase(dbPath: string): Kysely<DatabaseSchema> {
  const finalPath = dbPath;

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
