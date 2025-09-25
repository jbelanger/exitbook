import type { UniversalTransaction } from '@crypto/core';

/**
 * Port interface for transaction repository operations.
 * Abstracts persistence layer for transaction storage from the application domain.
 */
export interface ITransactionRepository {
  /**
   * Save a transaction to the database.
   * Returns the database ID of the saved transaction.
   */
  save(transaction: UniversalTransaction): Promise<number>;

  /**
   * Save multiple transactions to the database.
   * Returns the count of successfully saved transactions.
   */
  saveBatch(transactions: UniversalTransaction[]): Promise<number>;
}
