import type { ProjectionStatus, Result } from '@exitbook/core';

export interface ProcessedTransactionsFreshnessResult {
  status: ProjectionStatus;
  reason: string | undefined;
}

/**
 * Port for checking whether the processed-transactions projection is fresh.
 *
 * Freshness is stale when:
 * - Raw data has never been processed
 * - Account graph changed (new account added/removed)
 * - A new import completed since last build
 */
export interface IProcessedTransactionsFreshness {
  checkFreshness(): Promise<Result<ProcessedTransactionsFreshnessResult, Error>>;
}
