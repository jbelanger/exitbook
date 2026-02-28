import type { RawTransaction } from '@exitbook/core';
import type { RawTransactionRepository } from '@exitbook/data';
import { ok, type Result } from 'neverthrow';

import type { IRawDataBatchProvider } from './raw-data-batch-provider.interface.js';

/**
 * Batch provider that loads all pending data in a single batch.
 * Used for exchanges where data volumes are manageable and correlation
 * doesn't require grouping by transaction hash.
 */
export class AllAtOnceBatchProvider implements IRawDataBatchProvider {
  private fetched = false;

  constructor(
    private readonly rawDataRepository: RawTransactionRepository,
    private readonly accountId: number
  ) {}

  async fetchNextBatch(): Promise<Result<RawTransaction[], Error>> {
    if (this.fetched) {
      return ok([]);
    }

    this.fetched = true;

    const result = await this.rawDataRepository.findAll({
      processingStatus: 'pending',
      accountId: this.accountId,
    });

    return result;
  }

  hasMore(): boolean {
    return !this.fetched;
  }
}
