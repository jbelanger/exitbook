import type { Result } from '@exitbook/core';

export interface ProcessedTransactionsResetImpact {
  transactions: number;
}

/**
 * Port for resetting the processed-transactions projection.
 *
 * Owns:
 * - transactions (processing output)
 * - raw processing status reset back to pending
 */
export interface IProcessedTransactionsReset {
  countResetImpact(accountIds?: number[]): Promise<Result<ProcessedTransactionsResetImpact, Error>>;
  reset(accountIds?: number[]): Promise<Result<ProcessedTransactionsResetImpact, Error>>;
}
