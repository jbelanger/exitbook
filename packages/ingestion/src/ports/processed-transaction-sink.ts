import type { Result } from '@exitbook/core';

import type { TransactionDraft } from '../shared/types/processors.js';

/**
 * Port for persisting processed transactions.
 * The adapter handles transaction boundaries (e.g. DB transactions).
 */
export interface IProcessedTransactionSink {
  /**
   * Save a batch of processed transactions for an account.
   * Returns count of saved and duplicate-skipped transactions.
   */
  saveProcessedBatch(
    transactions: TransactionDraft[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>>;
}
