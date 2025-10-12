import type { UniversalTransaction } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port interface for transaction repository operations.
 * Abstracts persistence layer for transaction storage from the application domain.
 */
export interface ITransactionRepository {
  /**
   * Retrieve transactions by address (from or to).
   * Used for historical context in transaction processing.
   */
  findByAddress(address: string): Promise<Result<StoredTransaction[], Error>>;

  /**
   * Retrieve transactions by address within date range.
   * Used for historical balance validation.
   */
  findByDateRange(address: string, from: Date, to: Date): Promise<Result<StoredTransaction[], Error>>;

  /**
   * Retrieve recent transactions by address with limit.
   * Used for pattern analysis in transaction classification.
   */
  findRecent(address: string, limit: number): Promise<Result<StoredTransaction[], Error>>;

  /**
   * Get the count of transactions, optionally filtered by source.
   */
  getTransactionCount(sourceId?: string): Promise<Result<number, Error>>;

  /**
   * Retrieve transactions with optional filtering.
   */
  getTransactions(sourceId?: string, since?: number): Promise<Result<StoredTransaction[], Error>>;

  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(transaction: UniversalTransaction, importSessionId: number): Promise<Result<number, Error>>;
}
