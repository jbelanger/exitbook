import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { PortfolioApp } from '../portfolio-view-components.js';
import { createPortfolioAssetsState } from '../portfolio-view-state.js';

function createBaseState() {
  return createPortfolioAssetsState({
    asOf: '2026-01-01T00:00:00.000Z',
    method: 'fifo',
    jurisdiction: 'US',
    displayCurrency: 'USD',
    positions: [
      {
        assetId: 'asset:btc',
        assetSymbol: 'BTC',
        quantity: '1.00000000',
        isNegative: false,
        spotPricePerUnit: '30000.00',
        currentValue: '30000.00',
        allocationPct: '100.0',
        priceStatus: 'ok',
        totalCostBasis: '20000.00',
        avgCostPerUnit: '20000.00',
        unrealizedGainLoss: '10000.00',
        unrealizedPct: '50.0',
        realizedGainLossAllTime: '1500.00',
        openLots: [
          {
            lotId: 'lot-1',
            quantity: '1.00000000',
            remainingQuantity: '1.00000000',
            costBasisPerUnit: '20000.00',
            acquisitionDate: '2025-01-01T00:00:00.000Z',
            holdingDays: 365,
          },
        ],
        accountBreakdown: [{ accountId: 1, sourceName: 'kraken', accountType: 'exchange-api', quantity: '1.00000000' }],
      },
    ],
    transactionsByAssetId: new Map([['asset:btc', []]]),
    totalTransactions: 1,
    totalValue: '30000.00',
    totalCost: '20000.00',
    totalUnrealizedGainLoss: '10000.00',
    totalUnrealizedPct: '50.0',
    totalRealizedGainLossAllTime: '1500.00',
    totalNetFiatIn: '12000.00',
  });
}

describe('PortfolioApp - pnl rendering', () => {
  it('keeps total cost visible in realized mode and hides unrealized detail row', () => {
    const state = { ...createBaseState(), pnlMode: 'realized' as const };
    const { lastFrame } = render(
      <PortfolioApp
        initialState={state}
        onQuit={() => {
          /* noop */
        }}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain('Net Fiat In +USD 12,000.00');
    expect(frame).toContain('Total Cost USD 20,000.00');
    expect(frame).toContain('Realized (all-time) +USD 1,500.00');
    expect(frame).not.toContain('Unrealized:');
  });

  it('shows closed positions only in realized mode', () => {
    const unrealizedState = {
      ...createBaseState(),
      closedPositions: [
        {
          assetId: 'asset:sol',
          assetSymbol: 'SOL',
          quantity: '0.00000000',
          isNegative: false,
          isClosedPosition: true,
          priceStatus: 'unavailable' as const,
          realizedGainLossAllTime: '250.00',
          openLots: [],
          accountBreakdown: [],
        },
      ],
    };
    const realizedState = { ...unrealizedState, pnlMode: 'realized' as const };

    const { lastFrame: unrealizedFrame } = render(
      <PortfolioApp
        initialState={unrealizedState}
        onQuit={() => {
          /* noop */
        }}
      />
    );
    expect(unrealizedFrame()).not.toContain('SOL');

    const { lastFrame: realizedFrame } = render(
      <PortfolioApp
        initialState={realizedState}
        onQuit={() => {
          /* noop */
        }}
      />
    );
    expect(realizedFrame()).toContain('SOL');
    expect(realizedFrame()).toContain('closed position');
    expect(realizedFrame()).toContain('realized');
    expect(realizedFrame()).toContain('+USD 250.00');
  });
});
