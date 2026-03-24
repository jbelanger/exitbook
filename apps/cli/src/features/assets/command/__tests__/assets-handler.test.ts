import type {
  AssetReviewSummary,
  BalanceSnapshot,
  BalanceSnapshotAsset,
  OverrideEvent,
  Transaction,
} from '@exitbook/core';
import type { DataContext } from '@exitbook/data/context';
import type { OverrideStore } from '@exitbook/data/overrides';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import { createCliAssetReviewProjectionRuntime } from '../../../shared/asset-review-projection-runtime.js';
import {
  invalidateAssetReviewProjection,
  readAssetReviewProjectionSummaries,
} from '../../../shared/asset-review-projection-store.js';
import { AssetsHandler } from '../assets-handler.js';

vi.mock('../../../shared/asset-review-projection-runtime.js', () => ({
  createCliAssetReviewProjectionRuntime: vi.fn(),
}));

vi.mock('../../../shared/asset-review-projection-store.js', () => ({
  invalidateAssetReviewProjection: vi.fn(),
  readAssetReviewProjectionSummaries: vi.fn(),
}));

function createTransaction(params: {
  fees?: { amount: string; assetId: string; assetSymbol: string }[] | undefined;
  id: number;
  inflows?: { amount: string; assetId: string; assetSymbol: string }[] | undefined;
  outflows?: { amount: string; assetId: string; assetSymbol: string }[] | undefined;
}): Transaction {
  const inflows = params.inflows ?? [];
  const outflows = params.outflows ?? [];
  const fees = params.fees ?? [];

  return createPersistedTransaction({
    id: params.id,
    accountId: 1,
    txFingerprint: `tx-${params.id}`,
    datetime: '2024-01-01T00:00:00.000Z',
    timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
    source: 'kraken',
    sourceType: 'exchange',
    status: 'success',
    movements: {
      inflows: inflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol as Currency,
        grossAmount: parseDecimal(movement.amount),
      })),
      outflows: outflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol as Currency,
        grossAmount: parseDecimal(movement.amount),
      })),
    },
    fees: fees.map((fee) => ({
      assetId: fee.assetId,
      assetSymbol: fee.assetSymbol as Currency,
      amount: parseDecimal(fee.amount),
      scope: 'platform',
      settlement: 'balance',
    })),
    operation: {
      category: 'trade',
      type: 'swap',
    },
  });
}

function createMockOverrideStore() {
  return {
    append: vi.fn(),
    exists: vi.fn(),
    readByScopes: vi.fn(),
  };
}

function createSnapshotAsset(
  assetId: string,
  assetSymbol: string,
  calculatedBalance: string,
  scopeAccountId = 1
): BalanceSnapshotAsset {
  return {
    scopeAccountId,
    assetId,
    assetSymbol,
    calculatedBalance,
    excludedFromAccounting: false,
  };
}

function createSnapshot(scopeAccountId: number): BalanceSnapshot {
  return {
    scopeAccountId,
    verificationStatus: 'match',
    matchCount: 1,
    warningCount: 0,
    mismatchCount: 0,
  };
}

function createMockDb(
  transactions: Transaction[],
  snapshotAssets: BalanceSnapshotAsset[] = [],
  options?: {
    freshnessByScope?: Map<number, { reason?: string | undefined; status: 'building' | 'failed' | 'fresh' | 'stale' }>;
  }
) {
  const snapshotRows = [...new Set(snapshotAssets.map((asset) => asset.scopeAccountId))].map((scopeAccountId) =>
    createSnapshot(scopeAccountId)
  );

  return {
    transactions: {
      findAll: vi.fn().mockResolvedValue(ok(transactions)),
    },
    projectionState: {
      get: vi.fn().mockImplementation(async (_projectionId: string, scopeKey: string) => {
        const scopeAccountId = Number(scopeKey.replace('balance:', ''));
        const freshness = options?.freshnessByScope?.get(scopeAccountId);
        if (!freshness || freshness.status === 'fresh') {
          return ok(undefined);
        }

        return ok({
          projectionId: 'balances',
          scopeKey,
          status: freshness.status,
          lastBuiltAt: undefined,
          lastInvalidatedAt: undefined,
          invalidatedBy: freshness.reason,
          metadata: undefined,
        });
      }),
    },
    balanceSnapshots: {
      findAssetsByScope: vi
        .fn()
        .mockImplementation(async (scopeAccountIds?: number[]) =>
          ok(
            scopeAccountIds
              ? snapshotAssets.filter((asset) => scopeAccountIds.includes(asset.scopeAccountId))
              : snapshotAssets
          )
        ),
      findSnapshot: vi
        .fn()
        .mockImplementation(async (scopeAccountId: number) =>
          ok(snapshotRows.find((snapshot) => snapshot.scopeAccountId === scopeAccountId))
        ),
      findSnapshots: vi.fn().mockResolvedValue(ok(snapshotRows)),
    },
  };
}

