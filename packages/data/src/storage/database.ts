import * as fs from 'node:fs';
import * as path from 'node:path';

import { getDataDirectory } from '@exitbook/env';
import { getLogger } from '@exitbook/shared-logger';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { convertValueForSqlite } from '../plugins/sqlite-type-adapter-plugin.js';
import type { DatabaseSchema } from '../schema/database-schema.js';

const logger = getLogger('KyselyDatabase');

/**
 * Wraps better-sqlite3 Database to automatically convert JS types to SQLite-compatible types
 */
function wrapSqliteDatabase(db: Database.Database): Database.Database {
  // Create a proxy that intercepts all method calls
  return new Proxy(db, {
    get(target, prop) {
      const value = target[prop as keyof Database.Database];

      // Intercept prepare() to wrap statements
      if (prop === 'prepare' && typeof value === 'function') {
        return function (sql: string): ReturnType<typeof target.prepare> {
          const statement = (value as typeof target.prepare).call(target, sql);

          // Wrap the statement to convert parameters
          return new Proxy(statement, {
            get(stmtTarget, stmtProp) {
              const stmtValue = stmtTarget[stmtProp as keyof typeof statement];

              // Intercept methods that accept parameters
              if ((stmtProp === 'run' || stmtProp === 'get' || stmtProp === 'all') && typeof stmtValue === 'function') {
                return function (...params: unknown[]) {
                  // Convert parameters before passing to SQLite
                  const convertedParams = params.map(convertValueForSqlite);
                  return (stmtValue as (...args: unknown[]) => unknown).apply(stmtTarget, convertedParams);
                };
              }

              return typeof stmtValue === 'function' ? stmtValue.bind(stmtTarget) : stmtValue;
            },
          });
        };
      }

      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

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

  logger.info(`Connected to SQLite database: ${finalPath}`);

  // Wrap better-sqlite3 database to auto-convert types
  const wrappedDb = wrapSqliteDatabase(sqliteDb);

  // Create Kysely instance with SQLite dialect
  // Note: No CamelCasePlugin - we use snake_case to match database columns exactly
  const kysely = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: wrappedDb,
    }),
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
      'symbol_index',
      'token_metadata',
      'lot_disposals',
      'acquisition_lots',
      'cost_basis_calculations',
      'transaction_links',
      'transactions',
      'external_transaction_data',
      'data_sources',
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
