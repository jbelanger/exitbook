import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port for price enrichment. Will move to @exitbook/accounting.
 */
export interface PricingStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>>;
  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>>;

  updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>>;
  executePriceUpdateBatch(updates: UniversalTransactionData[]): Promise<Result<void, Error>>;
}

export class PricingStoreAdapter implements PricingStore {
  constructor(private readonly db: DataContext) {}
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async findConfirmedLinks(): Promise<Result<TransactionLink[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async executePriceUpdateBatch(updates: UniversalTransactionData[]): Promise<Result<void, Error>> {
    throw new Error('Not implemented');
  }
}
