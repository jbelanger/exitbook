import type { Account, UniversalTransactionData, VerificationMetadata } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Result } from 'neverthrow';

/**
 * Port for balance verification persistence.
 */
export interface BalanceStore {
  findAccountById(id: number): Promise<Result<Account | undefined, Error>>;
  findTransactionsByAccountId(accountId: number): Promise<Result<UniversalTransactionData[], Error>>;
  updateVerificationMetadata(accountId: number, metadata: VerificationMetadata): Promise<Result<void, Error>>;
}

export class BalanceStoreAdapter implements BalanceStore {
  constructor(private readonly db: DataContext) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async findAccountById(id: number): Promise<Result<Account | undefined, Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async findTransactionsByAccountId(accountId: number): Promise<Result<UniversalTransactionData[], Error>> {
    throw new Error('Not implemented');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async updateVerificationMetadata(accountId: number, metadata: VerificationMetadata): Promise<Result<void, Error>> {
    throw new Error('Not implemented');
  }
}
