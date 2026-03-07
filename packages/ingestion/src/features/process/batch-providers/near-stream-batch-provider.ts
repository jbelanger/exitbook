import type { RawTransaction } from '@exitbook/core';
import { ok, resultDoAsync, type Result } from '@exitbook/core';

import type { INearBatchSource } from '../../../ports/near-batch-source.js';

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
    private readonly nearBatchSource: INearBatchSource,
    private readonly accountId: number,
    private readonly hashBatchSize = 100
  ) {}

  async fetchNextBatch(): Promise<Result<RawTransaction[], Error>> {
    if (this.lastBatchWasEmpty) {
      return ok([]);
    }

    return resultDoAsync(async function* (self) {
      // 1) Anchor on transaction hashes from transactions + receipts + token-transfers
      const hashes = yield* await self.nearBatchSource.fetchPendingAnchorHashes(self.accountId, self.hashBatchSize);

      if (hashes.length === 0) {
        self.lastBatchWasEmpty = true;
        return [];
      }

      // 2) Load all pending rows for those hashes
      const baseRows = yield* await self.nearBatchSource.fetchPendingByHashes(self.accountId, hashes);

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
      const extraRows: RawTransaction[] =
        receiptIds.size > 0
          ? yield* await self.nearBatchSource.fetchPendingByReceiptIds(self.accountId, [...receiptIds])
          : [];

      // 5) Merge and deduplicate by raw row ID
      const byId = new Map<number, RawTransaction>();
      for (const row of [...baseRows, ...extraRows]) {
        byId.set(row.id, row);
      }

      return [...byId.values()];
    }, this);
  }

  hasMore(): boolean {
    return !this.lastBatchWasEmpty;
  }
}
