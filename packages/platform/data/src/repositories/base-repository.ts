import { type Logger, getLogger } from '@exitbook/shared-logger';
import { Decimal } from 'decimal.js';
import type { Transaction } from 'kysely';

import type { DatabaseSchema } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';

/**
 * Base repository class for Kysely-based database operations
 * Provides common functionality and utilities for all repositories
 */
export abstract class BaseRepository {
  protected db: KyselyDB;
  protected logger: Logger;

  constructor(db: KyselyDB, repositoryName: string) {
    this.db = db;
    this.logger = getLogger(repositoryName);
  }

  /**
   * Execute a function within a database transaction
   * Automatically handles commit/rollback
   */
  protected async withTransaction<T>(fn: (trx: Transaction<DatabaseSchema>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      try {
        this.logger.debug('Starting database transaction');
        const result = await fn(trx);
        this.logger.debug('Database transaction completed successfully');
        return result;
      } catch (error) {
        this.logger.error({ error }, 'Database transaction failed, rolling back');
        throw error;
      }
    });
  }

  /**
   * Helper method to serialize data to JSON string safely
   * Handles Decimal objects by converting them to fixed-point notation
   */
  protected serializeToJson(data: unknown): string | undefined {
    if (data === undefined || data === null) return undefined;

    try {
      return JSON.stringify(data, (_key, value: unknown) => {
        // Check if value is a Decimal instance using instanceof
        if (value instanceof Decimal) {
          // Use toFixed() to get consistent decimal representation
          // This preserves precision while avoiding scientific notation
          return value.toFixed();
        }

        // Fallback: Check for Decimal-like objects (duck typing)
        // This handles cases where Decimal comes from different module instances
        if (
          value &&
          typeof value === 'object' &&
          'd' in value &&
          'e' in value &&
          's' in value &&
          'toFixed' in value &&
          typeof value.toFixed === 'function'
        ) {
          return (value as { toFixed: () => string }).toFixed();
        }

        return value as string | number | boolean | null | object;
      });
    } catch (error) {
      this.logger.warn({ data, error }, 'Failed to serialize data to JSON');
      return undefined;
    }
  }

  /**
   * Helper method to get current ISO datetime string for database operations
   */
  protected getCurrentDateTimeForDB(): string {
    return new Date().toISOString();
  }
}
