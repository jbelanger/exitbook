import { describe, expect, it } from 'vitest';

import { buildCostBasisJsonData } from '../cost-basis-json.js';

describe('buildCostBasisJsonData', () => {
  it('includes scoped issue notices in the JSON payload', () => {
    const result = buildCostBasisJsonData({
      assetItems: [],
      context: {
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
      issueNotices: [
        {
          count: 2,
          kind: 'warning_issues',
          message: '2 warning issues in this scope. Review them in issues.',
          reviewCommand: 'exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo',
          severity: 'warning',
        },
      ],
      summary: {
        assetsProcessed: [],
        disposalsProcessed: 1,
        lotsCreated: 2,
        totalProceeds: '100.00',
        totalCostBasis: '80.00',
        totalGainLoss: '20.00',
        totalTaxableGainLoss: '20.00',
        transactionsProcessed: 4,
      },
    });

    expect(result.issueNotices).toEqual([
      {
        count: 2,
        kind: 'warning_issues',
        message: '2 warning issues in this scope. Review them in issues.',
        reviewCommand: 'exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo',
        severity: 'warning',
      },
    ]);
  });
});
