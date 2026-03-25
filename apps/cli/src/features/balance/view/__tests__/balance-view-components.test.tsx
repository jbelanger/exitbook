/**
 * Tests for balance view components
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { BalanceApp } from '../balance-view-components.jsx';
import {
  createBalanceStoredSnapshotAssetState,
  createBalanceVerificationAssetState,
  type AssetComparisonItem,
  type AssetDiagnostics,
  type StoredSnapshotAssetItem,
} from '../balance-view-state.js';

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

function createStoredSnapshotAssetItem(overrides: Partial<StoredSnapshotAssetItem> = {}): StoredSnapshotAssetItem {
  return {
    assetId: overrides.assetId ?? 'asset-id',
    assetSymbol: overrides.assetSymbol ?? 'BTC',
    calculatedBalance: overrides.calculatedBalance ?? '1.25',
    isNegative: overrides.isNegative ?? false,
    diagnostics: overrides.diagnostics ?? createDiagnostics(),
  };
}

describe('BalanceApp - asset view', () => {
  it('keeps calc and live columns aligned when the selected row changes styling', () => {
    const state = createBalanceVerificationAssetState(
      {
        accountId: 44,
        platformKey: 'coinbase',
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
      ]
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

  it('renders stored snapshot asset mode without live comparison columns', () => {
    const state = createBalanceStoredSnapshotAssetState(
      {
        accountId: 55,
        platformKey: 'bitcoin',
        accountType: 'blockchain',
      },
      [createStoredSnapshotAssetItem({ assetSymbol: 'BTC', calculatedBalance: '1.25' })]
    );

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

    expect(frame).toContain('Balance (stored snapshot)');
    expect(frame).not.toContain('live');
  });

  it('surfaces stored-snapshot verification warnings in asset mode', () => {
    const state = createBalanceStoredSnapshotAssetState(
      {
        accountId: 74,
        platformKey: 'lukso',
        accountType: 'blockchain',
        verificationStatus: 'unavailable',
        statusReason: 'Live balance verification is unavailable for lukso.',
        suggestion: 'Add a balance-capable provider for lukso to enable live verification.',
        lastRefreshAt: '2026-03-12T18:10:00.000Z',
      },
      [
        createStoredSnapshotAssetItem({
          assetSymbol: 'LYX',
          calculatedBalance: '12.5',
          diagnostics: {
            txCount: 4,
            dateRange: {
              earliest: '2026-02-01T00:00:00.000Z',
              latest: '2026-02-20T00:00:00.000Z',
            },
            totals: {
              inflows: '12.5',
              outflows: '0',
              fees: '0',
              net: '12.5',
            },
          },
        }),
      ]
    );

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

    expect(frame).toContain('verification unavailable');
    expect(frame).toContain('Live balance verification is unavailable for lukso.');
    expect(frame).toContain('Transactions: 4');
    expect(frame).toContain('Net from transactions: 12.5');
  });
});
