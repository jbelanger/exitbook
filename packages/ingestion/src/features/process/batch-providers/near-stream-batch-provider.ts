import type { RawTransaction } from '@exitbook/core';
import type { IRawDataRepository } from '@exitbook/data';
import { err, ok, type Result } from 'neverthrow';

import type { IRawDataBatchProvider } from './raw-data-batch-provider.interface.js';

/**
 * NEAR-specific batch provider that handles multi-stream data correlation.
 *
 * Strategy:
 * 1. Anchor on real tx hashes from transactions + receipts + token-transfers
 * 2. Load all pending rows for those hashes
 * 3. Extract receiptIds from receipt rows
 * 4. Fetch additional balance-changes missing transactionHash by receiptId using JSON1
 * 5. Merge and deduplicate by raw row ID
 *
 * This ensures all related NEAR events (transactions, receipts, balance changes, token transfers)
 * are processed together in a single batch for proper correlation.
 */
export class NearStreamBatchProvider implements IRawDataBatchProvider {
  private lastBatchWasEmpty = false;

  constructor(
    private readonly rawDataRepository: IRawDataRepository,
    private readonly accountId: number,
    private readonly hashBatchSize = 100
  ) {}

  async fetchNextBatch(): Promise<Result<RawTransaction[], Error>> {
    if (this.lastBatchWasEmpty) {
      return ok([]);
    }

    // 1) Anchor on transaction hashes from transactions + receipts + token-transfers
    const hashesResult = await this.rawDataRepository.loadPendingNearAnchorHashes(this.accountId, this.hashBatchSize);
    if (hashesResult.isErr()) {
      return err(hashesResult.error);
    }
    const hashes = hashesResult.value;

    if (hashes.length === 0) {
      this.lastBatchWasEmpty = true;
      return ok([]);
    }

    // 2) Load all pending rows for those hashes
    const baseResult = await this.rawDataRepository.loadPendingByHashes(this.accountId, hashes);
    if (baseResult.isErr()) {
      return baseResult;
    }
    const baseRows = baseResult.value;

    // 3) Collect receiptIds from receipt rows
    const receiptIds = new Set<string>();
    for (const row of baseRows) {
      if (row.transactionTypeHint !== 'receipts') continue;
      const receiptId = (row.normalizedData as { receiptId?: string }).receiptId;
      if (receiptId) {
        receiptIds.add(receiptId);
      }
    }

    // 4) Fetch balance-changes missing transactionHash linked by receiptId via JSON1
    const extraRows: RawTransaction[] = [];
    if (receiptIds.size > 0) {
      const extraResult = await this.rawDataRepository.loadPendingNearByReceiptIds(this.accountId, [...receiptIds]);
      if (extraResult.isErr()) {
        return extraResult;
      }
      extraRows.push(...extraResult.value);
    }

    // 5) Merge and deduplicate by raw row ID
    const byId = new Map<number, RawTransaction>();
    for (const row of [...baseRows, ...extraRows]) {
      byId.set(row.id, row);
    }

    return ok([...byId.values()]);
  }

  hasMore(): boolean {
    return !this.lastBatchWasEmpty;
  }
}
