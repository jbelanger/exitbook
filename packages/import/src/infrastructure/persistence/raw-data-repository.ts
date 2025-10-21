/* eslint-disable unicorn/no-null -- db requires null handling */
import { wrapError, type ExternalTransactionData, type RawTransactionWithMetadata } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { StoredRawData } from '@exitbook/data';
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

  async load(filters?: LoadRawDataFilters): Promise<Result<ExternalTransactionData[], Error>> {
    try {
      let query = this.db
        .selectFrom('external_transaction_data')
        .innerJoin('data_sources', 'external_transaction_data.data_source_id', 'data_sources.id')
        .selectAll('external_transaction_data');

      if (filters?.sourceId) {
        query = query.where('source_id', '=', filters.sourceId);
      }

      if (filters?.importSessionId) {
        query = query.where('data_source_id', '=', filters.importSessionId);
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

      query = query.orderBy('created_at', 'desc');

      const rows = await query.execute();

      return ok(rows.map((row) => this.toExternalTransactionData(row)));
    } catch (error) {
      return wrapError(error, 'Failed to load raw data');
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
              processing_error: null,
              processing_status: 'processed',
            })
            .where('id', '=', id)
            .execute();
        }
      });

      return ok();
    } catch (error) {
      return wrapError(error, 'Failed to mark items as processed');
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
            data_source_id: importSessionId,
            metadata: this.serializeToJson(item.metadata),
            normalized_data: JSON.stringify(item.normalizedData),
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
      return wrapError(error, 'Failed to save raw data item');
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
              data_source_id: importSessionId,
              metadata: this.serializeToJson(item.metadata),
              normalized_data: JSON.stringify(item.normalizedData),
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
      return wrapError(error, 'Failed to save raw data batch');
    }
  }

  async getLatestCursor(importSessionId: number): Promise<Result<Record<string, number> | null, Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .select('cursor')
        .where('data_source_id', '=', importSessionId)
        .where('cursor', 'is not', null)
        .execute();

      if (rows.length === 0) {
        return ok(null);
      }

      // Merge all cursors by taking the maximum timestamp for each operation type
      const mergedCursor: Record<string, number> = {};

      for (const row of rows) {
        if (!row.cursor) continue;

        const cursor = this.parseJson<Record<string, unknown>>(row.cursor, {});

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
      return wrapError(error, 'Failed to get latest cursor');
    }
  }

  async getValidRecords(importSessionId: number): Promise<Result<ExternalTransactionData[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .selectAll()
        .where('data_source_id', '=', importSessionId)
        .where('processing_status', '=', 'pending')
        .execute();

      return ok(rows.map((row) => this.toExternalTransactionData(row)));
    } catch (error) {
      return wrapError(error, 'Failed to get valid records');
    }
  }

  async resetProcessingStatusBySource(sourceId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .updateTable('external_transaction_data')
        .set({
          processed_at: null,
          processing_error: null,
          processing_status: 'pending',
        })
        .where(
          'data_source_id',
          'in',
          this.db.selectFrom('data_sources').select('id').where('source_id', '=', sourceId)
        )
        .executeTakeFirst();

      return ok(Number(result.numUpdatedRows));
    } catch (error) {
      return wrapError(error, 'Failed to reset processing status by source');
    }
  }

  async resetProcessingStatusAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .updateTable('external_transaction_data')
        .set({
          processed_at: null,
          processing_error: null,
          processing_status: 'pending',
        })
        .executeTakeFirst();

      return ok(Number(result.numUpdatedRows));
    } catch (error) {
      return wrapError(error, 'Failed to reset processing status for all records');
    }
  }

  async deleteBySource(sourceId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('external_transaction_data')
        .where(
          'data_source_id',
          'in',
          this.db.selectFrom('data_sources').select('id').where('source_id', '=', sourceId)
        )
        .executeTakeFirst();

      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete raw data by source');
    }
  }

  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('external_transaction_data').executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete all raw data');
    }
  }

  /**
   * Convert database row to ExternalTransactionData domain model
   * Handles JSON parsing and camelCase conversion
   */
  private toExternalTransactionData(row: StoredRawData): ExternalTransactionData {
    return {
      id: row.id,
      dataSourceId: row.data_source_id,
      providerId: row.provider_id ?? undefined,
      externalId: row.external_id ?? undefined,
      cursor: this.parseJson<Record<string, unknown>>(row.cursor),
      rawData: this.parseJson<unknown>(row.raw_data),
      normalizedData: this.parseJson<unknown>(row.normalized_data),
      processingStatus: row.processing_status,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      processingError: row.processing_error ?? undefined,
      metadata: this.parseJson<unknown>(row.metadata),
      createdAt: new Date(row.created_at),
    };
  }
}
