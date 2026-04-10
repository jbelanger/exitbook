import { describe, expect, it } from 'vitest';

import { buildCostBasisJsonData } from '../cost-basis-json.js';

describe('buildCostBasisJsonData', () => {
  it('includes readiness warnings in the JSON payload', () => {
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
      readinessWarnings: [
        {
          code: 'INCOMPLETE_TRANSFER_LINKING',
          count: 2,
          message: '2 transfers require manual review because linking is incomplete.',
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

    expect(result.readinessWarnings).toEqual([
      {
        code: 'INCOMPLETE_TRANSFER_LINKING',
        count: 2,
        message: '2 transfers require manual review because linking is incomplete.',
        severity: 'warning',
      },
    ]);
  });
});
