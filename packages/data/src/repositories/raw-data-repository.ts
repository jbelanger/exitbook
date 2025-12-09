/* eslint-disable unicorn/no-null -- db requires null handling */
import type { ProcessingStatus } from '@exitbook/core';
import { RawTransactionInputSchema, wrapError, type RawTransactionInput, type RawTransaction } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import type { RawTransactionTable } from '../schema/database-schema.ts';

/**
 * Filter options for loading raw data from repository
 * Ingestion-specific concern
 * Raw data is scoped by account - each account owns its transaction data
 */
export interface LoadRawDataFilters {
  accountId?: number | undefined;
  processingStatus?: ProcessingStatus | undefined;
  providerName?: string | undefined;
  since?: number | undefined;
}

/**
 * Interface for raw data repository operations.
 * Abstracts the database operations for external transaction storage.
 * All operations return Result types for proper error handling.
 */
export interface IRawDataRepository {
  /**
   * Load external data from storage with optional filtering.
   */
  load(filters?: LoadRawDataFilters): Promise<Result<RawTransaction[], Error>>;

  /**
   * Mark multiple items as processed.
   */
  markAsProcessed(rawTransactionIds: number[]): Promise<Result<void, Error>>;

  /**
   * Save external data item to storage.
   */
  save(accountId: number, item: RawTransactionInput): Promise<Result<number, Error>>;

