import type { StoredTransaction } from '@exitbook/data';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';

/**
 * Port interface for transaction repository operations.
 * Abstracts persistence layer for transaction storage from the application domain.
 */
export interface ITransactionRepository {
  /**
   * Retrieve transactions by address (from or to).
   * Used for historical context in transaction processing.
   */
  findByAddress(address: string): Promise<StoredTransaction[]>;

  /**
   * Retrieve transactions by address within date range.
   * Used for historical balance validation.
   */
  findByDateRange(address: string, from: Date, to: Date): Promise<StoredTransaction[]>;

  /**
   * Retrieve recent transactions by address with limit.
   * Used for pattern analysis in transaction classification.
   */
  findRecent(address: string, limit: number): Promise<StoredTransaction[]>;

  /**
   * Get the count of transactions, optionally filtered by source.
   */
  getTransactionCount(sourceId?: string): Promise<number> | undefined;

  /**
   * Retrieve transactions with optional filtering.
   */
  getTransactions(sourceId?: string, since?: number): Promise<StoredTransaction[]>;

  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(transaction: UniversalTransaction, importSessionId: number): Promise<number>;
}
