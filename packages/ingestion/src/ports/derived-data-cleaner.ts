import type { Result } from '@exitbook/core';

export interface DerivedDataDeletionResult {
  transactions: number;
  links: number;
}

/**
 * Port for clearing derived (processed) data before reprocessing.
 * Keeps raw data and import sessions intact; removes transactions,
 * links, and consolidated movements, then resets raw processing status.
 */
export interface IDerivedDataCleaner {
  /**
   * Clear derived data and reset raw processing status to pending.
   * Scoped to accountId when provided; clears all when omitted.
   */
  clearDerivedData(accountId?: number): Promise<Result<DerivedDataDeletionResult, Error>>;
}