  /**
   * Save multiple external data items to storage in a single transaction.
   * Returns inserted and skipped counts (skipped = duplicates per unique constraint).
   */
  saveBatch(
    accountId: number,
    items: RawTransactionInput[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>>;

  /**
   * Reset processing status to 'pending' for all raw data for an account.
   * Used when clearing processed data but keeping raw data for reprocessing.
   */
  resetProcessingStatusByAccount(accountId: number): Promise<Result<number, Error>>;

  /**
   * Reset processing status to 'pending' for all raw data.
   * Used when clearing all processed data but keeping raw data for reprocessing.
   */
  resetProcessingStatusAll(): Promise<Result<number, Error>>;

  /**
   * Count all raw data.
   */
  countAll(): Promise<Result<number, Error>>;

  /**
   * Count raw data by account IDs.
   */
  countByAccount(accountIds: number[]): Promise<Result<number, Error>>;

  /**
   * Delete all raw data for an account.
   */
  deleteByAccount(accountId: number): Promise<Result<number, Error>>;

  /**
   * Delete all raw data.
   */
  deleteAll(): Promise<Result<number, Error>>;
}

/**
 * Kysely-based repository for raw data database operations.
 * Handles storage and retrieval of external transaction data using type-safe queries.
 * All operations return Result types and fail fast on errors.
 */
export class RawDataRepository extends BaseRepository implements IRawDataRepository {
  constructor(db: KyselyDB) {
    super(db, 'RawDataRepository');
  }

  async load(filters?: LoadRawDataFilters): Promise<Result<RawTransaction[], Error>> {
    try {
      let query = this.db.selectFrom('raw_transactions').selectAll();

      if (filters?.accountId !== undefined) {
        query = query.where('account_id', '=', filters.accountId);
      }

      if (filters?.providerName) {
        query = query.where('provider_name', '=', filters.providerName);
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
      const transactions: RawTransaction[] = [];
      for (const row of rows) {
        const result = this.toRawTransaction(row);
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

  async markAsProcessed(rawTransactionIds: number[]): Promise<Result<void, Error>> {
    try {
      await this.withTransaction(async (trx) => {
        const processedAt = this.getCurrentDateTimeForDB();

        for (const id of rawTransactionIds) {
          await trx
            .updateTable('raw_transactions')
            .set({
              processed_at: processedAt,
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

  async save(accountId: number, item?: RawTransactionInput): Promise<Result<number, Error>> {
    if (!item) {
      return err(new Error('Raw data cannot be null or undefined'));
    }

    // Validate external transaction before saving
    const validationResult = RawTransactionInputSchema.safeParse(item);
    if (!validationResult.success) {
      return err(new Error(`Invalid external transaction: ${validationResult.error.message}`));
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        try {
          const insertResult = await trx
            .insertInto('raw_transactions')
            .values({
              created_at: this.getCurrentDateTimeForDB(),
              external_id: item.externalId,
              account_id: accountId,
              blockchain_transaction_hash: item.blockchainTransactionHash ?? null,
              normalized_data: JSON.stringify(item.normalizedData),
              processing_status: 'pending',
              provider_name: item.providerName,
              source_address: item.sourceAddress ?? null,
              transaction_type_hint: item.transactionTypeHint ?? null,
              provider_data: JSON.stringify(item.providerData),
            })
            .execute();

          return insertResult.length > 0 ? 1 : 0;
        } catch (error) {
          // Check if this is a unique constraint violation (duplicate blockchain transaction or exchange transaction)
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('UNIQUE constraint failed') ||
            errorMessage.includes('idx_raw_tx_account_blockchain_hash') ||
            errorMessage.includes('idx_raw_tx_account_external_id')
          ) {
            // Skip duplicate - return 0 to indicate nothing was inserted
            return 0;
          }
          // Re-throw other errors
          throw error;
        }
      });

      return ok(result);
    } catch (error) {
      return wrapError(error, 'Failed to save raw data item');
    }
  }

  async saveBatch(
    accountId: number,
    items: RawTransactionInput[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>> {
    if (items.length === 0) {
      return ok({ inserted: 0, skipped: 0 });
    }

    // Validate all items before processing
    for (const item of items) {
      if (!item.providerData) {
        return err(new Error('Raw data cannot be null or undefined in batch items'));
      }

      // Validate external transaction structure
      const validationResult = RawTransactionInputSchema.safeParse(item);
      if (!validationResult.success) {
        return err(new Error(`Invalid external transaction in batch: ${validationResult.error.message}`));
      }
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        let inserted = 0;
        const createdAt = this.getCurrentDateTimeForDB();

        for (const item of items) {
          try {
            const insertResult = await trx
              .insertInto('raw_transactions')
              .values({
                created_at: createdAt,
                external_id: item.externalId ?? null,
                account_id: accountId,
                blockchain_transaction_hash: item.blockchainTransactionHash ?? null,
                normalized_data: JSON.stringify(item.normalizedData),
                processing_status: 'pending',
                provider_name: item.providerName,
                source_address: item.sourceAddress ?? null,
                transaction_type_hint: item.transactionTypeHint ?? null,
                provider_data: JSON.stringify(item.providerData),
              })
              .execute();

            if (insertResult.length > 0) {
              inserted++;
            }
          } catch (error) {
            // Check if this is a unique constraint violation (duplicate blockchain transaction or exchange transaction)
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (
              errorMessage.includes('UNIQUE constraint failed') ||
              errorMessage.includes('idx_raw_tx_account_blockchain_hash') ||
              errorMessage.includes('idx_raw_tx_account_external_id')
            ) {
              // Skip duplicate - this is expected for blockchain transactions shared across derived addresses or re-imported exchange data
              continue;
            }
            // Re-throw other errors
            throw error;
          }
        }

        const skipped = items.length - inserted;
        return { inserted, skipped };
      });

      return ok(result);
    } catch (error) {
      return wrapError(error, 'Failed to save raw data batch');
    }
  }

  async resetProcessingStatusByAccount(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .updateTable('raw_transactions')
        .set({
          processed_at: null,
          processing_status: 'pending',
        })
        .where('account_id', '=', accountId)
        .executeTakeFirst();

      return ok(Number(result.numUpdatedRows));
    } catch (error) {
      return wrapError(error, 'Failed to reset processing status by account');
    }
  }

  async resetProcessingStatusAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .updateTable('raw_transactions')
        .set({
          processed_at: null,
          processing_status: 'pending',
        })
        .executeTakeFirst();

      return ok(Number(result.numUpdatedRows));
    } catch (error) {
      return wrapError(error, 'Failed to reset processing status for all records');
    }
  }

  async countAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('raw_transactions')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count all raw data');
    }
  }

  async countByAccount(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const result = await this.db
        .selectFrom('raw_transactions')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .where('account_id', 'in', accountIds)
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count raw data by account');
    }
  }

  async deleteByAccount(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('raw_transactions')
        .where('account_id', '=', accountId)
        .executeTakeFirst();

      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete raw data by account');
    }
  }

  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('raw_transactions').executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete all raw data');
    }
  }

  /**
   * Convert database row to RawTransaction domain model
   * Handles JSON parsing and camelCase conversion
   */
  private toRawTransaction(row: Selectable<RawTransactionTable>): Result<RawTransaction, Error> {
    const rawDataResult = this.parseJson<unknown>(row.provider_data);
    const normalizedDataResult = this.parseJson<unknown>(row.normalized_data);

    // Fail fast on any parse errors
    if (rawDataResult.isErr()) {
      return err(rawDataResult.error);
    }
    if (normalizedDataResult.isErr()) {
      return err(normalizedDataResult.error);
    }

    // providerName is required in the domain model
    if (!row.provider_name) {
      return err(new Error('Missing required provider_name field'));
    }

    return ok({
      id: row.id,
      accountId: row.account_id,
      providerName: row.provider_name,
      sourceAddress: row.source_address ?? undefined,
      transactionTypeHint: row.transaction_type_hint ?? undefined,
      externalId: row.external_id,
      blockchainTransactionHash: row.blockchain_transaction_hash ?? undefined,
      providerData: rawDataResult.value,
      normalizedData: normalizedDataResult.value,
      processingStatus: row.processing_status,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      createdAt: new Date(row.created_at),
    });
  }
}
