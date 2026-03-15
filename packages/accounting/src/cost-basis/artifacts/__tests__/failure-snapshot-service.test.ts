import { err, ok } from '@exitbook/core';
import { describe, expect, it, vi } from 'vitest';

import type { ICostBasisFailureSnapshotStore } from '../../../ports/cost-basis-persistence.js';
import { persistCostBasisFailureSnapshot } from '../failure-snapshot-service.js';

describe('persistCostBasisFailureSnapshot', () => {
  it('persists a latest failure snapshot keyed by scope and consumer', async () => {
    const replaceLatest = vi.fn().mockResolvedValue(ok(undefined));
    const store: ICostBasisFailureSnapshotStore = {
      replaceLatest,
    };

    const result = await persistCostBasisFailureSnapshot(store, {
      consumer: 'portfolio',
      input: {
        config: {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01T00:00:00.000Z'),
          endDate: new Date('2024-12-31T23:59:59.999Z'),
        },
      },
      dependencyWatermark: {
        links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
        assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01.000Z') },
        pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
        exclusionFingerprint: 'excluded-assets:none',
      },
      error: new Error('boom'),
      stage: 'portfolio.standard-cost-basis',
    });

    expect(result.isOk()).toBe(true);
    expect(replaceLatest).toHaveBeenCalledTimes(1);
    expect(replaceLatest).toHaveBeenCalledWith(
      expect.objectContaining({
        consumer: 'portfolio',
        jurisdiction: 'US',
        method: 'fifo',
        errorMessage: 'boom',
        debugJson: JSON.stringify({ stage: 'portfolio.standard-cost-basis' }),
      })
    );
  });

  it('returns the store error when persistence fails', async () => {
    const store: ICostBasisFailureSnapshotStore = {
      replaceLatest: vi.fn().mockResolvedValue(err(new Error('db write failed'))),
    };

    const result = await persistCostBasisFailureSnapshot(store, {
      consumer: 'cost-basis',
      input: {
        config: {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
          startDate: new Date('2024-01-01T00:00:00.000Z'),
          endDate: new Date('2024-12-31T23:59:59.999Z'),
        },
      },
      dependencyWatermark: {
        links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
        assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01.000Z') },
        pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
        exclusionFingerprint: 'excluded-assets:none',
      },
      error: new Error('boom'),
      stage: 'artifact-service.execute',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('db write failed');
    }
  });
});
