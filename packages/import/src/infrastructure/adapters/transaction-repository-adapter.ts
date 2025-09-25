import type { UniversalTransaction } from '@crypto/core';
import type { Database } from '@crypto/data';

import type { ITransactionRepository } from '../../app/ports/transaction-repository.ts';

/**
 * Adapter that implements the ITransactionRepository port using the Database directly.
 * This bridges the application layer (ports) with the infrastructure layer.
 */
export class TransactionRepositoryAdapter implements ITransactionRepository {
  constructor(private database: Database) {}

  async save(transaction: UniversalTransaction): Promise<number> {
    return this.database.saveTransaction(transaction);
  }

  async saveBatch(transactions: UniversalTransaction[]): Promise<number> {
    let savedCount = 0;
    for (const transaction of transactions) {
      try {
        await this.database.saveTransaction(transaction);
        savedCount++;
      } catch (error) {
        // Log error but continue with other transactions
        console.error(`Failed to save transaction ${transaction.id}:`, error);
      }
    }
    return savedCount;
  }
}
