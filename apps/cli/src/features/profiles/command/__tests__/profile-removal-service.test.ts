import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileRemovalService } from '../profile-removal-service.js';

vi.mock('../../../../runtime/projection-reset.js', () => ({
  countProjectionResetImpact: vi.fn().mockResolvedValue(
    ok({
      processedTransactions: { ledgerSourceActivities: 0, transactions: 0 },
      links: { links: 0 },
      assetReview: { assets: 0 },
      balances: { scopes: 0, assetRows: 0 },
    })
  ),
  resetProjections: vi.fn().mockResolvedValue(
    ok({
      processedTransactions: { ledgerSourceActivities: 0, transactions: 0 },
      links: { links: 0 },
      assetReview: { assets: 0 },
      balances: { scopes: 0, assetRows: 0 },
    })
  ),
}));

describe('ProfileRemovalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts scoped cost-basis snapshots even when the profile has no accounts', async () => {
    const costBasisCount = vi.fn().mockResolvedValue(ok(2));
    const costBasisFailureCount = vi.fn().mockResolvedValue(ok(1));
    const db = {
      costBasisSnapshots: { count: costBasisCount },
      costBasisFailureSnapshots: { count: costBasisFailureCount },
      executeInTransaction: vi.fn(),
    } as unknown as ConstructorParameters<typeof ProfileRemovalService>[0];

    const service = new ProfileRemovalService(db, 2);
    const preview = assertOk(await service.preview([]));

    expect(preview.deleted.costBasisSnapshots.snapshots).toBe(3);
    expect(costBasisCount).toHaveBeenCalledWith(['profile:2']);
    expect(costBasisFailureCount).toHaveBeenCalledWith(['profile:2']);
  });

  it('resets scoped cost-basis snapshots before deleting an empty profile', async () => {
    const costBasisDelete = vi.fn().mockResolvedValue(ok(2));
    const costBasisFailureDelete = vi.fn().mockResolvedValue(ok(1));
    const txExecuteInTransaction = vi.fn();
    const txDb = {
      costBasisSnapshots: { deleteLatest: costBasisDelete, count: vi.fn().mockResolvedValue(ok(2)) },
      costBasisFailureSnapshots: {
        deleteLatest: costBasisFailureDelete,
        count: vi.fn().mockResolvedValue(ok(1)),
      },
      executeInTransaction: txExecuteInTransaction,
      profiles: {
        deleteByKey: vi.fn().mockResolvedValue(ok(undefined)),
      },
    };
    txExecuteInTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<unknown>) => fn(txDb));

    const dbExecuteInTransaction = vi.fn();
    const db = {
      ...txDb,
      executeInTransaction: dbExecuteInTransaction,
    } as unknown as ConstructorParameters<typeof ProfileRemovalService>[0];
    dbExecuteInTransaction.mockImplementation(async (fn: (db: typeof txDb) => Promise<unknown>) => fn(txDb));

    const service = new ProfileRemovalService(db, 2);
    const result = assertOk(await service.execute('business', []));

    expect(result.deleted.profiles).toBe(1);
    expect(costBasisDelete).toHaveBeenCalledWith(['profile:2']);
    expect(costBasisFailureDelete).toHaveBeenCalledWith(['profile:2']);
    expect(txDb.profiles.deleteByKey).toHaveBeenCalledWith('business');
  });
});
