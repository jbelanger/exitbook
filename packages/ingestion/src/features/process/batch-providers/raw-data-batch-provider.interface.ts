import type { RawTransaction } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Provides batches of raw transaction data for processing.
 * Different implementations handle different batching strategies:
 * - AllAtOnceBatchProvider: Loads all pending data in one batch (exchanges)
 * - HashGroupedBatchProvider: Loads data in hash-grouped batches (blockchains)
 * - NearStreamBatchProvider: NEAR-specific multi-stream batching
 */
export interface IRawDataBatchProvider {
  /**
   * Fetch the next batch of raw transactions to process.
   * Returns empty array when no more data is available.
   */
  fetchNextBatch(): Promise<Result<RawTransaction[], Error>>;

  /**
   * Check if more batches are available.
   * Returns false after all data has been fetched.
   */
  hasMore(): boolean;
}
