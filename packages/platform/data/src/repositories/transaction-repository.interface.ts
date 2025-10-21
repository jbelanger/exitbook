import type { UniversalTransaction } from '@exitbook/core';
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
  findByAddress(address: string): Promise<Result<UniversalTransaction[], Error>>;

  /**
   * Retrieve transactions with optional filtering.
   */
  getTransactions(sourceId?: string, since?: number): Promise<Result<UniversalTransaction[], Error>>;

  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(transaction: UniversalTransaction, dataSourceId: number): Promise<Result<number, Error>>;
}
