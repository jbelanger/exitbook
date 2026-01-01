/* eslint-disable unicorn/no-null -- db requires null handling */
import type { ProcessingStatus } from '@exitbook/core';
import { RawTransactionInputSchema, wrapError, type RawTransactionInput, type RawTransaction } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Selectable, Transaction } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import type { DatabaseSchema, RawTransactionTable } from '../schema/database-schema.ts';

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
  limit?: number | undefined;
  offset?: number | undefined;
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

  /**
   * Load recent event IDs for deduplication window seeding.
   * Returns the most recent N event IDs for an account, ordered by creation time descending.
   * Used to initialize the deduplication window when resuming imports.
   */
  loadRecentEventIds(accountId: number, limit: number): Promise<Result<string[], Error>>;

  /**
   * Get distinct account IDs that have pending raw data.
   * Efficient query that doesn't load all raw data into memory.
   */
  getAccountsWithPendingData(): Promise<Result<number[], Error>>;

  /**
   * Load pending raw data grouped by transaction hash.
   * Returns all pending raw rows for the first N distinct blockchain_transaction_hash values.
   * Ensures all events sharing the same hash are processed together.
   *
   * @param accountId - Account to load data for
   * @param hashLimit - Maximum number of distinct hashes to load
   * @returns All raw transactions for the first hashLimit distinct hashes
   */
  loadPendingByHashBatch(accountId: number, hashLimit: number): Promise<Result<RawTransaction[], Error>>;
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

      if (filters?.limit !== undefined) {
        query = query.limit(filters.limit);
      }

      if (filters?.offset !== undefined) {
        query = query.offset(filters.offset);
      }

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
      if (rawTransactionIds.length === 0) {
        return ok();
      }

      await this.withTransaction(async (trx) => {
        const processedAt = this.getCurrentDateTimeForDB();

        await trx
          .updateTable('raw_transactions')
          .set({
            processed_at: processedAt,
            processing_status: 'processed',
          })
          .where('id', 'in', rawTransactionIds)
          .execute();
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
          const normalizedDataJson = JSON.stringify(item.normalizedData);
          const providerDataJson = JSON.stringify(item.providerData);
          const insertResult = await trx
            .insertInto('raw_transactions')
            .values({
              created_at: this.getCurrentDateTimeForDB(),
              event_id: item.eventId,
              account_id: accountId,
              blockchain_transaction_hash: item.blockchainTransactionHash ?? null,
              timestamp: item.timestamp,
              normalized_data: normalizedDataJson,
              processing_status: 'pending',
              provider_name: item.providerName,
              source_address: item.sourceAddress ?? null,
              transaction_type_hint: item.transactionTypeHint ?? null,
              provider_data: providerDataJson,
            })
            .execute();

          return insertResult.length > 0 ? 1 : 0;
        } catch (error) {
          // Check if this is a unique constraint violation (duplicate blockchain transaction or exchange transaction)
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('UNIQUE constraint failed') ||
            errorMessage.includes('idx_raw_tx_account_blockchain_hash') ||
            errorMessage.includes('idx_raw_tx_account_event_id')
          ) {
            if (this.isEventIdConstraintViolation(errorMessage)) {
              await this.warnOnEventIdCollision(trx, accountId, item);
            }
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
            const normalizedDataJson = JSON.stringify(item.normalizedData);
            const providerDataJson = JSON.stringify(item.providerData);
            const insertResult = await trx
              .insertInto('raw_transactions')
              .values({
                created_at: createdAt,
                event_id: item.eventId ?? null,
                account_id: accountId,
                blockchain_transaction_hash: item.blockchainTransactionHash ?? null,
                timestamp: item.timestamp,
                normalized_data: normalizedDataJson,
                processing_status: 'pending',
                provider_name: item.providerName,
                source_address: item.sourceAddress ?? null,
                transaction_type_hint: item.transactionTypeHint ?? null,
                provider_data: providerDataJson,
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
              errorMessage.includes('idx_raw_tx_account_event_id')
            ) {
              if (this.isEventIdConstraintViolation(errorMessage)) {
                await this.warnOnEventIdCollision(trx, accountId, item);
              }
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

  async loadRecentEventIds(accountId: number, limit: number): Promise<Result<string[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('raw_transactions')
        .select('event_id')
        .where('account_id', '=', accountId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute();

      return ok(rows.map((row) => row.event_id));
    } catch (error) {
      return wrapError(error, 'Failed to load recent event IDs');
    }
  }

  async getAccountsWithPendingData(): Promise<Result<number[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('raw_transactions')
        .select('account_id')
        .distinct()
        .where('processing_status', '=', 'pending')
        .execute();

      return ok(rows.map((row) => row.account_id));
    } catch (error) {
      return wrapError(error, 'Failed to get accounts with pending data');
    }
  }

  async loadPendingByHashBatch(accountId: number, hashLimit: number): Promise<Result<RawTransaction[], Error>> {
    try {
      // CTE to get first N distinct transaction hashes for this account
      const hashesSubquery = this.db
        .selectFrom('raw_transactions')
        .select('blockchain_transaction_hash')
        .distinct()
        .where('account_id', '=', accountId)
        .where('processing_status', '=', 'pending')
        .where('blockchain_transaction_hash', 'is not', null)
        .orderBy('blockchain_transaction_hash', 'asc')
        .limit(hashLimit);

      // Main query: get all raw rows for those hashes
      const rows = await this.db
        .with('hashes', () => hashesSubquery)
        .selectFrom('raw_transactions as rt')
        .innerJoin('hashes as h', 'rt.blockchain_transaction_hash', 'h.blockchain_transaction_hash')
        .selectAll('rt')
        .where('rt.account_id', '=', accountId)
        .where('rt.processing_status', '=', 'pending')
        .orderBy('rt.blockchain_transaction_hash', 'asc')
        .orderBy('rt.id', 'asc')
        .execute();

      // Convert rows to domain models
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
      return wrapError(error, 'Failed to load pending data by hash batch');
    }
  }

  private isEventIdConstraintViolation(errorMessage: string): boolean {
    return (
      errorMessage.includes('idx_raw_tx_account_event_id') ||
      (errorMessage.includes('raw_transactions.account_id') && errorMessage.includes('raw_transactions.event_id'))
    );
  }

  private stableStringify(value: unknown): string {
    const normalize = (input: unknown): unknown => {
      if (Array.isArray(input)) {
        return input.map(normalize);
      }
      if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const sortedKeys = Object.keys(record).sort();
        const result: Record<string, unknown> = {};
        for (const key of sortedKeys) {
          result[key] = normalize(record[key]);
        }
        return result;
      }
      return input;
    };

    return JSON.stringify(normalize(value));
  }

  private async warnOnEventIdCollision(
    trx: Transaction<DatabaseSchema>,
    accountId: number,
    item: RawTransactionInput
  ): Promise<void> {
    try {
      const existing = await trx
        .selectFrom('raw_transactions')
        .select(['event_id', 'provider_name', 'blockchain_transaction_hash', 'normalized_data'])
        .where('account_id', '=', accountId)
        .where('event_id', '=', item.eventId)
        .executeTakeFirst();

      if (!existing) {
        this.logger.warn(
          { accountId, eventId: item.eventId, providerName: item.providerName },
          'Duplicate eventId constraint hit but existing row not found'
        );
        return;
      }

      const existingNormalizedResult = this.parseJson<unknown>(existing.normalized_data);
      if (existingNormalizedResult.isErr()) {
        this.logger.warn(
          { accountId, eventId: item.eventId, error: existingNormalizedResult.error },
          'Failed to parse existing normalized_data during eventId collision check'
        );
        return;
      }

      const existingNormalized = existingNormalizedResult.value;
      const incomingNormalized = item.normalizedData;

      const existingNormalizedStable = this.stableStringify(existingNormalized);
      const incomingNormalizedStable = this.stableStringify(incomingNormalized);

      if (existingNormalizedStable !== incomingNormalizedStable) {
        this.logger.warn(
          {
            accountId,
            eventId: item.eventId,
            existingProviderName: existing.provider_name,
            incomingProviderName: item.providerName,
            existingBlockchainTransactionHash: existing.blockchain_transaction_hash ?? null,
            incomingBlockchainTransactionHash: item.blockchainTransactionHash ?? null,
          },
          'EventId collision detected with differing normalized data'
        );
      }
    } catch (error) {
      this.logger.warn(
        { accountId, eventId: item.eventId, error },
        'Failed to inspect eventId collision after unique constraint violation'
      );
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
      eventId: row.event_id,
      blockchainTransactionHash: row.blockchain_transaction_hash ?? undefined,
      timestamp: row.timestamp,
      providerData: rawDataResult.value,
      normalizedData: normalizedDataResult.value,
      processingStatus: row.processing_status,
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
      createdAt: new Date(row.created_at),
    });
  }
}
