import type { RawTransaction } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

/**
 * Port for accessing pending raw data during the processing pipeline.
 * Implementations live in the data adapter layer.
 */
export interface IProcessingBatchSource {
  /** Find all accounts that have any raw data (regardless of processing status). */
  findAccountsWithRawData(profileId?: number): Promise<Result<number[], Error>>;

  /** Find all accounts that have unprocessed raw data. */
  findAccountsWithPendingData(profileId?: number): Promise<Result<number[], Error>>;

  /** Count unprocessed items for a single account. */
  countPending(accountId: number): Promise<Result<number, Error>>;

  /** Count unprocessed items grouped by stream type (e.g. "normal", "internal", "token"). */
  countPendingByStreamType(accountId: number): Promise<Result<Map<string, number>, Error>>;

  /** Fetch all pending raw data for an account in one shot (suitable for exchanges). */
  fetchAllPending(accountId: number): Promise<Result<RawTransaction[], Error>>;

  /**
   * Fetch pending raw data grouped by blockchain transaction hash.
   * Returns all events sharing up to `hashLimit` distinct hashes,
   * ensuring correlated events are processed together.
   */
  fetchPendingByTransactionHash(accountId: number, hashLimit: number): Promise<Result<RawTransaction[], Error>>;

  /** Mark raw data items as processed after successful transformation. */
  markProcessed(ids: number[]): Promise<Result<void, Error>>;
}
