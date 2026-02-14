/* eslint-disable unicorn/no-null -- db requires null handling */
import type { RawTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { RawTransactionTable } from '@exitbook/data';
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

/**
 * NEAR-specific raw data queries.
 * Contains specialized query methods for NEAR blockchain data processing.
 */
export class NearRawDataQueries extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'NearRawDataQueries');
  }

  /**
   * NEAR-specific: Load distinct transaction hashes from transactions and receipts only.
   * Avoids polluted blockchain_transaction_hash values from balance-changes.
   *
   * @param accountId - Account to load hashes for
   * @param limit - Maximum number of distinct hashes to return
   * @returns Array of transaction hashes
   */
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

  /**
   * NEAR-specific: Load all pending rows for given transaction hashes.
   *
   * @param accountId - Account to load data for
   * @param hashes - Transaction hashes to load
   * @returns All raw transactions matching the hashes
   */
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
      return wrapError(error, 'Failed to load pending data by hashes');
    }
  }

  /**
   * NEAR-specific: Load pending balance-changes and token-transfers by receiptId using JSON1 extraction.
   * Fails fast if JSON1 extension is not available.
   *
   * @param accountId - Account to load data for
   * @param receiptIds - Receipt IDs to match
   * @returns All raw transactions with matching receiptId in normalized_data
   */
  async loadPendingNearByReceiptIds(accountId: number, receiptIds: string[]): Promise<Result<RawTransaction[], Error>> {
    try {
      if (receiptIds.length === 0) {
        return ok([]);
      }

      // Verify JSON1 extension is available before attempting JSON extraction
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a JSON1 extension error
      if (
        errorMessage.includes('no such function: json_extract') ||
        errorMessage.includes('JSON1 extension') ||
        errorMessage.includes('json_extract')
      ) {
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

  /**
   * NEAR-specific: Load processed balance-changes for affected accounts up to a timestamp.
   * Used to seed delta derivation with the last known absolute balance.
   *
   * @param accountId - Account to load data for
   * @param affectedAccountIds - Affected account IDs to match
   * @param maxTimestamp - Upper bound (inclusive) for processed events
   * @returns All matching processed balance-changes
   */
  async loadProcessedNearBalanceChangesByAccounts(
    accountId: number,
    affectedAccountIds: string[],
    maxTimestamp: number
  ): Promise<Result<RawTransaction[], Error>> {
    try {
      if (affectedAccountIds.length === 0) {
        return ok([]);
      }

      // Verify JSON1 extension is available before attempting JSON extraction
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a JSON1 extension error
      if (
        errorMessage.includes('no such function: json_extract') ||
        errorMessage.includes('JSON1 extension') ||
        errorMessage.includes('json_extract')
      ) {
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

  /**
   * Verify JSON1 extension is available in SQLite.
   */
  private async verifyJson1Available(): Promise<Result<void, Error>> {
    try {
      // Test JSON1 by running a simple json_extract query
      await this.db
        .selectFrom('raw_transactions')
        .select(sql`json_extract('{"test": "value"}', '$.test')`.as('test'))
        .limit(1)
        .execute();

      return ok(undefined);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes('no such function: json_extract') ||
        errorMessage.includes('JSON1 extension') ||
        errorMessage.includes('json_extract')
      ) {
        return err(
          new Error(
            'SQLite JSON1 extension is not available. This is required for NEAR data processing. ' +
              'Please ensure SQLite is compiled with JSON1 support.'
          )
        );
      }

      return err(new Error(`Failed to verify JSON1 availability: ${errorMessage}`));
    }
  }

  /**
   * Convert database row to RawTransaction domain model
   * Handles JSON parsing and camelCase conversion
   */
  private toRawTransaction(row: Selectable<RawTransactionTable>): Result<RawTransaction, Error> {
    const rawDataResult = this.parseJson<unknown>(row['provider_data']);
    const normalizedDataResult = this.parseJson<unknown>(row['normalized_data']);

    // Fail fast on any parse errors
    if (rawDataResult.isErr()) {
      return err(rawDataResult.error);
    }
    if (normalizedDataResult.isErr()) {
      return err(normalizedDataResult.error);
    }

    // providerName is required in the domain model
    if (!row['provider_name']) {
      return err(new Error('Missing required provider_name field'));
    }

    return ok({
      id: row['id'],
      accountId: row['account_id'],
      providerName: row['provider_name'],
      sourceAddress: row['source_address'] ?? undefined,
      transactionTypeHint: row['transaction_type_hint'] ?? undefined,
      eventId: row['event_id'],
      blockchainTransactionHash: row['blockchain_transaction_hash'] ?? undefined,
      timestamp: row['timestamp'],
      providerData: rawDataResult.value,
      normalizedData: normalizedDataResult.value,
      processingStatus: row['processing_status'],
      processedAt: row['processed_at'] ? new Date(row['processed_at']) : undefined,
      createdAt: new Date(row['created_at']),
    });
  }
}
