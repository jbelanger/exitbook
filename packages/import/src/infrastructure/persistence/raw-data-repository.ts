/* eslint-disable unicorn/no-null -- db requires null handling */
import type { RawTransactionWithMetadata } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { RawData } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { IRawDataRepository, LoadRawDataFilters } from '@exitbook/import/app/ports/raw-data-repository.js';
import { err, ok, type Result } from 'neverthrow';

/**
 * Kysely-based repository for raw data database operations.
 * Handles storage and retrieval of external transaction data using type-safe queries.
 * All operations return Result types and fail fast on errors.
 */
export class RawDataRepository extends BaseRepository implements IRawDataRepository {
  constructor(db: KyselyDB) {
    super(db, 'RawDataRepository');
  }

  async load(filters?: LoadRawDataFilters): Promise<Result<RawData[], Error>> {
    try {
      let query = this.db
        .selectFrom('external_transaction_data')
        .innerJoin('import_sessions', 'external_transaction_data.import_session_id', 'import_sessions.id')
        .selectAll('external_transaction_data');

      // Apply filters
      if (filters?.sourceId) {
        query = query.where('source_id', '=', filters.sourceId);
      }

      if (filters?.importSessionId) {
        query = query.where('import_session_id', '=', filters.importSessionId);
      }

      if (filters?.providerId) {
        query = query.where('provider_id', '=', filters.providerId);
      }

      if (filters?.processingStatus) {
        query = query.where('processing_status', '=', filters.processingStatus);
      }

      if (filters?.since) {
        // Convert Unix timestamp to Date - now type-safe with DateTime type and plugin
        const sinceDate = new Date(filters.since * 1000).toISOString();
        query = query.where('created_at', '>=', sinceDate);
      }

      // Apply ordering
      query = query.orderBy('created_at', 'desc');

      const rows = await query.execute();

      return ok(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, filters }, 'Failed to load raw data');
      return err(new Error(`Failed to load raw data: ${errorMessage}`));
    }
  }

  async markAsProcessed(sourceId: string, rawTransactionIds: number[]): Promise<Result<void, Error>> {
    try {
      await this.withTransaction(async (trx) => {
        const processedAt = this.getCurrentDateTimeForDB();

        for (const id of rawTransactionIds) {
          await trx
            .updateTable('external_transaction_data')
            .set({
              processed_at: processedAt,
              processing_error: undefined,
              processing_status: 'processed',
            })
            .where('id', '=', id)
            .execute();
        }
      });

      return ok();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, sourceId, rawTransactionIds }, 'Failed to mark items as processed');
      return err(new Error(`Failed to mark items as processed: ${errorMessage}`));
    }
  }

  async save(importSessionId: number, item?: RawTransactionWithMetadata): Promise<Result<number, Error>> {
    if (!item) {
      return err(new Error('Raw data cannot be null or undefined'));
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        const insertResult = await trx
          .insertInto('external_transaction_data')
          .values({
            created_at: this.getCurrentDateTimeForDB(),
            cursor: item.cursor ? JSON.stringify(item.cursor) : null,
            external_id: item.externalId ?? null,
            import_session_id: importSessionId,
            metadata: this.serializeToJson(item.metadata),
            parsed_data: item.parsedData ? JSON.stringify(item.parsedData) : null,
            processing_status: 'pending',
            provider_id: item.metadata.providerId,
            raw_data: JSON.stringify(item.rawData),
          })
          .onConflict((oc) => oc.doNothing()) // Equivalent to INSERT OR IGNORE
          .execute();

        return insertResult.length > 0 ? 1 : 0;
      });

      return ok(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, importSessionId }, 'Failed to save raw data item');
      return err(new Error(`Failed to save raw data item: ${errorMessage}`));
    }
  }

  async saveBatch(importSessionId: number, items: RawTransactionWithMetadata[]): Promise<Result<number, Error>> {
    if (items.length === 0) {
      return ok(0);
    }

    // Validate all items before processing
    for (const item of items) {
      if (!item.rawData) {
        return err(new Error('Raw data cannot be null or undefined in batch items'));
      }
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        let saved = 0;
        const createdAt = this.getCurrentDateTimeForDB();

        for (const item of items) {
          const insertResult = await trx
            .insertInto('external_transaction_data')
            .values({
              created_at: createdAt,
              cursor: item.cursor ? JSON.stringify(item.cursor) : null,
              external_id: item.externalId ?? null,
              import_session_id: importSessionId,
              metadata: this.serializeToJson(item.metadata),
              parsed_data: item.parsedData ? JSON.stringify(item.parsedData) : null,
              processing_status: 'pending',
              provider_id: item.metadata.providerId,
              raw_data: JSON.stringify(item.rawData),
            })
            .onConflict((oc) => oc.doNothing())
            .execute();

          if (insertResult.length > 0) {
            saved++;
          }
        }

        return saved;
      });

      return ok(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, importSessionId }, 'Failed to save raw data batch');
      return err(new Error(`Failed to save raw data batch: ${errorMessage}`));
    }
  }

  async getLatestCursor(importSessionId: number): Promise<Result<Record<string, number> | null, Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .select('cursor')
        .where('import_session_id', '=', importSessionId)
        .where('cursor', 'is not', null)
        .execute();

      if (rows.length === 0) {
        return ok(null);
      }

      // Merge all cursors by taking the maximum timestamp for each operation type
      const mergedCursor: Record<string, number> = {};

      for (const row of rows) {
        if (!row.cursor) continue;

        const cursor: Record<string, unknown> =
          typeof row.cursor === 'string'
            ? (JSON.parse(row.cursor) as Record<string, unknown>)
            : ((row.cursor as Record<string, unknown>) ?? ({} as Record<string, unknown>));

        if (typeof cursor === 'object' && cursor !== null) {
          for (const [operationType, timestamp] of Object.entries(cursor)) {
            if (typeof timestamp === 'number') {
              mergedCursor[operationType] = Math.max(mergedCursor[operationType] || 0, timestamp);
            }
          }
        }
      }

      return ok(Object.keys(mergedCursor).length > 0 ? mergedCursor : null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, importSessionId }, 'Failed to get latest cursor');
      return err(new Error(`Failed to get latest cursor: ${errorMessage}`));
    }
  }

  async getRecordsNeedingValidation(importSessionId: number): Promise<Result<RawData[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .selectAll()
        .where('import_session_id', '=', importSessionId)
        .where('parsed_data', 'is', null)
        .execute();

      return ok(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, importSessionId }, 'Failed to get records needing validation');
      return err(new Error(`Failed to get records needing validation: ${errorMessage}`));
    }
  }

  async getValidRecords(importSessionId: number): Promise<Result<RawData[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .selectAll()
        .where('import_session_id', '=', importSessionId)
        .where('parsed_data', 'is not', null)
        .where('processing_status', '=', 'pending')
        .execute();

      return ok(rows);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, importSessionId }, 'Failed to get valid records');
      return err(new Error(`Failed to get valid records: ${errorMessage}`));
    }
  }

  async updateParsedData(id: number, parsedData: unknown): Promise<Result<void, Error>> {
    try {
      await this.db
        .updateTable('external_transaction_data')
        .set({
          parsed_data: JSON.stringify(parsedData),
        })
        .where('id', '=', id)
        .execute();

      return ok();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error, id }, 'Failed to update parsed data');
      return err(new Error(`Failed to update parsed data: ${errorMessage}`));
    }
  }
}
