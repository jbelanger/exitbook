import type { UniversalTransactionData } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Filters for querying transactions
 */
export interface TransactionFilters {
  /** Filter by source (blockchain or exchange name) */
  sourceName?: string | undefined;
  /** Filter by transactions created since this Unix timestamp */
  since?: number | undefined;
  /** Filter by account ID */
  accountId?: number | undefined;
  /** Filter by multiple account IDs. More efficient than multiple individual queries. */
  accountIds?: number[] | undefined;
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
  getTransactions(filters?: TransactionFilters): Promise<Result<UniversalTransactionData[], Error>>;

  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(
    transaction: Omit<UniversalTransactionData, 'id' | 'accountId'>,
    accountId: number
  ): Promise<Result<number, Error>>;

  /**
   * Find a transaction by its ID.
   */
  findById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>>;
}
