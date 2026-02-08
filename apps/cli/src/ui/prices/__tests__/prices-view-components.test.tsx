/**
 * Tests for prices view components
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import type { MissingPriceMovement, PriceCoverageDetail } from '../../../features/prices/prices-view-utils.js';
import { PricesViewApp } from '../prices-view-components.js';
import { createCoverageViewState, createMissingViewState } from '../prices-view-state.js';

describe('PricesViewApp - coverage mode', () => {
  const mockOnQuit = () => {
    /* empty */
  };

  it('renders empty state when no coverage data and no transactions', () => {
    const state = createCoverageViewState([], {
      total_transactions: 0,
      with_price: 0,
      missing_price: 0,
      overall_coverage_percentage: 0,
    });
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    expect(lastFrame()).toContain('No transaction data found');
    expect(lastFrame()).toContain('Import transactions first');
  });

  it('renders all-covered empty state when filtered down to nothing', () => {
    const state = createCoverageViewState([], {
      total_transactions: 100,
      with_price: 100,
      missing_price: 0,
      overall_coverage_percentage: 100,
    });
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );

    expect(lastFrame()).toContain('All assets have complete price coverage');
  });

  it('renders header with asset count, coverage, and price counts', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Price Coverage');
    expect(frame).toContain('3 assets');
    expect(frame).toContain('90.0% overall');
    expect(frame).toContain('315 with price');
    expect(frame).toContain('35 missing');
  });

  it('renders header with filter info', () => {
    const coverage = createMockCoverage().slice(0, 1);
    const state = createCoverageViewState(coverage, createMockSummary(), 'BTC', 'kraken');
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Price Coverage (BTC, kraken)');
  });

  it('renders coverage rows with asset names', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('BTC');
    expect(frame).toContain('ETH');
    expect(frame).toContain('SOL');
  });

  it('renders coverage icons', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('✓'); // ETH 100%
    expect(frame).toContain('⚠'); // BTC/SOL with missing
  });

  it('highlights selected row', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    state.selectedIndex = 1;
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('▸');
  });

  it('renders detail panel for selected asset', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Sources:');
    expect(frame).toContain('kraken');
    expect(frame).toContain('coinbase');
    expect(frame).toContain('Date range:');
    expect(frame).toContain('With price:');
    expect(frame).toContain('Missing price:');
  });

  it('shows missing sources in detail panel', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    state.selectedIndex = 0; // BTC has missing sources
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Missing in:');
  });

  it('renders controls bar', () => {
    const coverage = createMockCoverage();
    const state = createCoverageViewState(coverage, createMockSummary());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('q/esc quit');
    expect(frame).not.toContain('s set price');
  });
});

