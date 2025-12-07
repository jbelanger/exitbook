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

import type { IRawDataRepository, LoadRawDataFilters } from '../types/repositories.js';

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
      let query = this.db.selectFrom('external_transaction_data').selectAll();

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

  async markAsProcessed(sourceName: string, rawTransactionIds: number[]): Promise<Result<void, Error>> {
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

  async markAsSkipped(rawDataIds: number[]): Promise<Result<number, Error>> {
    if (rawDataIds.length === 0) {
      return ok(0);
    }

    try {
      const result = await this.db
        .updateTable('external_transaction_data')
        .set({
          processing_status: 'skipped',
          processed_at: this.getCurrentDateTimeForDB(),
          processing_error: 'Cross-account duplicate - same blockchain transaction hash exists in another account',
        })
        .where('id', 'in', rawDataIds)
        .executeTakeFirst();

      return ok(Number(result.numUpdatedRows));
    } catch (error) {
      return wrapError(error, 'Failed to mark items as skipped');
    }
  }

  async save(accountId: number, item?: ExternalTransaction): Promise<Result<number, Error>> {
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
        try {
          const insertResult = await trx
            .insertInto('external_transaction_data')
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
              raw_data: JSON.stringify(item.rawData),
            })
            .execute();

          return insertResult.length > 0 ? 1 : 0;
        } catch (error) {
          // Check if this is a unique constraint violation (duplicate blockchain transaction)
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('UNIQUE constraint failed') ||
            errorMessage.includes('idx_external_tx_account_blockchain_hash')
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
    items: ExternalTransaction[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>> {
    if (items.length === 0) {
      return ok({ inserted: 0, skipped: 0 });
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
        let inserted = 0;
        const createdAt = this.getCurrentDateTimeForDB();

        for (const item of items) {
          try {
            const insertResult = await trx
              .insertInto('external_transaction_data')
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
                raw_data: JSON.stringify(item.rawData),
              })
              .execute();

            if (insertResult.length > 0) {
              inserted++;
            }
          } catch (error) {
            // Check if this is a unique constraint violation (duplicate blockchain transaction)
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (
              errorMessage.includes('UNIQUE constraint failed') ||
              errorMessage.includes('idx_external_tx_account_blockchain_hash')
            ) {
              // Skip duplicate - this is expected for blockchain transactions shared across derived addresses
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

  async getValidRecords(accountId: number): Promise<Result<ExternalTransactionData[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('external_transaction_data')
        .selectAll()
        .where('account_id', '=', accountId)
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

  async resetProcessingStatusByAccount(accountId: number): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .updateTable('external_transaction_data')
        .set({
          processed_at: null,
          processing_error: null,
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

  async countAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('external_transaction_data')
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
        .selectFrom('external_transaction_data')
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
        .deleteFrom('external_transaction_data')
        .where('account_id', '=', accountId)
        .executeTakeFirst();

      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete raw data by account');
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
    const rawDataResult = this.parseJson<unknown>(row.raw_data);
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
      rawData: rawDataResult.value,
      normalizedData: normalizedDataResult.value,
      processingStatus: row.processing_status,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      processingError: row.processing_error ?? undefined,
      createdAt: new Date(row.created_at),
    });
  }
}
