/* eslint-disable unicorn/no-null -- db requires null handling */
import type { RawTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { Selectable } from '@exitbook/sqlite';
import { sql } from '@exitbook/sqlite';
import { err, ok, type Result } from 'neverthrow';

import type { RawTransactionTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/initialization.js';

import { BaseRepository } from './base-repository.js';
import { toRawTransaction } from './db-utils.js';

function isJson1UnavailableError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return (
    errorMessage.includes('no such function: json_extract') ||
    errorMessage.includes('JSON1 extension') ||
    errorMessage.includes('json_extract')
  );
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

export class NearRawTransactionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'near-raw-transaction-repository');
  }

  async verifyJson1Available(): Promise<Result<void, Error>> {
    try {
      await this.db
        .selectFrom('raw_transactions')
        .select(sql`json_extract('{"test": "value"}', '$.test')`.as('test'))
        .limit(1)
        .execute();

      return ok(undefined);
    } catch (error) {
      if (isJson1UnavailableError(error)) {
        return err(
          new Error(
            'SQLite JSON1 extension is not available. This is required for NEAR data processing. ' +
              'Please ensure SQLite is compiled with JSON1 support.'
          )
        );
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to verify JSON1 availability: ${errorMessage}`));
    }
  }

  async loadPendingNearAnchorHashes(accountId: number, limit: number): Promise<Result<string[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('raw_transactions')
        .select('blockchain_transaction_hash')
        .distinct()
        .where('account_id', '=', accountId)
        .where('processing_status', '=', 'pending')
        .where('blockchain_transaction_hash', 'is not', null)
        .where('transaction_type_hint', 'in', ['transactions', 'receipts', 'token-transfers'])
        .orderBy('blockchain_transaction_hash', 'asc')
        .limit(limit)
        .execute();

      return ok(rows.map((row) => row.blockchain_transaction_hash).filter((hash): hash is string => hash !== null));
    } catch (error) {
      return wrapError(error, 'Failed to load pending NEAR anchor hashes');
    }
  }

  async loadPendingByHashes(accountId: number, hashes: string[]): Promise<Result<RawTransaction[], Error>> {
    try {
      if (hashes.length === 0) {
        return ok([]);
      }

      const rows = await this.db
        .selectFrom('raw_transactions')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('processing_status', '=', 'pending')
        .where('blockchain_transaction_hash', 'in', hashes)
        .orderBy('blockchain_transaction_hash', 'asc')
        .orderBy('id', 'asc')
        .execute();

      const transactionsResult = toRawTransactions(rows);
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      return ok(transactionsResult.value);
    } catch (error) {
      return wrapError(error, 'Failed to load pending data by hashes');
    }
  }

  async loadPendingNearByReceiptIds(accountId: number, receiptIds: string[]): Promise<Result<RawTransaction[], Error>> {
    try {
      if (receiptIds.length === 0) {
        return ok([]);
      }

      const json1CheckResult = await this.verifyJson1Available();
      if (json1CheckResult.isErr()) {
        return err(json1CheckResult.error);
      }

      const rows = await this.db
        .selectFrom('raw_transactions')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('processing_status', '=', 'pending')
        .where('transaction_type_hint', 'in', ['balance-changes'])
        .where('blockchain_transaction_hash', 'is', null)
        .where(sql`json_extract(normalized_data, '$.receiptId')`, 'in', receiptIds)
        .orderBy('id', 'asc')
        .execute();

      const transactionsResult = toRawTransactions(rows);
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      return ok(transactionsResult.value);
    } catch (error) {
      if (isJson1UnavailableError(error)) {
        return err(
          new Error(
            'SQLite JSON1 extension is not available. This is required for NEAR receipt ID lookups. ' +
              'Please ensure SQLite is compiled with JSON1 support.'
          )
        );
      }

      return wrapError(error, 'Failed to load pending NEAR data by receipt IDs');
    }
  }

  async loadProcessedNearBalanceChangesByAccounts(
    accountId: number,
    affectedAccountIds: string[],
    maxTimestamp: number
  ): Promise<Result<RawTransaction[], Error>> {
    try {
      if (affectedAccountIds.length === 0) {
        return ok([]);
      }

      const json1CheckResult = await this.verifyJson1Available();
      if (json1CheckResult.isErr()) {
        return err(json1CheckResult.error);
      }

      const rows = await this.db
        .selectFrom('raw_transactions')
        .selectAll()
        .where('account_id', '=', accountId)
        .where('processing_status', '=', 'processed')
        .where('transaction_type_hint', '=', 'balance-changes')
        .where('timestamp', '<=', maxTimestamp)
        .where(sql`json_extract(normalized_data, '$.affectedAccountId')`, 'in', affectedAccountIds)
        .orderBy('timestamp', 'asc')
        .orderBy('id', 'asc')
        .execute();

      const transactionsResult = toRawTransactions(rows);
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      return ok(transactionsResult.value);
    } catch (error) {
      if (isJson1UnavailableError(error)) {
        return err(
          new Error(
            'SQLite JSON1 extension is not available. This is required for NEAR balance change lookups. ' +
              'Please ensure SQLite is compiled with JSON1 support.'
          )
        );
      }

      return wrapError(error, 'Failed to load processed NEAR balance changes by account');
    }
  }
}
