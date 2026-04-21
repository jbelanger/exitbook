import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { buildStoredBalanceAssetDiagnostics, sortStoredBalanceAssets } from '../stored-balance-detail-utils.js';
import type { StoredBalanceAssetViewItem } from '../stored-balance-view.js';

function createAsset(overrides: Partial<StoredBalanceAssetViewItem> & Pick<StoredBalanceAssetViewItem, 'assetId'>) {
  return {
    assetId: overrides.assetId,
    assetSymbol: overrides.assetSymbol ?? overrides.assetId.toUpperCase(),
    calculatedBalance: overrides.calculatedBalance ?? '0',
    liveBalance: overrides.liveBalance,
    comparisonStatus: overrides.comparisonStatus,
    isNegative: overrides.isNegative ?? false,
    diagnostics: overrides.diagnostics ?? {
      txCount: 0,
      totals: {
        fees: '0',
        inflows: '0',
        net: '0',
        outflows: '0',
      },
    },
  } satisfies StoredBalanceAssetViewItem;
}

describe('buildStoredBalanceAssetDiagnostics', () => {
  it('formats totals and computes unexplained delta from live vs calculated balances', () => {
    const diagnostics = buildStoredBalanceAssetDiagnostics(
      {
        assetId: 'asset:btc',
        assetSymbol: 'BTC',
        totals: {
          inflows: parseDecimal('1.50000000'),
          outflows: parseDecimal('0.25000000'),
          fees: parseDecimal('0.01000000'),
          net: parseDecimal('1.24000000'),
          txCount: 3,
        },
        dateRange: {
          earliest: '2026-03-10T00:00:00.000Z',
          latest: '2026-03-12T00:00:00.000Z',
        },
      },
      {
        calculatedBalance: '1.24000000',
        liveBalance: '1.00000000',
      }
    );

    expect(diagnostics).toEqual({
      txCount: 3,
      dateRange: {
        earliest: '2026-03-10T00:00:00.000Z',
        latest: '2026-03-12T00:00:00.000Z',
      },
      totals: {
        inflows: '1.5',
        outflows: '0.25',
        fees: '0.01',
        net: '1.24',
      },
      unexplainedDelta: '-0.24',
    });
  });
});

describe('sortStoredBalanceAssets', () => {
  it('keeps negative balances first and sorts each sign group by absolute size', () => {
    const sorted = sortStoredBalanceAssets([
      createAsset({ assetId: 'small-positive', assetSymbol: 'SP', calculatedBalance: '2' }),
      createAsset({
        assetId: 'large-negative',
        assetSymbol: 'LN',
        calculatedBalance: '-1',
        isNegative: true,
      }),
      createAsset({
        assetId: 'small-negative',
        assetSymbol: 'SN',
        calculatedBalance: '-0.5',
        isNegative: true,
      }),
      createAsset({ assetId: 'large-positive', assetSymbol: 'LP', calculatedBalance: '10' }),
    ]);

    expect(sorted.map((asset) => asset.assetId)).toEqual([
      'large-negative',
      'small-negative',
      'large-positive',
      'small-positive',
    ]);
  });
});
