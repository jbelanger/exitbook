import type { RawTransaction } from '@exitbook/core';
import { ok, resultDoAsync, type Result } from '@exitbook/core';

import type { IProcessingBatchSource } from '../../../ports/processing-batch-source.js';

import type { IRawDataBatchProvider } from './raw-data-batch-provider.interface.js';

/**
 * Batch provider that loads data in hash-grouped batches.
 * Ensures all events with the same blockchain_transaction_hash are processed together.
 *
 * Used for blockchains to:
 * 1. Avoid loading 100k+ transactions into memory
 * 2. Maintain correlation integrity by keeping related events together
 */
export class HashGroupedBatchProvider implements IRawDataBatchProvider {
  private lastBatchWasEmpty = false;

  constructor(
    private readonly batchSource: IProcessingBatchSource,
    private readonly accountId: number,
    private readonly hashBatchSize = 100
  ) {}

  async fetchNextBatch(): Promise<Result<RawTransaction[], Error>> {
    if (this.lastBatchWasEmpty) {
      return ok([]);
    }

    return resultDoAsync(async function* (self) {
      const batch = yield* await self.batchSource.fetchPendingByTransactionHash(self.accountId, self.hashBatchSize);

      if (batch.length === 0) {
        self.lastBatchWasEmpty = true;
      }

      return batch;
    }, this);
  }

  hasMore(): boolean {
    return !this.lastBatchWasEmpty;
  }
}
