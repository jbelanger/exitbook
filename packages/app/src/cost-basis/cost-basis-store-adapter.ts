import type { CostBasisStore } from '@exitbook/accounting';
import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Adapts DataContext repositories to the CostBasisStore port.
 */
export class CostBasisStoreAdapter implements CostBasisStore {
  constructor(private readonly db: DataContext) {}

  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    return this.db.transactions.findAll();
  }

  findTransactionById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>> {
    return this.db.transactions.findById(id);
  }

  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>> {
    return this.db.transactionLinks.findAll('confirmed');
  }
}
