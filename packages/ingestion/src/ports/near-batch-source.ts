import type { RawTransaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

/**
 * Port for NEAR-specific multi-stream batch correlation.
 * NEAR requires cross-stream joins (transactions ↔ receipts ↔ balance-changes ↔ token-transfers)
 * that don't fit the generic IProcessingBatchSource contract.
 */
export interface INearBatchSource {
  /** Find distinct pending transaction hashes to anchor batch correlation. */
  fetchPendingAnchorHashes(accountId: number, limit: number): Promise<Result<string[], Error>>;

  /** Load all pending raw rows for a set of transaction hashes. */
  fetchPendingByHashes(accountId: number, hashes: string[]): Promise<Result<RawTransaction[], Error>>;

  /** Load pending balance-change rows by receipt ID (JSON1 join for rows missing transactionHash). */
  fetchPendingByReceiptIds(accountId: number, receiptIds: string[]): Promise<Result<RawTransaction[], Error>>;

  /**
   * Load previously-processed balance changes for delta derivation.
   * Used to compute missing deltas from absolute balance snapshots.
   */
  findProcessedBalanceChanges(
    accountId: number,
    affectedAccountIds: string[],
    beforeTimestamp: number
  ): Promise<Result<RawTransaction[], Error>>;
}
