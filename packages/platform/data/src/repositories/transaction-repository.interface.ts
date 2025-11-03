import type { UniversalTransaction } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Filters for querying transactions
 */
export interface TransactionFilters {
  /** Filter by source (blockchain or exchange name) */
  sourceId?: string | undefined;
  /** Filter by transactions created since this Unix timestamp */
  since?: number | undefined;
  /** Filter by data source session ID */
  sessionId?: number | undefined;
  /** Include transactions excluded from accounting (scam tokens, test data, etc.). Defaults to false. */
  includeExcluded?: boolean | undefined;
}

/**
 * Port interface for transaction repository operations.
 * Abstracts persistence layer for transaction storage from the application domain.
 */
export interface ITransactionRepository {
  /**
   * Retrieve transactions with optional filtering.
   */
  getTransactions(filters?: TransactionFilters): Promise<Result<UniversalTransaction[], Error>>;

  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(transaction: UniversalTransaction, dataSourceId: number): Promise<Result<number, Error>>;
}
