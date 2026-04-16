import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import type { CostBasisIssueNotice } from '../../cost-basis-issue-notices.js';
import { CostBasisApp } from '../cost-basis-view-components.jsx';
import { createCostBasisAssetState, type AssetCostBasisItem } from '../cost-basis-view-state.js';

const mockOnQuit = () => {
  /* empty */
};

function createAssetState(options?: { issueNotices?: readonly CostBasisIssueNotice[] | undefined }) {
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
      issueNotices: options?.issueNotices ?? [],
      totalDisposals: 1,
      totalLots: 1,
    }
  );
}

describe('CostBasisApp', () => {
  it('renders scoped issue notices above the asset list', () => {
    const state = createAssetState({
      issueNotices: [
        {
          count: 2,
          kind: 'blocking_issues',
          message: '2 blocking issues in this scope. Review them in issues.',
          reviewCommand: 'exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo',
          severity: 'blocked',
        },
        {
          count: 1,
          kind: 'warning_issues',
          message: '1 warning issue in this scope. Review it in issues.',
          reviewCommand: 'exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo',
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

    expect(frame).toContain('2 blocking issues in this scope. Review them in issues.');
    expect(frame).toContain('1 warning issue in this scope. Review it in issues.');
    expect(frame).toContain('Review: exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo');
    expect(frame.indexOf('2 blocking issues in this scope. Review them in issues.')).toBeLessThan(frame.indexOf('BTC'));
  });
});
