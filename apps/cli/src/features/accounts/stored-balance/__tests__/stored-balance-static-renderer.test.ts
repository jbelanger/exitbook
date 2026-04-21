import { describe, expect, it } from 'vitest';

import { buildStoredBalanceAssetSectionLines } from '../stored-balance-static-renderer.js';
import type { StoredBalanceAssetViewItem } from '../stored-balance-view.js';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '');
}

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

describe('buildStoredBalanceAssetSectionLines', () => {
  it('renders the stored-balance table directly for accounts static output', () => {
    const output = stripAnsi(
      buildStoredBalanceAssetSectionLines(
        [
          createAsset({
            assetId: 'asset:btc',
            assetSymbol: 'BTC',
            calculatedBalance: '0.42000000',
            liveBalance: '0.40000000',
            comparisonStatus: 'warning',
            diagnostics: {
              txCount: 2,
              totals: {
                fees: '0.00100000',
                inflows: '0.50000000',
                net: '0.42000000',
                outflows: '0.07900000',
              },
            },
          }),
        ],
        {
          title: 'Balances',
          includeLiveBalance: true,
          includeStatus: true,
        }
      ).join('\n')
    );

    expect(output).toContain('Balances (1)');
    expect(output).toContain('LAST VERIFIED LIVE');
    expect(output).toContain('STATUS');
    expect(output).toContain('TXS');
    expect(output).toContain('BTC');
    expect(output).toContain('0.42000000');
    expect(output).toContain('0.40000000');
    expect(output).toContain('warning');
  });
});
