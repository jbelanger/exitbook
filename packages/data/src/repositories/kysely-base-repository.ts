import { type Logger, getLogger } from '@crypto/shared-logger';
import type { Transaction } from 'kysely';

import type { DatabaseSchema } from '../schema/database-schema.ts';
import type { KyselyDB } from '../storage/kysely-database.ts';

/**
 * Base repository class for Kysely-based database operations
 * Provides common functionality and utilities for all repositories
 */
export abstract class KyselyBaseRepository {
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
   * Utility to build dynamic WHERE clauses
   * Returns an object with conditions array and parameters array
   */
  protected buildWhereConditions(filters: Record<string, unknown>): {
    conditions: string[];
    hasConditions: boolean;
  } {
    const conditions: string[] = [];

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        conditions.push(`${key} = ?`);
      }
    });

    return {
      conditions,
      hasConditions: conditions.length > 0,
    };
  }

  /**
   * Helper method for bulk insert operations with conflict resolution
   * Note: Simplified generic version - in practice you'd want better typing per table
   */
  protected async bulkInsert<T extends keyof DatabaseSchema>(
    table: T,
    data: Record<string, unknown>[],
    onConflict: 'ignore' | 'replace' = 'ignore'
  ): Promise<number> {
    if (data.length === 0) {
      this.logger.debug(`No data to insert into ${String(table)}`);
      return 0;
    }

    return this.withTransaction(async (trx) => {
      let inserted = 0;

      for (const item of data) {
        try {
          const query = trx.insertInto(table);
          let finalQuery = query.values(item as never);

          if (onConflict === 'ignore') {
            finalQuery = finalQuery.onConflict((oc) => oc.doNothing());
          } else if (onConflict === 'replace') {
            finalQuery = finalQuery.onConflict((oc) => oc.doUpdateSet(item as never));
          }

          const result = await finalQuery.execute();
          if (result.length > 0) {
            inserted++;
          }
        } catch (error) {
          this.logger.warn(
            {
              error,
              item,
            },
            `Failed to insert item into ${String(table)}`
          );
          // Continue with other items instead of failing the entire batch
        }
      }

      this.logger.debug(`Bulk insert completed: ${inserted}/${data.length} items inserted into ${String(table)}`);
      return inserted;
    });
  }

  /**
   * Helper method to handle JSON field parsing safely
   */
  protected parseJsonField<T>(jsonString: string | undefined, fallback: T): T {
    if (!jsonString) return fallback;

    try {
      return JSON.parse(jsonString) as T;
    } catch (error) {
      this.logger.warn({ error, jsonString }, 'Failed to parse JSON field');
      return fallback;
    }
  }

  /**
   * Helper method to serialize data to JSON string safely
   */
  protected serializeToJson(data: unknown): string | undefined {
    if (data === undefined || data === null) return undefined;

    try {
      return JSON.stringify(data);
    } catch (error) {
      this.logger.warn({ data, error }, 'Failed to serialize data to JSON');
      return undefined;
    }
  }

  /**
   * Helper method for pagination queries
   * Note: This is a simplified version - in practice you'd want proper typing
   */
  protected applyPagination<QB extends { limit(n: number): QB; offset(n: number): QB }>(
    query: QB,
    limit?: number,
    offset?: number
  ): QB {
    let paginatedQuery = query;

    if (limit !== undefined && limit > 0) {
      paginatedQuery = paginatedQuery.limit(limit);
    }

    if (offset !== undefined && offset > 0) {
      paginatedQuery = paginatedQuery.offset(offset);
    }

    return paginatedQuery;
  }

  /**
   * Helper method to get current Unix timestamp
   */
  protected getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Helper method to get current ISO datetime string for database operations
   */
  protected getCurrentDateTimeForDB(): string {
    return new Date().toISOString();
  }

  /**
   * Helper method to convert Unix timestamp to Date
   */
  protected timestampToDate(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  /**
   * Helper method to convert Date to Unix timestamp
   */
  protected dateToTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Helper method to convert Date to ISO string for database DateTime fields
   */
  protected dateToISO(date: Date): string {
    return date.toISOString();
  }
}
