import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildCostBasisResetPorts,
  mockBuildIngestionPurgePorts,
  mockCountProjectionResetImpact,
  mockResetProjections,
} = vi.hoisted(() => ({
  mockBuildCostBasisResetPorts: vi.fn(),
  mockBuildIngestionPurgePorts: vi.fn(),
  mockCountProjectionResetImpact: vi.fn(),
  mockResetProjections: vi.fn(),
}));

vi.mock('@exitbook/data/accounting', () => ({
  buildCostBasisResetPorts: mockBuildCostBasisResetPorts,
}));

vi.mock('@exitbook/data/ingestion', () => ({
  buildIngestionPurgePorts: mockBuildIngestionPurgePorts,
}));

vi.mock('../../../../runtime/projection-reset.js', () => ({
  countProjectionResetImpact: mockCountProjectionResetImpact,
  resetProjections: mockResetProjections,
}));

import { AccountRemovalService, flattenAccountRemovePreview } from '../account-removal-service.js';

describe('AccountRemovalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCountProjectionResetImpact.mockResolvedValue(
      ok({
        assetReview: { assets: 2 },
        balances: { assetRows: 5, scopes: 3 },
        links: { links: 7 },
        processedTransactions: { transactions: 11 },
      })
    );
    mockBuildCostBasisResetPorts.mockReturnValue({
      countResetImpact: vi.fn().mockResolvedValue(ok({ snapshots: 13 })),
      reset: vi.fn().mockResolvedValue(ok({ snapshots: 13 })),
    });
    mockBuildIngestionPurgePorts.mockReturnValue({
      countPurgeImpact: vi.fn().mockResolvedValue(
        ok({
          accounts: 17,
          rawData: 19,
          sessions: 23,
        })
      ),
      purgeImportedData: vi.fn().mockResolvedValue(
        ok({
          accounts: 17,
          rawData: 19,
          sessions: 23,
        })
      ),
    });
    mockResetProjections.mockResolvedValue(ok(undefined));
  });

  it('flattens nested preview counts into CLI-facing totals', () => {
    expect(
      flattenAccountRemovePreview({
        accountIds: [1, 2],
        deleted: {
          assetReview: { assets: 2 },
          balances: { assetRows: 5, scopes: 3 },
          costBasisSnapshots: { snapshots: 13 },
          links: { links: 7 },
          processedTransactions: { transactions: 11 },
          purge: {
            accounts: 17,
            rawData: 19,
            sessions: 23,
          },
        },
      })
    ).toEqual({
      transactions: 11,
      links: 7,
      assetReviewStates: 2,
      balanceSnapshots: 3,
      balanceSnapshotAssets: 5,
      costBasisSnapshots: 13,
      accounts: 17,
      sessions: 23,
      rawData: 19,
    });
  });

  it('returns a wrapped preview error when projection impact counting fails', async () => {
    mockCountProjectionResetImpact.mockResolvedValueOnce(err(new Error('projection store unavailable')));
    const service = new AccountRemovalService({} as never, 9);

    const result = await service.preview([1]);

    expect(assertErr(result).message).toContain('Failed to count account removal projection impact');
    expect(assertErr(result).message).toContain('projection store unavailable');
  });

  it('executes resets and purge in one transaction and reverses deletion order', async () => {
    const txDb = { tag: 'tx-db' };
    const db = {
      executeInTransaction: vi.fn(
        async (operation: (database: typeof txDb) => Promise<unknown>) => await operation(txDb)
      ),
    };
    const costBasisReset = vi.fn().mockResolvedValue(ok({ snapshots: 13 }));
    const purgeImportedData = vi.fn().mockResolvedValue(
      ok({
        accounts: 17,
        rawData: 19,
        sessions: 23,
      })
    );

    mockBuildCostBasisResetPorts.mockImplementation((database: unknown) => ({
      countResetImpact: vi.fn().mockResolvedValue(ok({ snapshots: 13 })),
      reset: database === txDb ? costBasisReset : vi.fn().mockResolvedValue(ok({ snapshots: 13 })),
    }));
    mockBuildIngestionPurgePorts.mockImplementation((database: unknown) => ({
      countPurgeImpact: vi.fn().mockResolvedValue(
        ok({
          accounts: 17,
          rawData: 19,
          sessions: 23,
        })
      ),
      purgeImportedData: database === txDb ? purgeImportedData : vi.fn().mockResolvedValue(ok({})),
    }));

    const service = new AccountRemovalService(db as never, 9);
    const result = await service.execute([3, 5, 7]);

    expect(db.executeInTransaction).toHaveBeenCalledOnce();
    expect(mockResetProjections).toHaveBeenCalledWith(txDb, 'processed-transactions', [3, 5, 7]);
    expect(costBasisReset).toHaveBeenCalledWith([9]);
    expect(purgeImportedData).toHaveBeenCalledWith([7, 5, 3]);
    expect(assertOk(result)).toEqual({
      deleted: {
        transactions: 11,
        links: 7,
        assetReviewStates: 2,
        balanceSnapshots: 3,
        balanceSnapshotAssets: 5,
        costBasisSnapshots: 13,
        accounts: 17,
        sessions: 23,
        rawData: 19,
      },
    });
  });
});
