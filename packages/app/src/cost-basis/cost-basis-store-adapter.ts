import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port for cost basis calculation. Will move to @exitbook/accounting.
 */
export interface CostBasisStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  findTransactionById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>>;
  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>>;
}

export class CostBasisStoreAdapter implements CostBasisStore {
  constructor(private readonly db: DataContext) {}
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async findTransactionById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- will be there when implemented
  async findConfirmedLinks(): Promise<Result<TransactionLink[], Error>> {
    throw new Error('Not implemented');
  }
}
