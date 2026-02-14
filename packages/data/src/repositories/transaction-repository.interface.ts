import type { UniversalTransactionData, TransactionStatus } from '@exitbook/core';
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
 * Full transaction projection filters.
 * Returns UniversalTransactionData with movements and fees.
 */
export interface FullTransactionFilters extends TransactionFilters {
  projection?: 'full' | undefined;
}

/**
 * Summary transaction projection filters.
 * Returns lightweight TransactionSummary without movements/fees.
 */
export interface SummaryTransactionFilters extends TransactionFilters {
  projection: 'summary';
}

/**
 * Lightweight transaction summary without movements/fees.
 * Useful for list views that don't need full movement data.
 */
export interface TransactionSummary {
  id: number;
  accountId: number;
  externalId: string;
  datetime: string;
  timestamp: number;
  source: string;
  sourceType: string;
  status: TransactionStatus;
  from?: string | undefined;
  to?: string | undefined;
  operation: { category: string; type: string };
  isSpam?: boolean | undefined;
  excludedFromAccounting?: boolean | undefined;
  blockchain?: { name: string; transaction_hash: string } | undefined;
}

/**
 * Port interface for transaction repository operations.
 * Abstracts persistence layer for transaction storage from the application domain.
 */
export interface ITransactionRepository {
  /**
   * Retrieve transactions with optional filtering.
   * Overloaded to return different types based on projection.
   */
  getTransactions(filters: SummaryTransactionFilters): Promise<Result<TransactionSummary[], Error>>;
  getTransactions(filters?: FullTransactionFilters): Promise<Result<UniversalTransactionData[], Error>>;

  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(
    transaction: Omit<UniversalTransactionData, 'id' | 'accountId'>,
    accountId: number
  ): Promise<Result<number, Error>>;

  /**
   * Save multiple transactions in a single database transaction.
   * Returns the total saved count and number of duplicates skipped via conflict handling.
   */
  saveBatch(
    transactions: Omit<UniversalTransactionData, 'id' | 'accountId'>[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>>;

  /**
   * Find a transaction by its ID.
   */
  findById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>>;
}
