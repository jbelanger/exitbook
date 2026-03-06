import type { PricingStore } from '@exitbook/accounting';
import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';

/**
 * Adapts DataContext repositories to the PricingStore port.
 */
export class PricingStoreAdapter implements PricingStore {
  constructor(private readonly db: DataContext) {}

  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    return this.db.transactions.findAll();
  }

  findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>> {
    return this.db.transactions.findNeedingPrices(assetFilter);
  }

  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>> {
    return this.db.transactionLinks.findAll('confirmed');
  }

  updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>> {
    return this.db.executeInTransaction((txCtx) => txCtx.transactions.updateMovementsWithPrices(tx));
  }
}
