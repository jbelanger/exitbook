import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import type { CostBasisReadinessWarning } from '../../cost-basis-readiness.js';
import { CostBasisApp } from '../cost-basis-view-components.jsx';
import { createCostBasisAssetState, type AssetCostBasisItem } from '../cost-basis-view-state.js';

const mockOnQuit = () => {
  /* empty */
};

function createAssetState(options?: { readinessWarnings?: readonly CostBasisReadinessWarning[] | undefined }) {
  const asset: AssetCostBasisItem = {
    asset: 'BTC',
    disposalCount: 1,
    lotCount: 1,
    transferCount: 0,
    totalProceeds: '1000.00',
    totalCostBasis: '700.00',
    totalGainLoss: '300.00',
    totalTaxableGainLoss: '300.00',
    isGain: true,
    disposals: [
      {
        type: 'disposal',
        id: 'disp-1',
        date: '2024-03-10',
        sortTimestamp: '2024-03-10T00:00:00.000Z',
        quantityDisposed: '0.01000000',
        asset: 'BTC',
        proceedsPerUnit: '100000.00',
        totalProceeds: '1000.00',
        costBasisPerUnit: '70000.00',
        totalCostBasis: '700.00',
        gainLoss: '300.00',
        taxableGainLoss: '300.00',
        isGain: true,
        disposalTransactionId: 2,
      },
    ],
    lots: [
      {
        type: 'acquisition',
        id: 'lot-1',
        date: '2024-01-10',
        sortTimestamp: '2024-01-10T00:00:00.000Z',
        quantity: '0.01000000',
        asset: 'BTC',
        costBasisPerUnit: '70000.00',
        totalCostBasis: '700.00',
        transactionId: 1,
        lotId: 'lot-1',
        remainingQuantity: '0',
        status: 'fully_disposed',
      },
    ],
    transfers: [],
  };

  return createCostBasisAssetState(
    {
      calculationId: 'calc-1',
      method: 'fifo',
      jurisdiction: 'US',
      taxYear: 2024,
      currency: 'USD',
      dateRange: {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      },
    },
    [asset],
    {
      totalProceeds: '1000.00',
      totalCostBasis: '700.00',
      totalGainLoss: '300.00',
      totalTaxableGainLoss: '300.00',
      shortTermGainLoss: '300.00',
      longTermGainLoss: '0.00',
    },
    {
      readinessWarnings: options?.readinessWarnings ?? [],
      totalDisposals: 1,
      totalLots: 1,
    }
  );
}

describe('CostBasisApp', () => {
  it('renders readiness warnings above the asset list', () => {
    const state = createAssetState({
      readinessWarnings: [
        {
          code: 'UNRESOLVED_ASSET_REVIEW',
          count: 2,
          message: '2 assets still require review before filing export.',
          severity: 'blocked',
        },
        {
          code: 'INCOMPLETE_TRANSFER_LINKING',
          commandHint: 'pnpm run dev links create e96a8b7baa b7c08af224 --asset LINK',
          count: 1,
          detail: 'Example: LINK on 2024-06-08 (kraken -> ethereum, tx 41 -> 42).',
          message: '1 transfer requires manual review because a confirmed source/target link is missing.',
          recommendedAction: 'Create the missing confirmed link directly, then rerun cost basis.',
          severity: 'warning',
        },
      ],
    });

    const frame = render(
      <CostBasisApp
        initialState={state}
        onQuit={mockOnQuit}
      />
    ).lastFrame();

    expect(frame).toBeDefined();
    if (!frame) {
      return;
    }

    expect(frame).toContain('2 assets still require review before filing export.');
    expect(frame).toContain('1 transfer requires manual review because a confirmed source/target link is missing.');
    expect(frame).toContain('Why: Example: LINK on 2024-06-08 (kraken -> ethereum, tx 41 -> 42).');
    expect(frame).toContain('Next: Create the missing confirmed link directly, then rerun cost basis.');
    expect(frame).toContain('Command: pnpm run dev links create e96a8b7baa');
    expect(frame.indexOf('2 assets still require review before filing export.')).toBeLessThan(frame.indexOf('BTC'));
  });
});
