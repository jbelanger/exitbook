import type { BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KyselyDB } from '../../database.js';
import { createTestDatabase } from '../../utils/test-utils.js';
import { BalanceSnapshotRepository } from '../balance-snapshot-repository.js';

import { seedAccount, seedProfile } from './helpers.js';

function createSnapshot(scopeAccountId: number, overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    scopeAccountId,
    verificationStatus: 'warning',
    calculatedAt: new Date('2026-03-11T10:00:00.000Z'),
    lastRefreshAt: new Date('2026-03-11T10:05:00.000Z'),
    coverageStatus: 'partial',
    coverageConfidence: 'medium',
    requestedAddressCount: 3,
    successfulAddressCount: 2,
    failedAddressCount: 1,
    totalAssetCount: 4,
    parsedAssetCount: 3,
    failedAssetCount: 1,
    matchCount: 1,
    warningCount: 2,
    mismatchCount: 1,
    statusReason: 'One address did not respond',
    suggestion: 'Retry refresh after provider recovery',
    ...overrides,
  };
}

function createAsset(
  scopeAccountId: number,
  assetId: string,
  overrides: Partial<BalanceSnapshotAsset> = {}
): BalanceSnapshotAsset {
  return {
    scopeAccountId,
    assetId,
    assetSymbol: assetId.split(':').at(-1)?.toUpperCase() ?? 'UNKNOWN',
    calculatedBalance: '1.25',
    liveBalance: '1.00',
    difference: '-0.25',
    balanceCategory: 'liquid',
    comparisonStatus: 'warning',
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('BalanceSnapshotRepository', () => {
  let db: KyselyDB;
  let repo: BalanceSnapshotRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new BalanceSnapshotRepository(db);
    await seedProfile(db);
    await seedAccount(db, 1, 'blockchain', 'bitcoin');
    await seedAccount(db, 2, 'exchange-api', 'kraken');
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('replaces and reloads a scope snapshot with its assets', async () => {
    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(1),
        assets: [
          createAsset(1, 'blockchain:bitcoin:native', {
            assetSymbol: 'BTC',
            comparisonStatus: 'match',
            difference: '0',
            liveBalance: '1.25',
          }),
          createAsset(1, 'blockchain:bitcoin:runes', {
            assetSymbol: 'DOG',
            excludedFromAccounting: true,
          }),
        ],
      })
    );

    const snapshot = assertOk(await repo.findSnapshot(1));
    const assets = assertOk(await repo.findAssetsByScope([1]));

    expect(snapshot).toMatchObject({
      scopeAccountId: 1,
      verificationStatus: 'warning',
      warningCount: 2,
      mismatchCount: 1,
      coverageStatus: 'partial',
    });
    expect(assets).toEqual([
      {
        scopeAccountId: 1,
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        calculatedBalance: '1.25',
        liveBalance: '1.25',
        difference: '0',
        balanceCategory: 'liquid',
        comparisonStatus: 'match',
        excludedFromAccounting: false,
      },
      {
        scopeAccountId: 1,
        assetId: 'blockchain:bitcoin:runes',
        assetSymbol: 'DOG',
        calculatedBalance: '1.25',
        liveBalance: '1.00',
        difference: '-0.25',
        balanceCategory: 'liquid',
        comparisonStatus: 'warning',
        excludedFromAccounting: true,
      },
    ]);
  });

  it('replaces old asset rows instead of appending to them', async () => {
    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(1),
        assets: [createAsset(1, 'blockchain:bitcoin:native', { assetSymbol: 'BTC' })],
      })
    );

    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(1, {
          verificationStatus: 'match',
          warningCount: 0,
          mismatchCount: 0,
          matchCount: 1,
        }),
        assets: [createAsset(1, 'exchange:kraken:btc', { assetSymbol: 'BTC', comparisonStatus: 'match' })],
      })
    );

    const assets = assertOk(await repo.findAssetsByScope([1]));
    expect(assets.map((asset) => asset.assetId)).toEqual(['exchange:kraken:btc']);
  });

  it('keeps separate rows for the same asset in different balance categories', async () => {
    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(1),
        assets: [
          createAsset(1, 'blockchain:solana:native', {
            assetSymbol: 'SOL',
            balanceCategory: 'liquid',
            calculatedBalance: '2.50',
            liveBalance: '2.50',
            difference: '0',
            comparisonStatus: 'match',
          }),
          createAsset(1, 'blockchain:solana:native', {
            assetSymbol: 'SOL',
            balanceCategory: 'staked',
            calculatedBalance: '3.00',
            liveBalance: '3.00',
            difference: '0',
            comparisonStatus: 'match',
          }),
        ],
      })
    );

    const assets = assertOk(await repo.findAssetsByScope([1]));
    expect(assets.map((asset) => [asset.assetId, asset.balanceCategory, asset.calculatedBalance])).toEqual([
      ['blockchain:solana:native', 'liquid', '2.50'],
      ['blockchain:solana:native', 'staked', '3.00'],
    ]);
  });

  it('groups assets by asset id across scopes', async () => {
    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(1),
        assets: [createAsset(1, 'shared:btc', { assetSymbol: 'BTC', comparisonStatus: 'match' })],
      })
    );
    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(2, { verificationStatus: 'match' }),
        assets: [createAsset(2, 'shared:btc', { assetSymbol: 'BTC', comparisonStatus: 'match' })],
      })
    );

    const grouped = assertOk(await repo.findAssetsGroupedByAssetId());
    expect(grouped.get('shared:btc')).toHaveLength(2);
    expect(grouped.get('shared:btc')?.map((asset) => asset.scopeAccountId)).toEqual([1, 2]);
  });

  it('handles large scope filters when listing snapshots and assets', async () => {
    assertOk(await repo.replaceSnapshot({ snapshot: createSnapshot(1), assets: [createAsset(1, 'shared:btc')] }));
    assertOk(await repo.replaceSnapshot({ snapshot: createSnapshot(2), assets: [createAsset(2, 'shared:eth')] }));

    const scopeAccountIds = Array.from({ length: 1_200 }, (_, index) => index + 1);
    const snapshots = assertOk(await repo.findSnapshots(scopeAccountIds));
    const assets = assertOk(await repo.findAssetsByScope(scopeAccountIds));

    expect(snapshots.map((snapshot) => snapshot.scopeAccountId)).toEqual([1, 2]);
    expect(assets.map((asset) => asset.scopeAccountId)).toEqual([1, 2]);
  });

  it('deletes targeted scopes only', async () => {
    assertOk(await repo.replaceSnapshot({ snapshot: createSnapshot(1), assets: [createAsset(1, 'shared:btc')] }));
    assertOk(await repo.replaceSnapshot({ snapshot: createSnapshot(2), assets: [createAsset(2, 'shared:eth')] }));

    const deleted = assertOk(await repo.deleteByScopeAccountIds([1]));

    expect(deleted).toBe(1);
    expect(assertOk(await repo.findSnapshot(1))).toBeUndefined();
    expect(assertOk(await repo.findSnapshot(2))).toMatchObject({ scopeAccountId: 2 });
  });

  it('replaces snapshots with large asset sets without exceeding SQLite variable limits', async () => {
    const totalAssets = 250;
    const assets = Array.from({ length: totalAssets }, (_, index) =>
      createAsset(1, `blockchain:ethereum:asset-${index.toString().padStart(3, '0')}`, {
        assetSymbol: `ASSET${index}`,
        comparisonStatus: index % 2 === 0 ? 'match' : 'warning',
        difference: index % 2 === 0 ? '0' : '-0.01',
        liveBalance: index % 2 === 0 ? '1.25' : '1.24',
      })
    );

    assertOk(
      await repo.replaceSnapshot({
        snapshot: createSnapshot(1, {
          totalAssetCount: totalAssets,
          parsedAssetCount: totalAssets,
          matchCount: totalAssets / 2,
          warningCount: totalAssets / 2,
          mismatchCount: 0,
        }),
        assets,
      })
    );

    const persistedAssets = assertOk(await repo.findAssetsByScope([1]));
    expect(persistedAssets).toHaveLength(totalAssets);
    expect(persistedAssets[0]?.assetId).toBe('blockchain:ethereum:asset-000');
    expect(persistedAssets.at(-1)?.assetId).toBe(
      `blockchain:ethereum:asset-${(totalAssets - 1).toString().padStart(3, '0')}`
    );
  });
});
