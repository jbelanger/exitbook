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
          commandHint: 'pnpm run dev links create e96a8b7baa b7c08af224 --asset LINK',
          count: 2,
          detail: 'Example: LINK on 2024-06-08 (kraken -> ethereum, tx 41 -> 42).',
          message: '2 transfers require manual review because a confirmed source/target link is missing.',
          recommendedAction: 'Create the missing confirmed link directly, then rerun cost basis.',
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
        commandHint: 'pnpm run dev links create e96a8b7baa b7c08af224 --asset LINK',
        count: 2,
        detail: 'Example: LINK on 2024-06-08 (kraken -> ethereum, tx 41 -> 42).',
        message: '2 transfers require manual review because a confirmed source/target link is missing.',
        recommendedAction: 'Create the missing confirmed link directly, then rerun cost basis.',
        severity: 'warning',
      },
    ]);
  });
});
