import type { UniversalTransactionData } from '@exitbook/core';
import type { Result } from 'neverthrow';

import type { TransactionLink } from '../linking/types.js';

/**
 * Port for cost basis calculation persistence.
 * Implemented by CostBasisStoreAdapter in the app layer.
 */
export interface CostBasisStore {
  findAllTransactions(): Promise<Result<UniversalTransactionData[], Error>>;
  findTransactionById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>>;
  findConfirmedLinks(): Promise<Result<TransactionLink[], Error>>;
}
