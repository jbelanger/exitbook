/* eslint-disable unicorn/no-null -- db requires null handling */
import type { ProcessingStatus, RawTransaction, RawTransactionInput } from '@exitbook/core';
import { RawTransactionInputSchema, wrapError } from '@exitbook/core';
import type { Selectable } from '@exitbook/sqlite';
import { err, ok, type Result } from 'neverthrow';

import type { RawTransactionTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { parseJson, toRawTransaction } from '../utils/db-utils.js';

import { BaseRepository } from './base-repository.js';

export interface RawTransactionQueryParams {
  accountId?: number | undefined;
  processingStatus?: ProcessingStatus | undefined;
  providerName?: string | undefined;
  since?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface RawTransactionCountParams {
  accountIds?: number[] | undefined;
  processingStatus?: ProcessingStatus | undefined;
}

function isEventIdConstraintViolation(errorMessage: string): boolean {
  return (
    errorMessage.includes('idx_raw_tx_account_event_id') ||
    (errorMessage.includes('raw_transactions.account_id') && errorMessage.includes('raw_transactions.event_id'))
  );
}

function isSqliteUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function stableStringify(value: unknown): string {
  function normalize(input: unknown): unknown {
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
  }

  return JSON.stringify(normalize(value));
}

function toRawTransactions(rows: Selectable<RawTransactionTable>[]): Result<RawTransaction[], Error> {
  const transactions: RawTransaction[] = [];

  for (const row of rows) {
    const result = toRawTransaction(row);
    if (result.isErr()) {
      return err(result.error);
    }
    transactions.push(result.value);
  }

  return ok(transactions);
}

export class RawTransactionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'raw-transaction-repository');
  }

  async findAll(filters?: RawTransactionQueryParams): Promise<Result<RawTransaction[], Error>> {
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
      const transactionsResult = toRawTransactions(rows);
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      return ok(transactionsResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to load raw data');
    }
  }

  async markProcessed(rawTransactionIds: number[]): Promise<Result<void, Error>> {
    if (rawTransactionIds.length === 0) {
      return ok();
    }

    try {
      const processedAt = new Date().toISOString();

      await this.db
        .updateTable('raw_transactions')
        .set({
          processed_at: processedAt,
          processing_status: 'processed',
        })
        .where('id', 'in', rawTransactionIds)
        .execute();

      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to mark items as processed');
    }
  }

  async createBatch(
    accountId: number,
    items: RawTransactionInput[]
  ): Promise<Result<{ inserted: number; skipped: number }, Error>> {
    if (items.length === 0) {
      return ok({ inserted: 0, skipped: 0 });
    }

    for (const item of items) {
      if (!item.providerData) {
        return err(new Error('Raw data cannot be null or undefined in batch items'));
      }

      const validationResult = RawTransactionInputSchema.safeParse(item);
      if (!validationResult.success) {
        return err(new Error(`Invalid external transaction in batch: ${validationResult.error.message}`));
      }
    }

    try {
      let inserted = 0;
      const createdAt = new Date().toISOString();

      for (const item of items) {
        try {
          const normalizedDataJson = JSON.stringify(item.normalizedData ?? {});
          const providerDataJson = JSON.stringify(item.providerData);
          const insertResult = await this.db
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
          if (isSqliteUniqueConstraintError(error)) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (isEventIdConstraintViolation(errorMessage)) {
              await this.warnOnEventIdCollision(accountId, item);
            }
            continue;
          }
          return wrapError(error, 'Failed to save raw data batch');
        }
      }

      const skipped = items.length - inserted;
      return ok({ inserted, skipped });
    } catch (error) {
      return wrapError(error, 'Failed to save raw data batch');
    }
  }

  async resetProcessingStatus(filters?: { accountId?: number | undefined }): Promise<Result<number, Error>> {
    try {
      let query = this.db.updateTable('raw_transactions').set({
        processed_at: null,
        processing_status: 'pending',
      });

      if (filters?.accountId !== undefined) {
        query = query.where('account_id', '=', filters.accountId);
      }

      const result = await query.executeTakeFirst();
      return ok(Number(result.numUpdatedRows));
    } catch (error) {
      return wrapError(error, 'Failed to reset processing status');
    }
  }

  async count(filters?: RawTransactionCountParams): Promise<Result<number, Error>> {
    try {
      let query = this.db.selectFrom('raw_transactions').select(({ fn }) => [fn.count<number>('id').as('count')]);

      if (filters?.accountIds !== undefined) {
        if (filters.accountIds.length === 0) {
          return ok(0);
        }
        query = query.where('account_id', 'in', filters.accountIds);
      }

      if (filters?.processingStatus !== undefined) {
        query = query.where('processing_status', '=', filters.processingStatus);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count raw data');
    }
  }

  async countByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>> {
    try {
      const results = await this.db
        .selectFrom('raw_transactions')
        .select(['transaction_type_hint', ({ fn }) => fn.count<number>('id').as('count')])
        .where('account_id', '=', accountId)
        .groupBy('transaction_type_hint')
        .execute();

      const countMap = new Map<string, number>();
      for (const row of results) {
        if (row.transaction_type_hint) {
          countMap.set(row.transaction_type_hint, row.count);
        }
      }

      return ok(countMap);
    } catch (error) {
      return wrapError(error, 'Failed to count raw data by stream type');
    }
  }

  async deleteAll(filters?: { accountId?: number | undefined }): Promise<Result<number, Error>> {
    try {
      let query = this.db.deleteFrom('raw_transactions');

      if (filters?.accountId !== undefined) {
        query = query.where('account_id', '=', filters.accountId);
      }

      const result = await query.executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete raw data');
    }
  }

  async findDistinctAccountIds(filters?: {
    processingStatus?: ProcessingStatus | undefined;
  }): Promise<Result<number[], Error>> {
    try {
      let query = this.db.selectFrom('raw_transactions').select('account_id').distinct();

      if (filters?.processingStatus !== undefined) {
        query = query.where('processing_status', '=', filters.processingStatus);
      }

      const rows = await query.execute();
      return ok(rows.map((row) => row.account_id));
    } catch (error) {
      return wrapError(error, 'Failed to find distinct account IDs');
    }
  }

  async findByHashes(accountId: number, hashLimit: number): Promise<Result<RawTransaction[], Error>> {
    try {
      const hashesSubquery = this.db
        .selectFrom('raw_transactions')
        .select('blockchain_transaction_hash')
        .distinct()
        .where('account_id', '=', accountId)
        .where('processing_status', '=', 'pending')
        .where('blockchain_transaction_hash', 'is not', null)
        .orderBy('blockchain_transaction_hash', 'asc')
        .limit(hashLimit);

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

      const transactionsResult = toRawTransactions(rows);
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      return ok(transactionsResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to load pending data by hash batch');
    }
  }

  private async warnOnEventIdCollision(accountId: number, item: RawTransactionInput): Promise<void> {
    try {
      const existing = await this.db
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

      const existingNormalizedResult = parseJson<unknown>(existing.normalized_data);
      if (existingNormalizedResult.isErr()) {
        this.logger.warn(
          { accountId, eventId: item.eventId, error: existingNormalizedResult.error },
          'Failed to parse existing normalized_data during eventId collision check'
        );
        return;
      }

      const existingNormalized = existingNormalizedResult.value;
      const incomingNormalized = item.normalizedData;

      const existingNormalizedStable = stableStringify(existingNormalized);
      const incomingNormalizedStable = stableStringify(incomingNormalized);

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
}