function createAssetReviewSummary(assetId: string, overrides: Partial<AssetReviewSummary> = {}): AssetReviewSummary {
  return {
    assetId,
    reviewStatus: 'needs-review',
    referenceStatus: 'unknown',
    evidenceFingerprint: `asset-review:v1:${assetId}`,
    confirmationIsStale: false,
    accountingBlocked: true,
    warningSummary: 'Suspicious asset evidence requires review',
    evidence: [
      {
        kind: 'spam-flag',
        severity: 'error',
        message: 'Processed transactions marked this asset as spam',
      },
    ],
    ...overrides,
  };
}

function createAssetExcludeEvent(assetId: string): OverrideEvent {
  return {
    id: `exclude:${assetId}`,
    created_at: '2026-03-10T10:00:00.000Z',
    actor: 'user',
    source: 'cli',
    scope: 'asset-exclude',
    payload: {
      type: 'asset_exclude',
      asset_id: assetId,
    },
  };
}

function createAssetReviewConfirmEvent(assetId: string, evidenceFingerprint: string): OverrideEvent {
  return {
    id: `review-confirm:${assetId}`,
    created_at: '2026-03-10T10:05:00.000Z',
    actor: 'user',
    source: 'cli',
    scope: 'asset-review-confirm',
    payload: {
      type: 'asset_review_confirm',
      asset_id: assetId,
      evidence_fingerprint: evidenceFingerprint,
    },
  };
}

