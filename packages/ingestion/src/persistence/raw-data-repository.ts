/* eslint-disable unicorn/no-null -- db requires null handling */
import {
  ExternalTransactionSchema,
  wrapError,
  type ExternalTransaction,
  type ExternalTransactionData,
} from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import type { StoredRawData } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import { err, ok, type Result } from 'neverthrow';

import type { IRawDataRepository, LoadRawDataFilters } from '../types/repositories.ts';

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

      if (filters?.dataSourceId) {
        query = query.where('data_source_id', '=', filters.dataSourceId);
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

      // Convert rows to domain models, failing fast on any parse errors
      const transactions: ExternalTransactionData[] = [];
      for (const row of rows) {
        const result = this.toExternalTransactionData(row);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      return ok(transactions);
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

  async save(dataSourceId: number, item?: ExternalTransaction): Promise<Result<number, Error>> {
    if (!item) {
      return err(new Error('Raw data cannot be null or undefined'));
    }

    // Validate external transaction before saving
    const validationResult = ExternalTransactionSchema.safeParse(item);
    if (!validationResult.success) {
      return err(new Error(`Invalid external transaction: ${validationResult.error.message}`));
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        const insertResult = await trx
          .insertInto('external_transaction_data')
          .values({
            created_at: this.getCurrentDateTimeForDB(),
            cursor: item.cursor ? JSON.stringify(item.cursor) : null,
            external_id: item.externalId,
            data_source_id: dataSourceId,
            normalized_data: JSON.stringify(item.normalizedData),
            processing_status: 'pending',
            provider_id: item.providerId,
            source_address: item.sourceAddress ?? null,
            transaction_type_hint: item.transactionTypeHint ?? null,
            raw_data: JSON.stringify(item.rawData),
          })
          .execute();

        return insertResult.length > 0 ? 1 : 0;
      });

      return ok(result);
    } catch (error) {
      return wrapError(error, 'Failed to save raw data item');
    }
  }

  async saveBatch(dataSourceId: number, items: ExternalTransaction[]): Promise<Result<number, Error>> {
    if (items.length === 0) {
      return ok(0);
    }

    // Validate all items before processing
    for (const item of items) {
      if (!item.rawData) {
        return err(new Error('Raw data cannot be null or undefined in batch items'));
      }

      // Validate external transaction structure
      const validationResult = ExternalTransactionSchema.safeParse(item);
      if (!validationResult.success) {
        return err(new Error(`Invalid external transaction in batch: ${validationResult.error.message}`));
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
              data_source_id: dataSourceId,
              normalized_data: JSON.stringify(item.normalizedData),
              processing_status: 'pending',
              provider_id: item.providerId,
              source_address: item.sourceAddress ?? null,
              transaction_type_hint: item.transactionTypeHint ?? null,
              raw_data: JSON.stringify(item.rawData),
            })
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

  async getLatestCursor(dataSourceId: number): Promise<Result<Record<string, number> | null, Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .select('cursor')
        .where('data_source_id', '=', dataSourceId)
        .where('cursor', 'is not', null)
        .execute();

      if (rows.length === 0) {
        return ok(null);
      }

      // Merge all cursors by taking the maximum timestamp for each operation type
      const mergedCursor: Record<string, number> = {};

      for (const row of rows) {
        if (!row.cursor) continue;

        const cursorResult = this.parseJson<Record<string, unknown>>(row.cursor);
        if (cursorResult.isErr()) {
          return err(cursorResult.error);
        }

        const cursor = cursorResult.value;
        if (cursor && typeof cursor === 'object') {
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

  async getValidRecords(dataSourceId: number): Promise<Result<ExternalTransactionData[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .selectAll()
        .where('data_source_id', '=', dataSourceId)
        .where('processing_status', '=', 'pending')
        .execute();

      // Convert rows to domain models, failing fast on any parse errors
      const transactions: ExternalTransactionData[] = [];
      for (const row of rows) {
        const result = this.toExternalTransactionData(row);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      return ok(transactions);
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
  private toExternalTransactionData(row: StoredRawData): Result<ExternalTransactionData, Error> {
    const cursorResult = this.parseJson<Record<string, unknown>>(row.cursor);
    const rawDataResult = this.parseJson<unknown>(row.raw_data);
    const normalizedDataResult = this.parseJson<unknown>(row.normalized_data);

    // Fail fast on any parse errors
    if (cursorResult.isErr()) {
      return err(cursorResult.error);
    }
    if (rawDataResult.isErr()) {
      return err(rawDataResult.error);
    }
    if (normalizedDataResult.isErr()) {
      return err(normalizedDataResult.error);
    }

    // providerId is required in the domain model
    if (!row.provider_id) {
      return err(new Error('Missing required provider_id field'));
    }

    return ok({
      id: row.id,
      dataSourceId: row.data_source_id,
      providerId: row.provider_id,
      sourceAddress: row.source_address ?? undefined,
      transactionTypeHint: row.transaction_type_hint ?? undefined,
      externalId: row.external_id,
      cursor: cursorResult.value,
      rawData: rawDataResult.value,
      normalizedData: normalizedDataResult.value,
      processingStatus: row.processing_status,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      processingError: row.processing_error ?? undefined,
      createdAt: new Date(row.created_at),
    });
  }
}
