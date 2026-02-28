import type { RawTransaction } from '@exitbook/core';
import type { RawTransactionRepository } from '@exitbook/data';
import { ok, type Result } from 'neverthrow';

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
    private readonly rawDataQueries: RawTransactionRepository,
    private readonly accountId: number,
    private readonly hashBatchSize = 100
  ) {}

  async fetchNextBatch(): Promise<Result<RawTransaction[], Error>> {
    if (this.lastBatchWasEmpty) {
      return ok([]);
    }

    const result = await this.rawDataQueries.findByHashBatch(this.accountId, this.hashBatchSize);

    if (result.isErr()) {
      return result;
    }

    const batch = result.value;

    if (batch.length === 0) {
      this.lastBatchWasEmpty = true;
    }

    return ok(batch);
  }

  hasMore(): boolean {
    return !this.lastBatchWasEmpty;
  }
}
