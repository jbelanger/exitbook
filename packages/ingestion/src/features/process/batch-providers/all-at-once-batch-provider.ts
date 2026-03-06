import type { RawTransaction } from '@exitbook/core';
import { ok, type Result } from '@exitbook/core';

import type { IProcessingBatchSource } from '../../../ports/processing-batch-source.js';

import type { IRawDataBatchProvider } from './raw-data-batch-provider.interface.js';

/**
 * Batch provider that loads all pending data in a single batch.
 * Used for exchanges where data volumes are manageable and correlation
 * doesn't require grouping by transaction hash.
 */
export class AllAtOnceBatchProvider implements IRawDataBatchProvider {
  private fetched = false;

  constructor(
    private readonly batchSource: IProcessingBatchSource,
    private readonly accountId: number
  ) {}

  async fetchNextBatch(): Promise<Result<RawTransaction[], Error>> {
    if (this.fetched) {
      return ok([]);
    }

    this.fetched = true;

    return this.batchSource.fetchAllPending(this.accountId);
  }

  hasMore(): boolean {
    return !this.fetched;
  }
}