describe('AssetsHandler', () => {
  const mockAssetReviewProjectionRuntime = {
    ensureFresh: vi.fn(),
    rebuild: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetReviewProjectionRuntime.ensureFresh.mockResolvedValue(ok(undefined));
    mockAssetReviewProjectionRuntime.rebuild.mockResolvedValue(ok(undefined));
    vi.mocked(createCliAssetReviewProjectionRuntime).mockReturnValue(
      mockAssetReviewProjectionRuntime as ReturnType<typeof createCliAssetReviewProjectionRuntime>
    );
    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(ok(new Map()));
    vi.mocked(invalidateAssetReviewProjection).mockResolvedValue(ok(undefined));
  });

  it('writes an asset-exclude event after resolving a unique symbol', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);
    mockOverrideStore.append.mockResolvedValue(ok(undefined));

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.exclude({ symbol: 'scam', reason: 'junk airdrop' });

    const value = assertOk(result);
    expect(value).toMatchObject({
      action: 'exclude',
      assetId: 'blockchain:ethereum:0xscam',
      assetSymbols: ['SCAM'],
      changed: true,
      reason: 'junk airdrop',
    });
    expect(mockDb.transactions.findAll).toHaveBeenCalledWith({ includeExcluded: true });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'asset-exclude',
      payload: {
        type: 'asset_exclude',
        asset_id: 'blockchain:ethereum:0xscam',
      },
      reason: 'junk airdrop',
    });
  });

  it('returns an error when symbol resolution is ambiguous', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'exchange:kraken:usdc', assetSymbol: 'USDC', amount: '10' }],
      }),
      createTransaction({
        id: 2,
        inflows: [{ assetId: 'blockchain:ethereum:0xa0b8', assetSymbol: 'USDC', amount: '12' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.exclude({ symbol: 'USDC' });

    const error = assertErr(result);
    expect(error.message).toContain("Symbol 'USDC' is ambiguous");
    expect(error.message).toContain('exchange:kraken:usdc');
    expect(error.message).toContain('blockchain:ethereum:0xa0b8');
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
  });

  it('returns unchanged for include when the asset is not currently excluded', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.include({ assetId: 'blockchain:ethereum:0xscam' });

    const value = assertOk(result);
    expect(value.changed).toBe(false);
    expect(value.action).toBe('include');
    expect(mockOverrideStore.append).not.toHaveBeenCalled();
  });

  it('lists current exclusions with transaction and movement counts', async () => {
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '100' }],
        fees: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '1' }],
      }),
      createTransaction({
        id: 2,
        outflows: [{ assetId: 'blockchain:ethereum:0xscam', assetSymbol: 'SCAM', amount: '40' }],
      }),
      createTransaction({
        id: 3,
        inflows: [{ assetId: 'exchange:kraken:dust', assetSymbol: 'DUST', amount: '2' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockImplementation((scopes: string[]) => {
      if (scopes.includes('asset-exclude')) {
        return Promise.resolve(ok([createAssetExcludeEvent('blockchain:ethereum:0xscam')]));
      }

      return Promise.resolve(ok([]));
    });

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.listExclusions();

    const value = assertOk(result);
    expect(value.excludedAssets).toEqual([
      {
        assetId: 'blockchain:ethereum:0xscam',
        assetSymbols: ['SCAM'],
        movementCount: 3,
        transactionCount: 2,
      },
    ]);
  });

  it('returns override replay errors without swallowing them', async () => {
    const mockDb = createMockDb([]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockResolvedValue(err(new Error('overrides are invalid')));

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.listExclusions();

    const error = assertErr(result);
    expect(error.message).toContain('Failed to read asset exclusion override events');
  });

  it('filters assets view down to needs-review assets', async () => {
    const scamAssetId = 'blockchain:ethereum:0xscam';
    const safeAssetId = 'exchange:kraken:btc';
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [
          { assetId: scamAssetId, assetSymbol: 'SCAM', amount: '100' },
          { assetId: safeAssetId, assetSymbol: 'BTC', amount: '1' },
        ],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);
    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(
      ok(
        new Map([
          [scamAssetId, createAssetReviewSummary(scamAssetId)],
          [
            safeAssetId,
            createAssetReviewSummary(safeAssetId, {
              reviewStatus: 'clear',
              accountingBlocked: false,
              warningSummary: undefined,
              evidence: [],
            }),
          ],
        ])
      )
    );

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.view({ actionRequiredOnly: true });
    const value = assertOk(result);

    expect(value.assets).toHaveLength(1);
    expect(value.assets[0]?.assetId).toBe(scamAssetId);
    expect(value.assets[0]?.reviewStatus).toBe('needs-review');
    expect(value.actionRequiredCount).toBe(1);
    expect(value.totalCount).toBe(2);
  });

  it('does not surface override-only exclusions in assets view', async () => {
    const orphanExcludedAssetId = 'blockchain:ethereum:0xorphan';
    const mockDb = createMockDb([]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockImplementation((scopes: string[]) => {
      if (scopes.includes('asset-exclude')) {
        return Promise.resolve(ok([createAssetExcludeEvent(orphanExcludedAssetId)]));
      }

      return Promise.resolve(ok([]));
    });

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const viewResult = await handler.view();
    const viewValue = assertOk(viewResult);

    expect(viewValue.assets).toEqual([]);
    expect(viewValue.excludedCount).toBe(0);
    expect(viewValue.totalCount).toBe(0);

    const exclusionsResult = await handler.listExclusions();
    const exclusionsValue = assertOk(exclusionsResult);

    expect(exclusionsValue.excludedAssets).toEqual([
      {
        assetId: orphanExcludedAssetId,
        assetSymbols: [],
        movementCount: 0,
        transactionCount: 0,
      },
    ]);
  });

  it('uses balance snapshot assets for current quantity instead of recalculating from transactions', async () => {
    const assetId = 'blockchain:ethereum:0xheld';
    const mockDb = createMockDb(
      [
        createTransaction({
          id: 1,
          inflows: [{ assetId, assetSymbol: 'HELD', amount: '100' }],
        }),
      ],
      [createSnapshotAsset(assetId, 'HELD', '25')]
    );
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.view();
    const value = assertOk(result);

    expect(value.assets).toHaveLength(1);
    expect(value.assets[0]).toMatchObject({
      assetId,
      currentQuantity: '25',
    });
  });

  it('returns an error when snapshot-backed holdings are stale', async () => {
    const assetId = 'blockchain:ethereum:0xheld';
    const mockDb = createMockDb([], [createSnapshotAsset(assetId, 'HELD', '25')], {
      freshnessByScope: new Map([[1, { status: 'stale', reason: 'upstream-import:processed-transactions' }]]),
    });
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.view();
    const error = assertErr(result);

    expect(error.message).toContain('Assets view requires fresh balance snapshots');
    expect(error.message).toContain('balance refresh --account-id 1');
  });

  it('explains when all stored balance snapshots were invalidated', async () => {
    const assetId = 'exchange:kraken:btc';
    const mockDb = createMockDb([], [createSnapshotAsset(assetId, 'BTC', '25')], {
      freshnessByScope: new Map([[1, { status: 'stale', reason: 'upstream-rebuilt:processed-transactions' }]]),
    });
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.view();
    const error = assertErr(result);

    expect(error.message).toContain('invalidated stored balance snapshots for all scopes');
    expect(error.message).toContain('exitbook balance refresh" to rebuild all stored balances');
    expect(error.message).toContain('exitbook balance refresh --account-id 1');
  });

  it('resolves symbols from snapshot-only holdings', async () => {
    const assetId = 'blockchain:ethereum:0xdust';
    const mockDb = createMockDb([], [createSnapshotAsset(assetId, 'DUST', '2.5')]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);
    mockOverrideStore.append.mockResolvedValue(ok(undefined));

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.exclude({ symbol: 'dust' });
    const value = assertOk(result);

    expect(value.assetId).toBe(assetId);
    expect(value.assetSymbols).toEqual(['DUST']);
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'asset-exclude',
      payload: {
        type: 'asset_exclude',
        asset_id: assetId,
      },
      reason: undefined,
    });
  });

  it('keeps reviewed but still-blocking ambiguity assets in the needs-review filter', async () => {
    const ambiguousAssetId = 'blockchain:ethereum:0xaaa';
    const safeAssetId = 'exchange:kraken:btc';
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: ambiguousAssetId, assetSymbol: 'USDC', amount: '100' }],
      }),
      createTransaction({
        id: 2,
        inflows: [{ assetId: safeAssetId, assetSymbol: 'BTC', amount: '1' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);
    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(
      ok(
        new Map([
          [
            ambiguousAssetId,
            createAssetReviewSummary(ambiguousAssetId, {
              reviewStatus: 'reviewed',
              accountingBlocked: true,
              evidence: [
                {
                  kind: 'same-symbol-ambiguity',
                  severity: 'warning',
                  message: 'Same-chain symbol ambiguity on ethereum:usdc',
                },
              ],
            }),
          ],
          [
            safeAssetId,
            createAssetReviewSummary(safeAssetId, {
              reviewStatus: 'clear',
              accountingBlocked: false,
              warningSummary: undefined,
              evidence: [],
            }),
          ],
        ])
      )
    );

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.view({ actionRequiredOnly: true });
    const value = assertOk(result);

    expect(value.assets).toHaveLength(1);
    expect(value.assets[0]?.assetId).toBe(ambiguousAssetId);
    expect(value.assets[0]?.reviewStatus).toBe('reviewed');
    expect(value.assets[0]?.accountingBlocked).toBe(true);
    expect(value.actionRequiredCount).toBe(1);
    expect(value.totalCount).toBe(2);
  });

  it('does not keep excluded blocked assets in the action-required filter', async () => {
    const blockedAssetId = 'blockchain:ethereum:0xscam';
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: blockedAssetId, assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.readByScopes.mockImplementation((scopes: string[]) => {
      if (scopes.includes('asset-exclude')) {
        return Promise.resolve(ok([createAssetExcludeEvent(blockedAssetId)]));
      }

      return Promise.resolve(ok([]));
    });
    vi.mocked(readAssetReviewProjectionSummaries).mockResolvedValue(
      ok(
        new Map([
          [
            blockedAssetId,
            createAssetReviewSummary(blockedAssetId, {
              accountingBlocked: true,
            }),
          ],
        ])
      )
    );

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.view({ actionRequiredOnly: true });
    const value = assertOk(result);

    expect(value.assets).toEqual([]);
    expect(value.actionRequiredCount).toBe(0);
    expect(value.excludedCount).toBe(1);
    expect(value.totalCount).toBe(1);
  });

  it('writes an asset-review-confirm event for a suspicious asset', async () => {
    const scamAssetId = 'blockchain:ethereum:0xscam';
    const reviewSummary = createAssetReviewSummary(scamAssetId, {
      evidenceFingerprint: 'asset-review:v1:fingerprint-1',
    });
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: scamAssetId, assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(false);
    mockOverrideStore.append.mockResolvedValue(ok(undefined));
    vi.mocked(readAssetReviewProjectionSummaries)
      .mockResolvedValueOnce(ok(new Map([[scamAssetId, reviewSummary]])))
      .mockResolvedValueOnce(
        ok(
          new Map([
            [
              scamAssetId,
              createAssetReviewSummary(scamAssetId, {
                reviewStatus: 'reviewed',
                accountingBlocked: false,
                evidenceFingerprint: 'asset-review:v1:fingerprint-1',
              }),
            ],
          ])
        )
      );

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.confirmReview({ assetId: scamAssetId, reason: 'intentional contract' });
    const value = assertOk(result);

    expect(value).toMatchObject({
      action: 'confirm',
      assetId: scamAssetId,
      changed: true,
      evidenceFingerprint: 'asset-review:v1:fingerprint-1',
      reviewStatus: 'reviewed',
      confirmationIsStale: false,
    });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'asset-review-confirm',
      payload: {
        type: 'asset_review_confirm',
        asset_id: scamAssetId,
        evidence_fingerprint: 'asset-review:v1:fingerprint-1',
      },
      reason: 'intentional contract',
    });
    expect(invalidateAssetReviewProjection).toHaveBeenCalledWith(expect.anything(), 'override:asset-review-confirm');
  });

  it('writes an asset-review-clear event and reopens the asset to needs-review', async () => {
    const scamAssetId = 'blockchain:ethereum:0xscam';
    const reviewSummary = createAssetReviewSummary(scamAssetId, {
      reviewStatus: 'reviewed',
      evidenceFingerprint: 'asset-review:v1:fingerprint-1',
      confirmedEvidenceFingerprint: 'asset-review:v1:fingerprint-1',
    });
    const mockDb = createMockDb([
      createTransaction({
        id: 1,
        inflows: [{ assetId: scamAssetId, assetSymbol: 'SCAM', amount: '100' }],
      }),
    ]);
    const mockOverrideStore = createMockOverrideStore();
    mockOverrideStore.exists.mockReturnValue(true);
    mockOverrideStore.append.mockResolvedValue(ok(undefined));
    mockOverrideStore.readByScopes.mockImplementation((scopes: string[]) => {
      if (scopes.includes('asset-review-confirm')) {
        return Promise.resolve(ok([createAssetReviewConfirmEvent(scamAssetId, 'asset-review:v1:fingerprint-1')]));
      }

      return Promise.resolve(ok([]));
    });
    vi.mocked(readAssetReviewProjectionSummaries)
      .mockResolvedValueOnce(ok(new Map([[scamAssetId, reviewSummary]])))
      .mockResolvedValueOnce(
        ok(
          new Map([
            [
              scamAssetId,
              createAssetReviewSummary(scamAssetId, { evidenceFingerprint: 'asset-review:v1:fingerprint-1' }),
            ],
          ])
        )
      );

    const handler = new AssetsHandler(
      mockDb as unknown as DataContext,
      mockOverrideStore as unknown as Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>,
      '/tmp/test-data'
    );

    const result = await handler.clearReview({ assetId: scamAssetId, reason: 'reopen review' });
    const value = assertOk(result);

    expect(value).toMatchObject({
      action: 'clear-review',
      assetId: scamAssetId,
      changed: true,
      reviewStatus: 'needs-review',
      evidenceFingerprint: 'asset-review:v1:fingerprint-1',
    });
    expect(mockOverrideStore.append).toHaveBeenCalledWith({
      scope: 'asset-review-clear',
      payload: {
        type: 'asset_review_clear',
        asset_id: scamAssetId,
      },
      reason: 'reopen review',
    });
    expect(invalidateAssetReviewProjection).toHaveBeenCalledWith(expect.anything(), 'override:asset-review-clear');
  });
});
