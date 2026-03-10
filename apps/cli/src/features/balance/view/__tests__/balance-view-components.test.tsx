/**
 * Tests for balance view components
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { BalanceApp } from '../balance-view-components.jsx';
import { createBalanceAssetState, type AssetComparisonItem, type AssetDiagnostics } from '../balance-view-state.js';

const mockOnQuit = () => {
  /* empty */
};

function createDiagnostics(): AssetDiagnostics {
  return {
    txCount: 0,
    totals: {
      inflows: '0',
      outflows: '0',
      fees: '0',
      net: '0',
    },
  };
}

function createAssetComparisonItem(overrides: Partial<AssetComparisonItem>): AssetComparisonItem {
  return {
    assetId: overrides.assetId ?? 'asset-id',
    assetSymbol: overrides.assetSymbol ?? 'ETH',
    calculatedBalance: overrides.calculatedBalance ?? '0',
    liveBalance: overrides.liveBalance ?? '0',
    difference: overrides.difference ?? '0',
    percentageDiff: overrides.percentageDiff ?? 0,
    status: overrides.status ?? 'match',
    diagnostics: overrides.diagnostics ?? createDiagnostics(),
  };
}

describe('BalanceApp - asset view', () => {
  it('keeps calc and live columns aligned when the selected row changes styling', () => {
    const state = createBalanceAssetState(
      {
        accountId: 44,
        sourceName: 'coinbase',
        accountType: 'exchange-api',
      },
      [
        createAssetComparisonItem({
          assetId: 'eth',
          assetSymbol: 'ETH',
          calculatedBalance: '0',
          liveBalance: '0',
        }),
        createAssetComparisonItem({
          assetId: 'fet',
          assetSymbol: 'FET',
          calculatedBalance: '0.09033624',
          liveBalance: '0.09033624',
        }),
      ],
      { offline: false }
    );
    state.selectedIndex = 0;

    const { lastFrame } = render(
      <BalanceApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    const lines = frame.split('\n');
    const selectedLine = lines.find((line) => line.includes('ETH'));
    const unselectedLine = lines.find((line) => line.includes('FET'));

    expect(selectedLine).toBeDefined();
    expect(unselectedLine).toBeDefined();
    if (!selectedLine || !unselectedLine) {
      return;
    }

    expect(selectedLine.indexOf('calc')).toBe(unselectedLine.indexOf('calc'));
    expect(selectedLine.indexOf('live')).toBe(unselectedLine.indexOf('live'));
  });
});
