import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { Result } from '@exitbook/core';

/**
 * Port for price enrichment persistence.
 * Implemented by PricingStoreAdapter in the app layer.
 */
export interface PricingStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>>;
  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>>;

  /** Update prices for a single transaction atomically */
  updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>>;
}
