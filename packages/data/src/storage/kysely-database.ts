import * as fs from 'node:fs';
import * as path from 'node:path';

import { getLogger } from '@crypto/shared-logger';
import Database from 'better-sqlite3';
import { Decimal } from 'decimal.js';
import { Kysely, SqliteDialect } from 'kysely';

import type { DatabaseSchema } from '../schema/database-schema.ts';

import { IsoStringToDatePlugin } from './iso-string-to-date-plugin.ts';

const logger = getLogger('KyselyDatabase');

/**
 * Custom type transformer for Decimal.js values
 * Stores Decimal values as TEXT in database for precision
 */
export const decimalTransformer = {
  from: (value: string | undefined): Decimal | undefined => {
    if (value === undefined || value === null) return undefined;
    return new Decimal(value);
  },
  to: (value: Decimal | string | number | undefined): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (value instanceof Decimal) return value.toString();
    if (typeof value === 'string') return value;
    return new Decimal(value).toString();
  },
};

/**
 * Custom type transformer for JSON fields
 * Handles serialization/deserialization of JSON data
 */
export const jsonTransformer = {
  from: (value: string | undefined): unknown => {
    if (value === undefined || value === null) return undefined;
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn({ error, value }, 'Failed to parse JSON value');
      return value; // Return raw string if JSON parsing fails
    }
  },
  to: (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    return JSON.stringify(value);
  },
};

/**
 * Custom type transformer for boolean values stored as INTEGER
 * SQLite stores booleans as 0/1 integers
 */
export const booleanTransformer = {
  from: (value: number | undefined): boolean | undefined => {
    if (value === undefined) return undefined;
    return value === 1;
  },
  to: (value: boolean | undefined): number | undefined => {
    if (value === undefined) return undefined;
    return value ? 1 : 0;
  },
};

/**
 * Custom type transformer for Unix timestamps
 * Handles conversion between Date objects and Unix timestamps
 */
export const timestampTransformer = {
  from: (value: number | undefined): Date | undefined => {
    if (value === undefined) return undefined;
    return new Date(value * 1000);
  },
  to: (value: Date | number | undefined): number | undefined => {
    if (value === undefined) return undefined;
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);
    return value;
  },
};

/**
 * Custom type transformer for DateTime (ISO strings)
 * Handles conversion between Date objects and ISO 8601 strings
 */
export const dateTimeTransformer = {
  from: (value: string | undefined): Date | undefined => {
    if (value === undefined) return undefined;
    return new Date(value);
  },
  to: (value: Date | string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return undefined;
  },
};

/**
 * Create and configure Kysely database instance
 */
export function createKyselyDatabase(dbPath?: string): Kysely<DatabaseSchema> {
  const defaultPath = path.join(process.cwd(), 'data', 'transactions.db');
  const finalPath = dbPath || defaultPath;

  // Ensure data directory exists
  const dataDir = path.dirname(finalPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create better-sqlite3 database instance
  const sqliteDb = new Database(finalPath, {
    verbose: (message) => logger.debug(message),
  });

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
    log: (event) => {
      if (event.level === 'query') {
        logger.debug(
          {
            duration: event.queryDurationMillis,
            parameters: event.query.parameters,
            sql: event.query.sql,
          },
          'SQL Query'
        );
      } else if (event.level === 'error') {
        logger.error(
          {
            error: event.error,
            parameters: event.query?.parameters,
            sql: event.query?.sql,
          },
          'SQL Error'
        );
      }
    },
  }).withPlugin(new IsoStringToDatePlugin());

  return kysely;
}

/**
 * Utility function to close the Kysely database connection
 */
export async function closeKyselyDatabase(db: Kysely<DatabaseSchema>): Promise<void> {
  try {
    await db.destroy();
    logger.info('Kysely database connection closed');
  } catch (error) {
    logger.error({ error }, 'Error closing Kysely database');
    throw error;
  }
}

/**
 * Type-safe database instance type
 */
export type KyselyDB = Kysely<DatabaseSchema>;
