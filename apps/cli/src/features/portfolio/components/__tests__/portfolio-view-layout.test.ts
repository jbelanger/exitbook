import { describe, expect, it } from 'vitest';

import { getPortfolioAssetsLayout, getPortfolioAssetsVisibleRows } from '../portfolio-view-layout.js';
import { createPortfolioAssetsState } from '../portfolio-view-state.js';

function createState(openLotCount: number) {
  return createPortfolioAssetsState({
    asOf: '2026-01-01T00:00:00.000Z',
    method: 'fifo',
    jurisdiction: 'US',
    displayCurrency: 'USD',
    positions: [
      {
        assetId: 'asset:render',
        assetSymbol: 'RENDER',
        quantity: '100.00000000',
        isNegative: false,
        spotPricePerUnit: '1.40',
        currentValue: '140.00',
        allocationPct: '100.0',
        priceStatus: 'ok',
        totalCostBasis: '400.00',
        avgCostPerUnit: '4.00',
        unrealizedGainLoss: '-260.00',
        unrealizedPct: '-65.0',
        realizedGainLossAllTime: '0.00',
        openLots: Array.from({ length: openLotCount }, (_, index) => ({
          lotId: `lot-${index + 1}`,
          quantity: '1.00000000',
          remainingQuantity: '1.00000000',
          costBasisPerUnit: '4.00',
          acquisitionDate: '2025-01-01T00:00:00.000Z',
          holdingDays: 365,
        })),
        accountBreakdown: [],
      },
    ],
    transactionsByAssetId: new Map([['asset:render', []]]),
    totalTransactions: 1,
    totalValue: '140.00',
    totalCost: '400.00',
    totalUnrealizedGainLoss: '-260.00',
    totalUnrealizedPct: '-65.0',
  });
}

describe('portfolio view layout', () => {
  it('limits open lot rows when detail would overflow viewport', () => {
    const state = createState(20);
    const layout = getPortfolioAssetsLayout(18, state);

    expect(layout.listVisibleRows).toBeGreaterThanOrEqual(1);
    expect(layout.hiddenOpenLots).toBeGreaterThan(0);
    expect(layout.openLotsVisibleRows + layout.hiddenOpenLots).toBe(20);
  });

  it('keeps all open lots visible when they fit', () => {
    const state = createState(2);
    const layout = getPortfolioAssetsLayout(30, state);

    expect(layout.hiddenOpenLots).toBe(0);
    expect(layout.openLotsVisibleRows).toBe(2);
  });

  it('reuses list row budget in keyboard navigation helper', () => {
    const state = createState(9);

    expect(getPortfolioAssetsVisibleRows(24, state)).toBe(getPortfolioAssetsLayout(24, state).listVisibleRows);
  });
});
