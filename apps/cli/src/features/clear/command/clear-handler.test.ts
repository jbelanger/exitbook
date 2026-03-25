import type { DataSession } from '@exitbook/data/session';
import { ok } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { calculateTotalDeletionItems, createClearHandler, flattenPreview } from './clear-handler.js';

vi.mock('../../shared/projection-reset.js', () => ({
  countProjectionResetImpact: vi.fn().mockResolvedValue(
    ok({
      processedTransactions: { transactions: 5 },
      links: { links: 2 },
      assetReview: { assets: 7 },
      balances: { scopes: 3, assetRows: 11 },
    })
  ),
  resetProjections: vi.fn(),
}));

describe('clear-handler', () => {
  it('includes cost-basis snapshot impact in preview and flattened totals', async () => {
    const db = {
      costBasisSnapshots: {
        count: vi.fn().mockResolvedValue(ok(3)),
      },
      costBasisFailureSnapshots: {
        count: vi.fn().mockResolvedValue(ok(1)),
      },
      profiles: { findOrCreateDefault: vi.fn() },
      accounts: { findAll: vi.fn() },
      executeInTransaction: vi.fn(),
    } as unknown as DataSession;

    const handler = createClearHandler({ db });

    const previewResult = await handler.preview({ includeRaw: false });

    expect(previewResult.isOk()).toBe(true);
    if (previewResult.isErr()) {
      throw previewResult.error;
    }

    expect(previewResult.value.costBasisSnapshots.snapshots).toBe(4);

    const flat = flattenPreview(previewResult.value);
    expect(flat.transactions).toBe(5);
    expect(flat.links).toBe(2);
    expect(flat.assetReviewStates).toBe(7);
    expect(flat.balanceSnapshots).toBe(3);
    expect(flat.balanceSnapshotAssets).toBe(11);
    expect(flat.costBasisSnapshots).toBe(4);
    expect(calculateTotalDeletionItems(flat)).toBe(
      flat.transactions +
        flat.links +
        flat.assetReviewStates +
        flat.balanceSnapshots +
        flat.balanceSnapshotAssets +
        flat.costBasisSnapshots
    );
  });
});
