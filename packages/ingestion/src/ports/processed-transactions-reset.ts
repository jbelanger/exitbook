import type { Result } from '@exitbook/foundation';

export interface ProcessedTransactionsResetImpact {
  ledgerSourceActivities: number;
  transactions: number;
}

/**
 * Port for resetting the processed-transactions projection.
 *
 * Owns:
 * - transactions (processing output)
 * - source activities and ledger journals/postings (shadow processing output)
 * - raw processing status reset back to pending
 */
export interface IProcessedTransactionsReset {
  countResetImpact(accountIds?: number[]): Promise<Result<ProcessedTransactionsResetImpact, Error>>;
  reset(accountIds?: number[]): Promise<Result<ProcessedTransactionsResetImpact, Error>>;
}
