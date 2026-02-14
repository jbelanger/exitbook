import { describe, expect, it } from 'vitest';

import { portfolioViewReducer } from '../portfolio-view-controller.js';
import { createPortfolioAssetsState, getVisiblePositions } from '../portfolio-view-state.js';

const baseState = createPortfolioAssetsState({
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
      currentValue: '30000.00',
      allocationPct: '75.0',
      priceStatus: 'ok',
      totalCostBasis: '20000.00',
      unrealizedGainLoss: '10000.00',
      openLots: [],
      accountBreakdown: [],
    },
    {
      assetId: 'asset:eth',
      assetSymbol: 'ETH',
      quantity: '1.00000000',
      isNegative: false,
      currentValue: '10000.00',
      allocationPct: '25.0',
      priceStatus: 'ok',
      totalCostBasis: '12000.00',
      unrealizedGainLoss: '-2000.00',
      openLots: [],
      accountBreakdown: [],
    },
  ],
  transactionsByAssetId: new Map([
    [
      'asset:btc',
      [
        {
          id: 1,
          datetime: '2025-01-01T00:00:00.000Z',
          operationCategory: 'trade',
          operationType: 'buy',
          sourceName: 'kraken',
          assetAmount: '1.00000000',
          assetDirection: 'in',
          inflows: [{ amount: '1.00000000', assetSymbol: 'BTC' }],
          outflows: [],
          fees: [],
        },
      ],
    ],
  ]),
  totalTransactions: 1,
  totalValue: '40000.00',
  totalCost: '32000.00',
  totalUnrealizedGainLoss: '8000.00',
  totalUnrealizedPct: '25.0',
});

describe('portfolioViewReducer', () => {
  it('navigates down through asset rows', () => {
    const next = portfolioViewReducer(baseState, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(next.selectedIndex).toBe(1);
  });

  it('cycles sort mode', () => {
    const next = portfolioViewReducer(baseState, { type: 'CYCLE_SORT' });
    expect(next.view).toBe('assets');
    if (next.view !== 'assets') return;
    expect(next.sortMode).toBe('gain');
  });

  it('cycles pnl mode', () => {
    const next = portfolioViewReducer(baseState, { type: 'CYCLE_PNL_MODE' });
    expect(next.view).toBe('assets');
    if (next.view !== 'assets') return;
    expect(next.pnlMode).toBe('realized');
  });

  it('includes closed positions when toggling to realized mode', () => {
    const stateWithClosed = {
      ...baseState,
      closedPositions: [
        {
          assetId: 'asset:closed',
          assetSymbol: 'CLOSED',
          quantity: '0.00000000',
          isNegative: false,
          isClosedPosition: true,
          priceStatus: 'unavailable' as const,
          realizedGainLossAllTime: '500.00',
          openLots: [],
          accountBreakdown: [],
        },
      ],
    };

    const next = portfolioViewReducer(stateWithClosed, { type: 'CYCLE_PNL_MODE' });
    expect(next.view).toBe('assets');
    if (next.view !== 'assets') return;
    expect(next.pnlMode).toBe('realized');
    expect(getVisiblePositions(next).map((position) => position.assetId)).toContain('asset:closed');
  });

  it('drills down into history and back to assets', () => {
    const history = portfolioViewReducer(baseState, { type: 'DRILL_DOWN' });
    expect(history.view).toBe('history');
    if (history.view !== 'history') return;
    expect(history.assetId).toBe('asset:btc');
    expect(history.transactions).toHaveLength(1);

    const back = portfolioViewReducer(history, { type: 'DRILL_UP' });
    expect(back.view).toBe('assets');
    if (back.view !== 'assets') return;
    expect(back.selectedIndex).toBe(0);
  });
});