describe('PricesViewApp - missing mode', () => {
  const mockOnQuit = () => {
    /* empty */
  };

  it('renders empty state when no missing movements', () => {
    const state = createMissingViewState([], []);
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('All movements have price data');
  });

  it('renders header with movement count and asset count', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Missing Prices');
    expect(frame).toContain('3');
    expect(frame).toContain('movement');
    expect(frame).toContain('across');
    expect(frame).toContain('2');
    expect(frame).toContain('asset');
  });

  it('renders header with filter info', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown(), 'BTC', 'kraken');
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Missing Prices (BTC, kraken)');
  });

  it('renders asset breakdown with per-source counts', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Asset Breakdown');
    expect(frame).toContain('BTC');
    expect(frame).toContain('2 movements');
    expect(frame).toContain('ETH');
    expect(frame).toContain('1 movement');
    expect(frame).toContain('kraken');
    expect(frame).toContain('coinbase');
  });

  it('renders movement rows', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('#101');
    expect(frame).toContain('#102');
    expect(frame).toContain('#103');
    expect(frame).toContain('IN');
    expect(frame).toContain('OUT');
    expect(frame).toContain('⚠');
  });

  it('renders resolved row as dim with checkmark', () => {
    const movements = createMockMovements();
    const state = createMissingViewState(movements, createMockAssetBreakdown());
    state.resolvedRows.add(`${movements[0]!.transactionId}:${movements[0]!.assetSymbol}:${movements[0]!.direction}`);
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    // The resolved row should have the checkmark
    expect(frame).toContain('✓');
  });

  it('renders detail panel for selected movement', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Asset:');
    expect(frame).toContain('Price:');
    expect(frame).toContain('missing');
    expect(frame).toContain("Press 's' to set price");
  });

  it('shows set price control for unresolved row', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('s set price');
    expect(frame).toContain('q/esc quit');
  });

  it('displays error message when present', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    state.error = 'Failed to save price';
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Failed to save price');
  });

  it('renders price input panel when activeInput set', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    state.activeInput = { rowIndex: 0, value: '425' };
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('#101');
    expect(frame).toContain('BTC');
    expect(frame).toContain('Price (USD):');
    expect(frame).toContain('425');
    expect(frame).toContain('enter save');
    expect(frame).toContain('esc cancel');
  });

  it('renders validation error in price input', () => {
    const state = createMissingViewState(createMockMovements(), createMockAssetBreakdown());
    state.activeInput = { rowIndex: 0, value: 'abc', validationError: 'Price must be a positive number' };
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('Price must be a positive number');
  });

  it('shows resolved count in header when some resolved', () => {
    const movements = createMockMovements();
    const state = createMissingViewState(movements, createMockAssetBreakdown());
    state.resolvedRows.add(`${movements[0]!.transactionId}:${movements[0]!.assetSymbol}:${movements[0]!.direction}`);
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('2');
    expect(frame).toContain('1 resolved');
  });

  it('shows resolved price and tip in detail panel after save', () => {
    const movements = createMockMovements();
    movements[0]!.resolvedPrice = '42500.50';
    const state = createMissingViewState(movements, createMockAssetBreakdown());
    state.resolvedRows.add(`${movements[0]!.transactionId}:${movements[0]!.assetSymbol}:${movements[0]!.direction}`);
    const { lastFrame } = render(
      <PricesViewApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('42500.50');
    expect(frame).toContain('USD');
    expect(frame).toContain('prices enrich');
  });
});

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockCoverage(): PriceCoverageDetail[] {
  return [
    {
      assetSymbol: 'BTC',
      total_transactions: 100,
      with_price: 90,
      missing_price: 10,
      coverage_percentage: 90,
      sources: [
        { name: 'kraken', count: 60 },
        { name: 'coinbase', count: 40 },
      ],
      missingSources: [
        { name: 'kraken', count: 7 },
        { name: 'coinbase', count: 3 },
      ],
      dateRange: { earliest: '2024-01-01T00:00:00Z', latest: '2024-12-31T23:59:59Z' },
    },
    {
      assetSymbol: 'ETH',
      total_transactions: 200,
      with_price: 200,
      missing_price: 0,
      coverage_percentage: 100,
      sources: [{ name: 'ethereum', count: 200 }],
      missingSources: [],
      dateRange: { earliest: '2024-02-01T00:00:00Z', latest: '2024-11-30T23:59:59Z' },
    },
    {
      assetSymbol: 'SOL',
      total_transactions: 50,
      with_price: 25,
      missing_price: 25,
      coverage_percentage: 50,
      sources: [{ name: 'solana', count: 50 }],
      missingSources: [{ name: 'solana', count: 25 }],
      dateRange: { earliest: '2024-06-01T00:00:00Z', latest: '2024-09-30T23:59:59Z' },
    },
  ];
}

function createMockSummary() {
  return {
    total_transactions: 300,
    with_price: 315,
    missing_price: 35,
    overall_coverage_percentage: 90,
  };
}

function createMockMovements(): MissingPriceMovement[] {
  return [
    {
      transactionId: 101,
      source: 'kraken',
      datetime: '2024-03-15T14:23:41Z',
      assetSymbol: 'BTC',
      amount: '1.5',
      direction: 'inflow',
      operationCategory: 'transfer',
      operationType: 'deposit',
    },
    {
      transactionId: 102,
      source: 'ethereum',
      datetime: '2024-03-16T10:15:22Z',
      assetSymbol: 'ETH',
      amount: '10.0',
      direction: 'outflow',
      operationCategory: 'transfer',
      operationType: 'withdrawal',
    },
    {
      transactionId: 103,
      source: 'coinbase',
      datetime: '2024-03-17T08:30:11Z',
      assetSymbol: 'SOL',
      amount: '100.0',
      direction: 'inflow',
      operationCategory: 'trade',
      operationType: 'buy',
    },
  ];
}

function createMockAssetBreakdown() {
  return [
    {
      assetSymbol: 'BTC',
      count: 2,
      sources: [
        { name: 'kraken', count: 1 },
        { name: 'coinbase', count: 1 },
      ],
    },
    { assetSymbol: 'ETH', count: 1, sources: [{ name: 'ethereum', count: 1 }] },
  ];
}
